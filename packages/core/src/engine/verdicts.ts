import type { Severity, Verdict } from "@rater/contracts";
import type { LlmUsage } from "@rater/llm";

/** Verdicts that count as a problem: they lower the score and show under "findings". */
const PROBLEM_VERDICTS: ReadonlySet<Verdict> = new Set([
  "likely_void",
  "conflict",
  "worse_than_default",
  "unclear",
]);

export function isProblemVerdict(verdict: Verdict): boolean {
  return PROBLEM_VERDICTS.has(verdict);
}

/** Sort rank: most severe first. */
export const SEVERITY_RANK: Record<Severity, number> = {
  high: 0,
  medium: 1,
  low: 2,
  none: 3,
};

/** HR sort rank within a severity: the verdicts most likely to end in a dispute come first. */
export const LEGAL_RISK_RANK: Record<Verdict, number> = {
  likely_void: 0,
  conflict: 1,
  worse_than_default: 2,
  unclear: 3,
  compliant: 4,
  better_than_law: 5,
};

/** Rule ID of the finding raised when the analyser fails twice on the same input. */
export const REVIEW_RULE_ID = "REVIEW-00";

export const ZERO_USAGE: LlmUsage = { inputTokens: 0, outputTokens: 0 };

export function addUsage(a: LlmUsage, b: LlmUsage): LlmUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  };
}
