import { createHash } from "node:crypto";
import { Rule } from "@rater/contracts";
import type {
  ArticleRef,
  Clause,
  ContractFields,
  LawArticle,
  RuleInput,
  RulesFile,
} from "@rater/contracts";
import type {
  ClauseAnalysisRequest,
  CrossCheckRequest,
  LlmClient,
  LlmReply,
} from "@rater/llm";
import type { ArticleLookup } from "../../src/types";

/*
 * Synthetic fixtures for the engine tests. Rules are shaped like the spec's rules table;
 * the contract values are made up (calibration numbers only, no real contract text).
 */

type RuleSpec = Pick<RuleInput, "id" | "kind" | "categories" | "severityIfFail"> &
  Partial<RuleInput>;

function rule(spec: RuleSpec): Rule {
  return Rule.parse({
    title: `${spec.id} title`,
    articles: [],
    employeeMsg: `${spec.id} employee message.`,
    hrMsg: `${spec.id} HR message.`,
    verified: true,
    ...spec,
  });
}

const labor = (article: string, paragraph?: string): ArticleRef =>
  paragraph
    ? { source: "labor_law", article, paragraph }
    : { source: "labor_law", article };

export const RULES: Rule[] = [
  rule({
    id: "PROB-MAX-01",
    kind: "field",
    title: "Probation of 180 days or less",
    categories: ["legal"],
    severityIfFail: "high",
    detect: "Section 15 extending probation beyond 180 days",
    articles: ["Art. 53"],
    articleRefs: [labor("53")],
    employeeMsg: "Your probation is longer than {limit} days.",
    askFor: "Ask for 180 days or less.",
    suggestedWording: "Probation of [N] days, at most 180.",
    goodMsg: "Your probation of {value} days is within the {limit}-day maximum.",
  }),
  rule({
    id: "PROB-EXCL-01",
    kind: "field",
    title: "Only the permitted days pause probation",
    categories: ["legal"],
    severityIfFail: "medium",
    articles: ["Art. 53"],
    goodMsg: "Only the permitted days pause your probation.",
  }),
  rule({
    id: "PROB-NOCOMP-01",
    kind: "info",
    categories: ["legal"],
    severityIfFail: "none",
    articles: ["Art. 54"],
    employeeMsg: "No compensation if probation ends the contract.",
  }),
  rule({
    id: "LEAVE-MIN-01",
    kind: "field",
    title: "At least 21 days' annual leave",
    categories: ["legal"],
    severityIfFail: "high",
    impact: "leave_value",
    detect: "Section 15 reducing annual leave",
    articles: ["Art. 109"],
    articleRefs: [labor("109", "1")],
    employeeMsg: "Your leave of {value} days is below the minimum.",
    askFor: "Ask for at least 21 days.",
    goodMsg: "You get {value} days of annual leave a year.",
  }),
  rule({
    id: "LEAVE-FORFEIT-01",
    kind: "clause",
    categories: ["legal"],
    severityIfFail: "medium",
    detect: "Clause forfeiting untaken leave",
    articles: ["Arts. 109-111", "Art. 8"],
    articleRefs: [labor("111"), labor("8")],
  }),
  rule({
    id: "HOURS-MAX-01",
    kind: "field",
    title: "Normal hours within 8 a day and 48 a week",
    categories: ["legal"],
    severityIfFail: "high",
    detect: "Section 15 raising hours",
    articles: ["Art. 98"],
    articleRefs: [labor("98")],
    goodMsg: "Your normal week is {value} hours.",
  }),
  rule({
    id: "OT-RATE-01",
    kind: "field",
    title: "Overtime at the hourly wage plus 50% of basic",
    categories: ["legal"],
    severityIfFail: "high",
    detect: "Section 15 overtime below 50% or time off in lieu without consent",
    articles: ["Art. 107"],
    articleRefs: [labor("107")],
    goodMsg: "Overtime pays {value}% on top of the hourly wage.",
  }),
  rule({
    id: "EOS-BASE-01",
    kind: "clause",
    title: "End-of-service award on the actual wage",
    categories: ["legal"],
    severityIfFail: "high",
    impact: "eos_gap",
    detect: "End-of-service on basic salary only",
    articles: ["Art. 2", "Art. 84", "Art. 8"],
    articleRefs: [labor("2"), labor("84"), labor("8")],
    employeeMsg: "Likely void: end-of-service uses your actual wage.",
    hrMsg: "Likely void. Base the award on the actual wage.",
    askFor: "Ask for the award on your actual wage.",
    suggestedWording: "The award is calculated on the last actual wage.",
  }),
  rule({
    id: "COMP-ART77-01",
    kind: "clause",
    categories: ["market"],
    severityIfFail: "medium",
    impact: "art77_gap",
    detect: "Fixed compensation for termination without a valid reason",
    articles: ["Art. 77"],
    articleRefs: [labor("77")],
  }),
  rule({
    id: "TYPE-CONFLICT-01",
    kind: "cross",
    title: "Section 15 contradicts the contract type",
    categories: ["legal", "clarity"],
    severityIfFail: "high",
    detect: "Section 15 statement about duration that contradicts Section 1",
    articles: ["Contract cl. 14.5", "Art. 74"],
    articleRefs: [{ source: "qiwa_template", article: "14.5" }, labor("74")],
  }),
  rule({
    id: "TYPE-ART57-01",
    kind: "clause",
    categories: ["clarity"],
    severityIfFail: "high",
    detect: "Contract tied to an undefined project",
    articles: ["Art. 57"],
    articleRefs: [labor("57")],
  }),
  rule({
    id: "RENEW-CONVERT-01",
    kind: "info",
    categories: ["legal"],
    severityIfFail: "none",
    articles: ["Art. 55(2)"],
  }),
  rule({
    id: "RENEW-DEADLINE-01",
    kind: "field",
    categories: ["clarity"],
    severityIfFail: "none",
    articles: ["Contract cl. 5.1"],
    employeeMsg: "Give notice on Qiwa by {deadline}.",
    hrMsg: "Non-renewal notice is due by {deadline}.",
  }),
  rule({
    id: "NOTICE-INDEF-01",
    kind: "info",
    categories: ["legal"],
    severityIfFail: "none",
    articles: ["Art. 75", "Art. 76"],
  }),
  rule({
    id: "TRANSFER-KSA-01",
    kind: "clause",
    categories: ["market"],
    severityIfFail: "medium",
    detect: "Transfer anywhere in the Kingdom",
    articles: ["Art. 58", "Exec. Reg. Art. 20"],
    articleRefs: [labor("58"), { source: "implementing_regulations", article: "20" }],
  }),
  rule({
    id: "NONCOMPETE-01",
    kind: "clause",
    categories: ["legal"],
    severityIfFail: "high",
    detect: "Post-employment non-compete",
    articles: ["Art. 83(1)"],
    articleRefs: [labor("83", "1")],
  }),
  rule({
    id: "CONFIDENTIAL-01",
    kind: "clause",
    categories: ["clarity"],
    severityIfFail: "low",
    detect: "Unlimited post-employment confidentiality",
    articles: ["Art. 83(2)"],
    articleRefs: [labor("83", "2")],
  }),
  rule({
    id: "SETTLE-TIME-01",
    kind: "info",
    categories: ["legal"],
    severityIfFail: "none",
    articles: ["Art. 88"],
  }),
  rule({
    id: "MARKET-ALLOW-01",
    kind: "market",
    title: "Housing and transport allowances vs market norm",
    categories: ["market"],
    severityIfFail: "low",
    confidence: "medium",
    employeeMsg: "Your allowances are {position} the usual split.",
    hrMsg: "The allowance split is {position} the market convention.",
    askFor: "Ask for housing at 25% and transport at 10% of basic.",
    goodMsg: "Your allowances are {position} the usual split.",
  }),
];

export const RULES_FILE: RulesFile = {
  rulesetVersion: "0.1.0",
  lawVersion: "2025-11",
  rules: RULES,
};

export function ruleById(id: string): Rule {
  const found = RULES.find((r) => r.id === id);
  if (!found) throw new Error(`No fixture rule ${id}`);
  return found;
}

export const TODAY = "2026-10-03";

/** Test #1 calibration values (synthetic dates). */
export function test1Fields(overrides: Partial<ContractFields> = {}): ContractFields {
  return {
    contractType: "fixed_term",
    contractTypeRaw: "Fixed-term Contract",
    executionDate: "2026-01-04",
    commencementDate: "2026-01-11",
    endDate: "2027-01-10",
    termMonths: 12,
    autoRenew: true,
    renewalNoticeDays: 30,
    probationDays: 180,
    probationExcludedDays: [
      "eid_al_fitr",
      "eid_al_adha",
      "national_day",
      "foundation_day",
      "sick_leave",
    ],
    workDaysPerWeek: 5,
    dailyHours: 8,
    weeklyHours: 40,
    restDaysPerWeek: 2,
    annualLeaveDays: 22,
    wage: { basic: 10000, housing: 2500, transport: 1000, other: 0, total: 13500 },
    overtimePremiumPct: 50,
    nationality: "saudi",
    occupation: "Software Developer",
    workLocation: "Riyadh",
    ...overrides,
  };
}

export function clause(
  number: string,
  textEn: string,
  textAr: string | null = null,
): Clause {
  const textHash = createHash("sha256")
    .update(textEn.toLowerCase().replace(/\s+/g, " ").trim())
    .digest("hex");
  return { section: 15, number, textEn, textAr, textHash };
}

/** Section 15 of test #1, in the spec's synthetic clause-library wording. */
export const TEST1_CLAUSES: Clause[] = [
  clause(
    "15.1",
    "This contract is for an unlimited period and ends upon completion of the project in accordance with Article 57 of the Labor Law.",
  ),
  clause(
    "15.2",
    "The employee shall not disclose any information about the employer's business at any time, during or after employment.",
  ),
  clause(
    "15.3",
    "The employer may transfer the employee to any of its branches or projects anywhere in the Kingdom.",
  ),
  clause(
    "15.4",
    "If either party terminates this contract before its expiry without a valid reason, it shall pay the other party compensation equal to two months of basic wage.",
  ),
  clause(
    "15.5",
    "Annual leave must be taken within the same calendar year and may not be carried forward.",
  ),
  clause(
    "15.6",
    "The end-of-service award shall be calculated on the basis of the basic salary only.",
  ),
  clause("15.7", "This contract supersedes all prior agreements between the parties."),
];

// ---------------------------------------------------------------------------------------------
// Analyser replies
// ---------------------------------------------------------------------------------------------

export function match(
  ruleId: string,
  verdict: string,
  severity: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ruleId,
    verdict,
    severity,
    confidence: "high",
    articles: RULES.find((r) => r.id === ruleId)?.articles ?? [],
    explanation: `${ruleId} explanation.`,
    ...extra,
  };
}

export function analysis(
  number: string,
  ...matches: Record<string, unknown>[]
): Record<string, unknown> {
  return { clause: number, matches };
}

/** The analyser's test #1 answers, per clause. */
export const TEST1_REPLIES: Record<string, unknown[]> = {
  "15.1": [analysis("15.1", match("TYPE-ART57-01", "unclear", "high"))],
  "15.2": [analysis("15.2", match("CONFIDENTIAL-01", "unclear", "low"))],
  "15.3": [analysis("15.3", match("TRANSFER-KSA-01", "worse_than_default", "medium"))],
  "15.4": [
    analysis(
      "15.4",
      match("COMP-ART77-01", "worse_than_default", "medium", {
        impactParams: { compensationMonths: 2, compensationBase: "basic" },
      }),
    ),
  ],
  "15.5": [analysis("15.5", match("LEAVE-FORFEIT-01", "unclear", "low"))],
  "15.6": [
    analysis(
      "15.6",
      match("EOS-BASE-01", "likely_void", "high", { impactParams: { eosBase: "basic" } }),
    ),
  ],
  "15.7": [analysis("15.7")],
};

export const TEST1_CROSS: unknown[] = [
  {
    conflicts: [
      {
        ruleId: "TYPE-CONFLICT-01",
        clause: "15.1",
        templateClause: "1",
        severity: "high",
        confidence: "high",
        articles: ["Contract cl. 14.5", "Art. 74"],
        explanation: "Section 1 says fixed-term; 15.1 says unlimited period.",
      },
    ],
  },
];

/** A reply, a function of the request, or an Error to throw. */
type Scripted = unknown;

const USAGE = { inputTokens: 100, outputTokens: 20 };

/**
 * Scripted analyser. Replies are queued per clause number (and one queue for the cross-check);
 * each call takes the next reply and the last one repeats. Unscripted clauses get "no match".
 */
export class FakeLlmClient implements LlmClient {
  readonly model = "fake-model-1";
  readonly promptVersion = "fake-prompt-v1";
  readonly clauseRequests: ClauseAnalysisRequest[] = [];
  readonly crossRequests: CrossCheckRequest[] = [];
  private readonly clauseReplies: Record<string, Scripted[]>;
  private readonly crossReplies: Scripted[];

  constructor(script: { clauses?: Record<string, Scripted[]>; cross?: Scripted[] } = {}) {
    this.clauseReplies = Object.fromEntries(
      Object.entries(script.clauses ?? {}).map(([number, replies]) => [
        number,
        [...replies],
      ]),
    );
    this.crossReplies = [...(script.cross ?? [])];
  }

  async analyzeClause(req: ClauseAnalysisRequest): Promise<LlmReply> {
    this.clauseRequests.push(req);
    const queue = this.clauseReplies[req.clause.number];
    return reply(queue ? next(queue) : analysis(req.clause.number));
  }

  async crossCheck(req: CrossCheckRequest): Promise<LlmReply> {
    this.crossRequests.push(req);
    return reply(
      this.crossReplies.length > 0 ? next(this.crossReplies) : { conflicts: [] },
    );
  }
}

function next(queue: Scripted[]): Scripted {
  return queue.length > 1 ? queue.shift() : queue[0];
}

function reply(scripted: Scripted): LlmReply {
  if (scripted instanceof Error) throw scripted;
  return { json: scripted, usage: USAGE };
}

// ---------------------------------------------------------------------------------------------
// Law corpus
// ---------------------------------------------------------------------------------------------

export function lawArticle(
  source: LawArticle["source"],
  article: string,
  paragraph: string | null = null,
): LawArticle {
  return {
    lawVersion: "2025-11",
    source,
    article,
    paragraph,
    textAr: `نص المادة ${article}`,
    textEnUnofficial: `Text of article ${article}${paragraph ? `(${paragraph})` : ""}.`,
    sourceUrl: null,
    effectiveFrom: null,
    effectiveTo: null,
  };
}

/** A tiny corpus: one chunk for every reference in the fixture rules, plus Art. 65(6). */
export const CORPUS: LawArticle[] = [
  ...new Map(
    RULES.flatMap((r) => r.articleRefs).map((ref) => [
      `${ref.source}|${ref.article}|${ref.paragraph ?? ""}`,
      lawArticle(ref.source, ref.article, ref.paragraph ?? null),
    ]),
  ).values(),
  lawArticle("labor_law", "65", "6"),
];

/** Rule-first lookup over CORPUS; search returns whatever the test sets. */
export class FakeArticleLookup implements ArticleLookup {
  searchResults: LawArticle[] = [];
  readonly searches: string[] = [];

  async byRefs(refs: ArticleRef[]): Promise<LawArticle[]> {
    return CORPUS.filter((a) =>
      refs.some(
        (ref) =>
          ref.source === a.source &&
          ref.article === a.article &&
          (ref.paragraph === undefined || ref.paragraph === a.paragraph),
      ),
    );
  }

  async search(text: string, k: number): Promise<LawArticle[]> {
    this.searches.push(text);
    return this.searchResults.slice(0, k);
  }
}
