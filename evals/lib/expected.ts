import { z } from "zod";
import { ContractFields, Severity, Verdict } from "@rater/contracts";

/**
 * expected.json: what the pipeline should produce for one contract. The private test #1 file
 * uses the same format, so keep changes additive.
 */

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

export const ExpectedFinding = z.object({
  ruleId: z.string(),
  /** "15.6" for a Section 15 clause, "8.1" for a template clause, null for info rules. */
  clause: z.string().nullable(),
  verdict: Verdict,
  severity: Severity,
});
export type ExpectedFinding = z.infer<typeof ExpectedFinding>;

export const ExpectedDeadline = z.object({ ruleId: z.string(), date: IsoDate });
export type ExpectedDeadline = z.infer<typeof ExpectedDeadline>;

/** Inclusive [min, max] of the overall score. */
const ScoreRange = z
  .tuple([z.number().int().min(0).max(100), z.number().int().min(0).max(100)])
  .refine(([min, max]) => min <= max, "score range: min must not be above max");
export type ScoreRange = z.infer<typeof ScoreRange>;

export const Expected = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  description: z.string(),
  /** The date the rating runs on: deadlines depend on it. */
  today: IsoDate,
  status: z.enum(["done", "needs_review", "rejected"]),
  /** Fields that must be extracted exactly. Unknown field names are an error. */
  fields: ContractFields.partial().strict().default({}),
  /** Findings that must be present with exactly this rule, clause, verdict and severity. */
  findings: z.array(ExpectedFinding).default([]),
  /** Rules that must not raise a problem (a compliant or better-than-law finding is fine). */
  mustNot: z.array(z.string()).default([]),
  /** When given, the deadlines must be exactly these. */
  deadlines: z.array(ExpectedDeadline).optional(),
  /** Overall score per view. Left out for a rejected document, which has no score. */
  score: z.object({ employee: ScoreRange, hr: ScoreRange }).optional(),
});
export type Expected = z.infer<typeof Expected>;
export type ExpectedInput = z.input<typeof Expected>;
