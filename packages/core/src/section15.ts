import { ClauseAnalysis } from "@rater/contracts";
import type {
  Clause,
  ClauseMatch,
  ContractFields,
  CrossConflict,
  LawArticle,
  Rule,
} from "@rater/contracts";
import type { ArticleText, CandidateRule, LlmClient, LlmUsage } from "@rater/llm";
import {
  askWithRetry,
  checkClauseAnalysis,
  checkCrossCheck,
  reviewFinding,
} from "./engine/analyser";
import { formatCitation } from "./engine/citation";
import { mapWithLimit } from "./engine/concurrency";
import { findingText } from "./engine/messages";
import { addUsage, isProblemVerdict, ZERO_USAGE } from "./engine/verdicts";
import { summariseFields } from "./rules";
import type { AnalysedFinding, ArticleLookup, ClauseCache, StepVersions } from "./types";

export { formatCitation } from "./engine/citation";
export { REVIEW_RULE_ID } from "./engine/verdicts";

/*
 * Steps 4b and 4c: the analyser reads Section 15. Rule-first article lookup with vector
 * search as a backstop; every reply is validated, retried once, and cached when valid.
 */

export interface Section15Input {
  /** Redacted clauses. */
  clauses: Clause[];
  fields: ContractFields;
  rules: Rule[];
  llm: LlmClient;
  articles: ArticleLookup;
  cache: ClauseCache;
  versions: StepVersions;
}

export interface Section15Output {
  findings: AnalysedFinding[];
  usage: LlmUsage;
}

/** Articles found by similarity search, on top of the candidate rules' own articles. */
const SEARCH_BACKSTOP_K = 3;
/** Clauses analysed at the same time. */
const CLAUSE_CONCURRENCY = 4;

/** Cache key: same clause text under the same law, ruleset, prompt and model gives the same answer. */
export function clauseCacheKey(
  clause: Clause,
  v: { law: string; ruleset: string; prompt: string; model: string },
): string {
  return [clause.textHash, v.law, v.ruleset, v.prompt, v.model].join("|");
}

/** In-memory ClauseCache for tests, evals and the offline pipeline. */
export class MemoryClauseCache implements ClauseCache {
  private readonly entries = new Map<string, unknown>();

  async get(key: string): Promise<unknown> {
    return this.entries.get(key);
  }

  async set(key: string, value: unknown): Promise<void> {
    this.entries.set(key, structuredClone(value));
  }

  get size(): number {
    return this.entries.size;
  }
}

/** Rules a Section 15 clause can match: clause rules, and field rules that say what to detect. */
export function clauseCandidates(rules: Rule[]): Rule[] {
  return rules.filter(
    (rule) =>
      rule.kind === "clause" || (rule.kind === "field" && rule.detect !== undefined),
  );
}

/** Step 4b: one analyser call per clause (cache first). */
export async function analyseSection15(input: Section15Input): Promise<Section15Output> {
  const candidates = clauseCandidates(input.rules);
  const clauses = input.clauses.filter(hasText);
  if (candidates.length === 0 || clauses.length === 0) {
    return { findings: [], usage: ZERO_USAGE };
  }

  const context: ClauseContext = {
    input,
    candidates,
    rulesById: new Map(candidates.map((rule) => [rule.id, rule])),
    candidateRules: candidates.map(toCandidateRule),
    ruleArticles: await fetchRuleArticles(candidates, input.articles),
    fieldSummary: summariseFields(input.fields),
  };
  const results = await mapWithLimit(clauses, CLAUSE_CONCURRENCY, (clause) =>
    analyseClause(clause, context),
  );
  return {
    findings: results.flatMap((result) => result.findings),
    usage: results.reduce((sum, result) => addUsage(sum, result.usage), ZERO_USAGE),
  };
}

interface ClauseContext {
  input: Section15Input;
  candidates: Rule[];
  rulesById: Map<string, Rule>;
  candidateRules: CandidateRule[];
  ruleArticles: LawArticle[];
  fieldSummary: string;
}

async function analyseClause(
  clause: Clause,
  context: ClauseContext,
): Promise<Section15Output> {
  const { llm, cache, articles, versions } = context.input;
  const key = clauseCacheKey(clause, {
    ...versions,
    prompt: llm.promptVersion,
    model: llm.model,
  });

  const cached = readCachedAnalysis(await cache.get(key), context.rulesById);
  if (cached) {
    return {
      findings: matchFindings(cached, clause.number, context.rulesById),
      usage: ZERO_USAGE,
    };
  }

  const searched = await articles.search(searchText(clause), SEARCH_BACKSTOP_K);
  const articleTexts = toArticleTexts([...context.ruleArticles, ...searched]);
  const request = {
    clause: { number: clause.number, textEn: clause.textEn, textAr: clause.textAr },
    fieldSummary: context.fieldSummary,
    candidateRules: context.candidateRules,
    articles: articleTexts,
  };
  const allowed = {
    ruleIds: new Set(context.rulesById.keys()),
    citations: allowedCitations(context.candidates, articleTexts),
  };

  const answer = await askWithRetry(
    (previousError) =>
      llm.analyzeClause(previousError ? { ...request, previousError } : request),
    (json) => checkClauseAnalysis(json, allowed),
  );
  if (!answer.ok) {
    return {
      findings: [reviewFinding(clause.number, answer.error)],
      usage: answer.usage,
    };
  }
  await cache.set(key, answer.value);
  return {
    findings: matchFindings(answer.value, clause.number, context.rulesById),
    usage: answer.usage,
  };
}

/** A cached value is used only if it is still a valid analysis against today's candidate rules. */
function readCachedAnalysis(
  value: unknown,
  rulesById: Map<string, Rule>,
): ClauseAnalysis | null {
  if (value === undefined || value === null) return null;
  const parsed = ClauseAnalysis.safeParse(value);
  if (!parsed.success) return null;
  return parsed.data.matches.every((match) => rulesById.has(match.ruleId))
    ? parsed.data
    : null;
}

function matchFindings(
  analysis: ClauseAnalysis,
  clauseNumber: string,
  rulesById: Map<string, Rule>,
): AnalysedFinding[] {
  const seen = new Set<string>();
  const findings: AnalysedFinding[] = [];
  for (const match of analysis.matches) {
    const rule = rulesById.get(match.ruleId);
    if (!rule || seen.has(match.ruleId)) continue;
    seen.add(match.ruleId);
    findings.push(matchFinding(match, clauseNumber, rule));
  }
  return findings;
}

/** A finding from one match: the rule supplies categories and texts, the analyser the verdict. */
function matchFinding(
  match: ClauseMatch,
  clauseNumber: string,
  rule: Rule,
): AnalysedFinding {
  return {
    ruleId: rule.id,
    clause: clauseNumber,
    verdict: match.verdict,
    // A clause that passes carries no severity, whatever the analyser said.
    severity: isProblemVerdict(match.verdict) ? match.severity : "none",
    confidence: match.confidence,
    categories: rule.categories,
    articles: citedOrRuleArticles(match.articles, rule),
    impact: null,
    explanation: match.explanation,
    ...findingText(rule, match.verdict),
    source: "clause",
    needsReview: false,
    impactParams: match.impactParams,
    impactKind: rule.impact,
  };
}

/** Step 4c: one call that checks all of Section 15 against sections 1-14. */
export async function crossCheckSection15(
  input: Section15Input,
): Promise<Section15Output> {
  const candidates = input.rules.filter((rule) => rule.kind === "cross");
  const clauses = input.clauses.filter(hasText);
  if (candidates.length === 0 || clauses.length === 0) {
    return { findings: [], usage: ZERO_USAGE };
  }

  const fetched = [
    ...(await fetchRuleArticles(candidates, input.articles)),
    ...(await input.articles.search(
      clauses.map(searchText).join("\n"),
      SEARCH_BACKSTOP_K,
    )),
  ];
  const articleTexts = toArticleTexts(fetched);
  const rulesById = new Map(candidates.map((rule) => [rule.id, rule]));
  const request = {
    fieldSummary: summariseFields(input.fields),
    clauses: clauses.map((c) => ({
      number: c.number,
      textEn: c.textEn,
      textAr: c.textAr,
    })),
    candidateRules: candidates.map(toCandidateRule),
    articles: articleTexts,
  };
  const allowed = {
    ruleIds: new Set(rulesById.keys()),
    citations: allowedCitations(candidates, articleTexts),
    clauses: new Set(clauses.map((c) => c.number)),
  };

  const answer = await askWithRetry(
    (previousError) =>
      input.llm.crossCheck(previousError ? { ...request, previousError } : request),
    (json) => checkCrossCheck(json, allowed),
  );
  if (!answer.ok) {
    return { findings: [reviewFinding(null, answer.error)], usage: answer.usage };
  }

  const seen = new Set<string>();
  const findings: AnalysedFinding[] = [];
  for (const conflict of answer.value.conflicts) {
    const rule = rulesById.get(conflict.ruleId);
    const key = `${conflict.ruleId}@${conflict.clause}`;
    if (!rule || seen.has(key)) continue;
    seen.add(key);
    findings.push(conflictFinding(conflict, rule));
  }
  return { findings, usage: answer.usage };
}

function conflictFinding(conflict: CrossConflict, rule: Rule): AnalysedFinding {
  return {
    ruleId: rule.id,
    clause: conflict.clause,
    verdict: "conflict",
    severity: conflict.severity,
    confidence: conflict.confidence,
    categories: rule.categories,
    articles: citedOrRuleArticles(conflict.articles, rule),
    impact: null,
    explanation: `Contradicts clause ${conflict.templateClause}. ${conflict.explanation}`,
    ...findingText(rule, "conflict"),
    source: "cross_check",
    needsReview: false,
    impactKind: rule.impact,
  };
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

function hasText(clause: Clause): boolean {
  return clause.textEn.trim() !== "" || (clause.textAr?.trim() ?? "") !== "";
}

function searchText(clause: Clause): string {
  return [clause.textEn, clause.textAr].filter((text) => text).join("\n");
}

function toCandidateRule(rule: Rule): CandidateRule {
  return {
    id: rule.id,
    title: rule.title,
    detect: rule.detect ?? rule.check ?? rule.title,
    note: rule.note,
    articles: rule.articles,
  };
}

async function fetchRuleArticles(
  rules: Rule[],
  lookup: ArticleLookup,
): Promise<LawArticle[]> {
  const refs = rules.flatMap((rule) => rule.articleRefs);
  return refs.length > 0 ? lookup.byRefs(refs) : [];
}

/**
 * One ArticleText per citation. Chunks that share a citation (paragraphs of a regulation
 * article, or an article found both by rule and by search) are merged, not repeated.
 */
function toArticleTexts(articles: LawArticle[]): ArticleText[] {
  const byCitation = new Map<string, ArticleText>();
  for (const article of articles) {
    const citation = formatCitation(article);
    const existing = byCitation.get(citation);
    byCitation.set(citation, {
      citation,
      textAr: joinText(existing?.textAr ?? null, article.textAr),
      textEn: joinText(existing?.textEn ?? null, article.textEnUnofficial),
    });
  }
  return [...byCitation.values()];
}

function joinText(first: string | null, second: string | null): string | null {
  if (first === null) return second;
  if (second === null || first.includes(second)) return first;
  return `${first}\n${second}`;
}

/** A reply may cite the candidate rules' own citations and any article text it was given. */
function allowedCitations(candidates: Rule[], articles: ArticleText[]): Set<string> {
  return new Set([
    ...candidates.flatMap((rule) => rule.articles),
    ...articles.map((article) => article.citation),
  ]);
}

/** The analyser's citations without duplicates, or the rule's own when it cited none. */
function citedOrRuleArticles(cited: string[], rule: Rule): string[] {
  return cited.length > 0 ? [...new Set(cited)] : rule.articles;
}
