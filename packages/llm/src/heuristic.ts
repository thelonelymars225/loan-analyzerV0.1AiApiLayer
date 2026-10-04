import type {
  ClauseAnalysis,
  ClauseMatch,
  Confidence,
  CrossCheckResult,
  CrossConflict,
} from "@rater/contracts";
import { glossArabic } from "./heuristic/arabic";
import {
  recordedContractType,
  TYPE_CONFLICT_RULE_ID,
  typeConflict,
} from "./heuristic/cross-check";
import type { ClauseStatement } from "./heuristic/cross-check";
import type { ClauseText, Detection } from "./heuristic/detection";
import { CLAUSE_DETECTORS } from "./heuristic/detectors";
import { normaliseEnglish } from "./heuristic/text";
import { PROMPT_VERSION } from "./prompts";
import type {
  CandidateRule,
  ClauseAnalysisRequest,
  CrossCheckRequest,
  LlmClient,
  LlmReply,
  LlmUsage,
} from "./types";

/** Name stored as the "model" of ratings made offline. Bump it when detector behaviour changes. */
export const HEURISTIC_MODEL = "heuristic-v1";

const NO_USAGE: LlmUsage = { inputTokens: 0, outputTokens: 0 };

/**
 * Offline, deterministic stand-in for the language model: keyword and pattern detectors, one per
 * rule ID. It lets the whole pipeline, the tests and the evals run without an API key. It reads
 * only the request (never the network), matches only the request's candidate rules, and cites
 * only the matched rule's own articles, so its replies pass the engine's validation.
 */
export class HeuristicLlmClient implements LlmClient {
  readonly model = HEURISTIC_MODEL;
  readonly promptVersion = PROMPT_VERSION;

  async analyzeClause(req: ClauseAnalysisRequest): Promise<LlmReply> {
    return { json: analyseClauseOffline(req), usage: NO_USAGE };
  }

  async crossCheck(req: CrossCheckRequest): Promise<LlmReply> {
    return { json: crossCheckOffline(req), usage: NO_USAGE };
  }
}

/** Step 4b offline: which candidate rules one clause touches, with a verdict for each. */
export function analyseClauseOffline(req: ClauseAnalysisRequest): ClauseAnalysis {
  const reading = readClause(req.clause);
  if (!reading) return { clause: req.clause.number, matches: [] };

  const clause: ClauseText = {
    text: reading.text,
    probationDays: probationDaysIn(req.fieldSummary),
  };
  const matches = uniqueRules(req.candidateRules).flatMap((rule) => {
    const detection = CLAUSE_DETECTORS.get(rule.id)?.(clause);
    return detection ? [toMatch(rule, detection, reading.maxConfidence)] : [];
  });
  return { clause: req.clause.number, matches };
}

/** Step 4c offline: Section 15 clauses that state a contract type sections 1-14 contradict. */
export function crossCheckOffline(req: CrossCheckRequest): CrossCheckResult {
  const rule = req.candidateRules.find(
    (candidate) => candidate.id === TYPE_CONFLICT_RULE_ID,
  );
  const recorded = recordedContractType(req.fieldSummary);
  if (!rule || !recorded) return { conflicts: [] };

  const conflicts: CrossConflict[] = [];
  for (const clause of req.clauses) {
    const reading = readClause(clause);
    if (!reading) continue;
    const statement: ClauseStatement = {
      number: clause.number,
      text: reading.text,
      confidence: reading.maxConfidence,
    };
    const conflict = typeConflict(statement, recorded, rule.articles);
    if (conflict) conflicts.push(conflict);
  }
  return { conflicts };
}

interface ClauseReading {
  text: string;
  /** Arabic read through a gloss is less certain than English. */
  maxConfidence: Confidence;
}

/**
 * The text the detectors read. English is used when present: it is extracted from the PDF text
 * layer, while the Arabic comes from OCR. (The Claude prompt applies the rule that the Arabic
 * prevails when the two differ.) Arabic is used only when there is no English.
 */
function readClause(clause: {
  textEn: string;
  textAr: string | null;
}): ClauseReading | null {
  const english = normaliseEnglish(clause.textEn);
  if (english !== "") return { text: english, maxConfidence: "high" };
  const arabic = clause.textAr?.trim() ?? "";
  if (arabic !== "") return { text: glossArabic(arabic), maxConfidence: "medium" };
  return null;
}

/** Probation days in sections 1-14, from the field summary ("Probation: 90 days."). */
function probationDaysIn(fieldSummary: string): number | null {
  const match = /probation:\s*(\d+)\s*days/i.exec(fieldSummary);
  return match ? Number(match[1]) : null;
}

function uniqueRules(rules: CandidateRule[]): CandidateRule[] {
  const seen = new Set<string>();
  return rules.filter((rule) => !seen.has(rule.id) && seen.add(rule.id));
}

const CONFIDENCE_ORDER: Confidence[] = ["low", "medium", "high"];

function toMatch(
  rule: CandidateRule,
  detection: Detection,
  maxConfidence: Confidence,
): ClauseMatch {
  const confidence =
    CONFIDENCE_ORDER.indexOf(detection.confidence) <=
    CONFIDENCE_ORDER.indexOf(maxConfidence)
      ? detection.confidence
      : maxConfidence;
  return {
    ruleId: rule.id,
    verdict: detection.verdict,
    severity: detection.severity,
    confidence,
    articles: [...rule.articles],
    explanation: detection.explanation,
    ...(detection.impactParams ? { impactParams: detection.impactParams } : {}),
  };
}
