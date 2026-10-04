import type {
  Band,
  RatingStatus,
  Severity,
  Verdict,
  ViewFinding,
} from "@rater/contracts";

/** Visual tone of a badge or chip. Status tones always sit next to a text label. */
export type Tone = "neutral" | "info" | "good" | "warning" | "serious" | "critical";

export const VERDICT_TONE: Record<Verdict, Tone> = {
  likely_void: "critical",
  conflict: "critical",
  worse_than_default: "serious",
  unclear: "warning",
  compliant: "good",
  better_than_law: "good",
};

export const SEVERITY_TONE: Record<Severity, Tone> = {
  high: "critical",
  medium: "serious",
  low: "warning",
  none: "neutral",
};

export const BAND_TONE: Record<Band, Tone> = {
  Good: "good",
  Fair: "warning",
  Weak: "serious",
  Poor: "critical",
};

export const STATUS_TONE: Record<RatingStatus, Tone> = {
  queued: "neutral",
  extracting: "info",
  analysing: "info",
  done: "good",
  failed: "critical",
  needs_review: "warning",
};

/**
 * Column order for each impact kind (see Impact in @rater/contracts). Unknown kinds fall back
 * to the keys as they arrive, so a new formula still renders.
 */
const IMPACT_COLUMNS: Record<string, string[]> = {
  eos_gap: ["1y", "5y", "10y"],
  art77_gap: ["contract", "default", "gap"],
  leave_value: ["perYear"],
};

export function impactColumns(
  kind: string | null,
  sar: Record<string, number>,
): string[] {
  const known = kind ? IMPACT_COLUMNS[kind] : undefined;
  if (!known) return Object.keys(sar);
  return known.filter((key) => key in sar);
}

/** The HR view leads with clauses a court would likely not enforce. */
export function likelyVoidFindings(findings: ViewFinding[]): ViewFinding[] {
  return findings.filter((finding) => finding.verdict === "likely_void");
}

/** Stable DOM id for a finding card, so the HR summary can link to it. */
export function findingAnchor(finding: Pick<ViewFinding, "ruleId" | "clause">): string {
  const clause = finding.clause ? `-${finding.clause.replace(/[^A-Za-z0-9]/g, "-")}` : "";
  return `finding-${finding.ruleId}${clause}`;
}
