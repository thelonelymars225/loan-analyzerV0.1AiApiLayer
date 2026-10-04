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

/** The full score of one view. Market fairness has no salary data in v1, so its confidence is low. */
export function scoreFindings(findings: Finding[], view: View): Score {
  const sub = subScores(findings);
  return { ...sub, ...overallFor(sub, view), view, marketConfidence: "low" };
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

/** Weighted overall score for a view (VIEW_WEIGHTS, in percent) and its band. */
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
