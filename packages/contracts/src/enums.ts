import { z } from "zod";

/** What a finding says about a clause or field, relative to the law. */
export const Verdict = z.enum([
  "likely_void",
  "worse_than_default",
  "conflict",
  "compliant",
  "better_than_law",
  "unclear",
]);
export type Verdict = z.infer<typeof Verdict>;

export const Severity = z.enum(["high", "medium", "low", "none"]);
export type Severity = z.infer<typeof Severity>;

export const Confidence = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof Confidence>;

/** The two report views. Same findings, different framing and weights. */
export const View = z.enum(["employee", "hr"]);
export type View = z.infer<typeof View>;

export const RatingStatus = z.enum([
  "queued",
  "extracting",
  "analysing",
  "done",
  "failed",
  "needs_review",
]);
export type RatingStatus = z.infer<typeof RatingStatus>;

/** The three sub-scores. */
export const ScoreCategory = z.enum(["legal", "market", "clarity"]);
export type ScoreCategory = z.infer<typeof ScoreCategory>;

export const Band = z.enum(["Good", "Fair", "Weak", "Poor"]);
export type Band = z.infer<typeof Band>;

export const OrgKind = z.enum(["personal", "company"]);
export type OrgKind = z.infer<typeof OrgKind>;

export const OrgRole = z.enum(["owner", "admin", "member"]);
export type OrgRole = z.infer<typeof OrgRole>;

/** Where a finding came from in the pipeline. */
export const FindingSource = z.enum(["field_rule", "clause", "cross_check", "info", "market"]);
export type FindingSource = z.infer<typeof FindingSource>;
