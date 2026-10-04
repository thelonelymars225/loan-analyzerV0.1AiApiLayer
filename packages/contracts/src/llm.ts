import { z } from "zod";
import { Confidence, Severity, Verdict } from "./enums";

/**
 * Parameters the analyser reads out of a clause so plain code can compute SAR impact.
 * All optional: only the ones the clause actually states.
 */
export const ImpactParams = z.object({
  /** What the clause bases end-of-service on. */
  eosBase: z.enum(["basic", "actual", "other"]).optional(),
  /** Fixed compensation in months of wage, e.g. 2 for "two months' basic wage". */
  compensationMonths: z.number().nonnegative().optional(),
  /** What the compensation months are measured on. */
  compensationBase: z.enum(["basic", "actual"]).optional(),
  /** Non-compete duration in months, if stated. */
  nonCompeteMonths: z.number().nonnegative().optional(),
});
export type ImpactParams = z.infer<typeof ImpactParams>;

/** One rule a Section 15 clause touches, as returned by the analyser (step 4b). */
export const ClauseMatch = z.object({
  ruleId: z.string(),
  verdict: Verdict,
  severity: Severity,
  confidence: Confidence,
  /** Must be a subset of the articles provided in the request. */
  articles: z.array(z.string()),
  explanation: z.string().min(1),
  impactParams: ImpactParams.optional(),
});
export type ClauseMatch = z.infer<typeof ClauseMatch>;

/** The analyser's JSON reply for one clause. An empty `matches` means no rule applies. */
export const ClauseAnalysis = z.object({
  clause: z.string(),
  matches: z.array(ClauseMatch),
});
export type ClauseAnalysis = z.infer<typeof ClauseAnalysis>;

/** One contradiction between Section 15 and sections 1-14 (step 4c). */
export const CrossConflict = z.object({
  ruleId: z.string(),
  /** The Section 15 clause, e.g. "15.1". */
  clause: z.string(),
  /** The template clause it contradicts, e.g. "1" or "5.1". */
  templateClause: z.string(),
  severity: Severity,
  confidence: Confidence,
  articles: z.array(z.string()),
  explanation: z.string().min(1),
});
export type CrossConflict = z.infer<typeof CrossConflict>;

export const CrossCheckResult = z.object({
  conflicts: z.array(CrossConflict),
});
export type CrossCheckResult = z.infer<typeof CrossCheckResult>;
