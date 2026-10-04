import type {
  Clause,
  Finding,
  Rule,
  RulesFile,
  Score,
  Versions,
  View,
} from "@rater/contracts";
import type { LlmClient } from "@rater/llm";
import { detectQiwa } from "./detect";
import { addUsage, ZERO_USAGE } from "./engine/verdicts";
import { attachArabicOcr, extractContract } from "./extract";
import { applyImpact } from "./impact";
import { buildRedactionContext, redactClauses } from "./redact";
import { runFieldRules } from "./rules";
import { scoreFindings } from "./score";
import { analyseSection15, crossCheckSection15 } from "./section15";
import type {
  AnalysedFinding,
  ArticleLookup,
  ClauseCache,
  ExtractionIssue,
  ExtractionResult,
  PageLayout,
  PageRegion,
  PipelineResult,
  StepVersions,
} from "./types";

export interface PipelineInput {
  pages: PageLayout[];
  /** OCR for the Arabic Section 15 regions. Optional: without it the English text is analysed alone. */
  ocrArabic?: (regions: PageRegion[]) => Promise<string>;
  rules: RulesFile;
  llm: LlmClient;
  articles: ArticleLookup;
  cache: ClauseCache;
  /** Today's date (YYYY-MM-DD), for deadlines. */
  today: string;
}

/**
 * The whole rating, steps 1-6: detect → extract → Arabic OCR → redact → field rules →
 * Section 15 → cross-check → impact → score both views. Pure apart from the injected
 * OCR, analyser, article lookup and cache.
 */
export async function runPipeline(input: PipelineInput): Promise<PipelineResult> {
  const { llm, rules } = input;
  const versions: Versions = {
    law: rules.lawVersion,
    ruleset: rules.rulesetVersion,
    prompt: llm.promptVersion,
    model: llm.model,
  };

  const detection = detectQiwa(input.pages);
  if (!detection.ok) {
    return {
      status: "rejected",
      rejectReason: detection.reason,
      extraction: null,
      findings: [],
      deadlines: [],
      // Nothing was rated: these are the scores of no findings, and the worker ignores them.
      scores: scoreBothViews([]),
      versions,
      usage: ZERO_USAGE,
    };
  }

  const extraction = extractContract(input.pages);
  const ocr = await addArabicText(extraction, input.ocrArabic);
  // Only redacted text goes to the analyser, the cache and the stored result.
  const clauses = redactClauses(ocr.clauses, buildRedactionContext(extraction));
  const issues = ocr.issue ? [...extraction.issues, ocr.issue] : extraction.issues;
  const { fields } = extraction;

  const field = runFieldRules(fields, rules.rules, { today: input.today });
  const stepVersions: StepVersions = {
    law: rules.lawVersion,
    ruleset: rules.rulesetVersion,
  };
  const stepInput = {
    clauses,
    fields,
    rules: rules.rules,
    llm,
    articles: input.articles,
    cache: input.cache,
    versions: stepVersions,
  };
  const [section15, crossCheck] = await Promise.all([
    analyseSection15(stepInput),
    crossCheckSection15(stepInput),
  ]);

  const analysed = [
    ...withImpactKinds(field.findings, rules.rules),
    ...section15.findings,
    ...crossCheck.findings,
  ];
  const findings = applyImpact(analysed, fields);
  const needsReview =
    extraction.needsReview || findings.some((finding) => finding.needsReview);

  return {
    status: needsReview ? "needs_review" : "done",
    extraction: withoutIdentifyingStrings({ ...extraction, clauses, issues }),
    findings,
    deadlines: field.deadlines,
    scores: scoreBothViews(findings),
    versions,
    usage: addUsage(section15.usage, crossCheck.usage),
  };
}

/**
 * Merges Arabic OCR of Section 15 into the clauses. OCR is best effort: when it is missing,
 * finds nothing or fails, the English text is analysed alone (a failure is noted as an issue).
 */
async function addArabicText(
  extraction: ExtractionResult,
  ocrArabic: PipelineInput["ocrArabic"],
): Promise<{ clauses: Clause[]; issue: ExtractionIssue | null }> {
  const { clauses, section15ArabicRegions: regions } = extraction;
  if (!ocrArabic || clauses.length === 0 || regions.length === 0) {
    return { clauses, issue: null };
  }
  try {
    const text = await ocrArabic(regions);
    return {
      clauses: text.trim() ? attachArabicOcr(clauses, text) : clauses,
      issue: null,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      clauses,
      issue: { field: "section15.textAr", message: `Arabic OCR failed: ${reason}` },
    };
  }
}

/** Field findings carry their rule's impact formula too (LEAVE-MIN-01 → leave_value). */
function withImpactKinds(findings: Finding[], rules: Rule[]): AnalysedFinding[] {
  const impactByRule = new Map(rules.map((rule) => [rule.id, rule.impact]));
  return findings.map((finding) => ({
    ...finding,
    impactKind: impactByRule.get(finding.ruleId),
  }));
}

/** Names exist only to build the redaction context; they never leave the pipeline. */
function withoutIdentifyingStrings(extraction: ExtractionResult): ExtractionResult {
  const { namePlaceholders: _names, ...rest } = extraction;
  return { ...rest, identifyingStrings: [] };
}

function scoreBothViews(findings: Finding[]): Record<View, Score> {
  return {
    employee: scoreFindings(findings, "employee"),
    hr: scoreFindings(findings, "hr"),
  };
}
