import type { Band, OrgKind, RatingStatus, View } from "@rater/contracts";

/** Pipeline steps in the order a rating moves through them. */
export const PIPELINE_STEPS = ["queued", "extracting", "analysing", "done"] as const;

const IN_PROGRESS: ReadonlySet<RatingStatus> = new Set([
  "queued",
  "extracting",
  "analysing",
]);

export function isInProgress(status: RatingStatus | undefined): boolean {
  return status !== undefined && IN_PROGRESS.has(status);
}

/** Percentage shown on the progress bar while a rating runs. */
export function progressPercent(status: RatingStatus): number {
  const index = PIPELINE_STEPS.indexOf(status as (typeof PIPELINE_STEPS)[number]);
  if (index < 0) return 100;
  return Math.round(((index + 1) / PIPELINE_STEPS.length) * 100);
}

/** How often a page re-reads ratings that are still running. */
export const POLL_MS = 3_000;

/** Same bands as the scorer: 80+ Good, 60-79 Fair, 40-59 Weak, under 40 Poor. */
export function bandForScore(score: number): Band {
  if (score >= 80) return "Good";
  if (score >= 60) return "Fair";
  if (score >= 40) return "Weak";
  return "Poor";
}

/** Personal workspaces rate from the employee's side, company workspaces from HR's. */
export function defaultViewFor(kind: OrgKind | undefined): View {
  return kind === "company" ? "hr" : "employee";
}
