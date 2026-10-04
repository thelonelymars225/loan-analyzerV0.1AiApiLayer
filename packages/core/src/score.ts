import { VIEW_WEIGHTS } from "@rater/contracts";
import type {
  Band,
  Finding,
  Score,
  ScoreCategory,
  Severity,
  SubScores,
  View,
} from "@rater/contracts";
import { isProblemVerdict } from "./engine/verdicts";

/*
 * Step 6: Legal / Market / Clarity sub-scores and the overall score per view.
 * Calibrated on test #1 (employee ≈ 64, HR ≈ 61); a clean contract scores 100.
 * The overall score is then capped when serious legal problems exist (see OVERALL_CAPS).
 */

/** Points a problem finding takes off every category it counts against. */
export const SEVERITY_PENALTY: Record<Severity, number> = {
  high: 20,
  medium: 8,
  low: 3,
  none: 0,
};

/** Points a better-than-the-law finding adds to its primary category. */
export const BETTER_THAN_LAW_BONUS = 2;

const CATEGORIES: readonly ScoreCategory[] = ["legal", "market", "clarity"];

/** Lower bound of each band, best first. */
const BANDS: readonly { min: number; band: Band }[] = [
  { min: 80, band: "Good" },
  { min: 60, band: "Fair" },
  { min: 40, band: "Weak" },
  { min: 0, band: "Poor" },
];

/**
 * Caps on the overall score, counted over serious legal problems: high-severity findings the
 * law likely voids or that contradict the rest of the contract. The weighted average alone can
 * stay high with one such clause, because it costs only its own category; a contract with a
 * void high-severity clause should never read "Good". The first cap that applies wins.
 */
const OVERALL_CAPS: readonly { seriousProblems: number; cap: number }[] = [
  { seriousProblems: 3, cap: 59 }, // three or more: "Weak" at best
  { seriousProblems: 1, cap: 79 }, // one or two: "Fair" at best
];

/**
 * The full score of one view: weighted sub-scores, capped by OVERALL_CAPS in both views.
 * Market fairness has no salary data in v1, so its confidence is low.
 */
export function scoreFindings(findings: Finding[], view: View): Score {
  const sub = subScores(findings);
  const overall = Math.min(overallFor(sub, view).overall, overallCap(findings));
  return { ...sub, overall, band: bandFor(overall), view, marketConfidence: "low" };
}

/** The highest overall score the findings allow: 100 unless OVERALL_CAPS applies. */
export function overallCap(findings: Finding[]): number {
  const serious = findings.filter(isSeriousLegalProblem).length;
  return OVERALL_CAPS.find((entry) => serious >= entry.seriousProblems)?.cap ?? 100;
}

function isSeriousLegalProblem(finding: Finding): boolean {
  return (
    finding.source !== "info" &&
    finding.severity === "high" &&
    (finding.verdict === "likely_void" || finding.verdict === "conflict")
  );
}

/**
 * Each sub-score starts at 100. A problem finding subtracts its severity penalty from every
 * category it lists; a better-than-the-law finding adds a small bonus to its first category.
 * Info findings never count. The result is clamped to 0..100.
 */
export function subScores(findings: Finding[]): SubScores {
  const scores: SubScores = { legal: 100, market: 100, clarity: 100 };
  for (const finding of findings) {
    if (finding.source === "info") continue;
    if (isProblemVerdict(finding.verdict)) {
      for (const category of finding.categories) {
        scores[category] -= SEVERITY_PENALTY[finding.severity];
      }
    } else if (finding.verdict === "better_than_law") {
      const primary = finding.categories[0];
      if (primary) scores[primary] += BETTER_THAN_LAW_BONUS;
    }
  }
  for (const category of CATEGORIES) {
    scores[category] = clamp(scores[category]);
  }
  return scores;
}

/** Weighted overall score for a view (VIEW_WEIGHTS, in percent) and its band, before any cap. */
export function overallFor(sub: SubScores, view: View): { overall: number; band: Band } {
  const weights = VIEW_WEIGHTS[view];
  const weighted = CATEGORIES.reduce(
    (sum, category) => sum + weights[category] * sub[category],
    0,
  );
  const overall = clamp(Math.round(weighted / 100));
  return { overall, band: bandFor(overall) };
}

export function bandFor(overall: number): Band {
  return BANDS.find((entry) => overall >= entry.min)?.band ?? "Poor";
}

function clamp(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}
