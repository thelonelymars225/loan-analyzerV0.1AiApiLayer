import { z } from "zod";
import {
  Band,
  Confidence,
  FindingSource,
  ScoreCategory,
  Severity,
  Verdict,
  View,
} from "./enums";
import { ImpactKind } from "./rule";

/**
 * SAR effect of a finding. Keys of `sar` depend on the kind:
 * - eos_gap: "1y", "5y", "10y" (award lost after that many years of service)
 * - art77_gap: "contract" (what the clause pays), "default" (what the law would pay), "gap"
 * - leave_value: "perYear" (value of the leave days at stake)
 */
export const Impact = z.object({
  kind: ImpactKind,
  sar: z.record(z.string(), z.number()),
  note: z.string().optional(),
});
export type Impact = z.infer<typeof Impact>;

/** One Finding shape feeds both views. The view only picks the message, order and weights. */
export const Finding = z.object({
  ruleId: z.string(),
  /** Clause number ("15.6"), or a template clause for field findings ("7.1"); null if none. */
  clause: z.string().nullable(),
  verdict: Verdict,
  severity: Severity,
  confidence: Confidence,
  /** Sub-scores this finding counts against; copied from the rule. */
  categories: z.array(ScoreCategory).min(1),
  articles: z.array(z.string()),
  impact: Impact.nullable(),
  /** Neutral explanation of why the verdict was reached. */
  explanation: z.string(),
  employeeMsg: z.string(),
  hrMsg: z.string(),
  askFor: z.string().optional(),
  suggestedWording: z.string().optional(),
  source: FindingSource,
  /** True when the analyser could not produce a valid answer and a human should look. */
  needsReview: z.boolean().default(false),
});
export type Finding = z.infer<typeof Finding>;
export type FindingInput = z.input<typeof Finding>;

export const Deadline = z.object({
  ruleId: z.string(),
  date: z.string(),
  /** Which deadline: non-renewal notice or end of probation. */
  kind: z.enum(["renewal_notice", "probation_end"]),
  employeeMsg: z.string(),
  hrMsg: z.string(),
});
export type Deadline = z.infer<typeof Deadline>;

export const SubScores = z.object({
  legal: z.number().int().min(0).max(100),
  market: z.number().int().min(0).max(100),
  clarity: z.number().int().min(0).max(100),
});
export type SubScores = z.infer<typeof SubScores>;

export const Score = SubScores.extend({
  overall: z.number().int().min(0).max(100),
  band: Band,
  view: View,
  /** Market fairness has no occupation salary data in v1. */
  marketConfidence: Confidence,
});
export type Score = z.infer<typeof Score>;
