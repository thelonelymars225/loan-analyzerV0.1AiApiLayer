import { z } from "zod";

/**
 * SAR, or null when the source does not say. May be left out, and may be a decimal string
 * such as "9000.00", which is how SAP OData sends amounts.
 */
const Amount = z
  .union([
    z.number().nonnegative(),
    z
      .string()
      .regex(/^\d+(\.\d+)?$/)
      .transform(Number),
  ])
  .nullable()
  .default(null);

/** One person's monthly pay as one source states it, in SAR. Null: the source does not say. */
export const WageRecord = z.object({
  /** National ID or iqama number. */
  employeeId: z.string().regex(/^\d{10}$/),
  name: z.string().nullable().default(null),
  basic: Amount,
  housing: Amount,
  /** In payroll: every other allowance, transport included. */
  transport: Amount,
  total: Amount,
});
export type WageRecord = z.infer<typeof WageRecord>;

/** The same check as JSON, for a system that already holds the records (an HRIS, an ERP). */
export const WageCheckRequest = z.object({
  qiwa: z.array(WageRecord).max(50_000),
  offers: z.array(WageRecord).max(50_000).default([]),
  /** Leave out to check offers against Qiwa before anyone is paid. */
  payroll: z.array(WageRecord).max(50_000).optional(),
});
export type WageCheckRequest = z.infer<typeof WageCheckRequest>;

/** The wage check: Qiwa contract vs. offer letter and payroll (Mudad wage file), field by field. */
export const WageIssue = z.object({
  kind: z.enum([
    "payroll_differs",
    "underpaid",
    "offer_differs",
    "no_contract",
    "duplicate",
    "not_paid",
  ]),
  field: z.enum(["basic", "housing", "transport", "total"]).nullable(),
  /** What the Qiwa contract says. */
  expected: z.number().nullable(),
  /** What the compared source says. */
  actual: z.number().nullable(),
  /** actual - expected in SAR per month. Negative: the employee gets less. */
  gap: z.number().nullable(),
  /** Labor Law articles the issue touches, e.g. ["84"]. */
  articles: z.array(z.string()),
  message: z.string(),
});
export type WageIssue = z.infer<typeof WageIssue>;

export const WageCheckResponse = z.object({
  summary: z.object({ employees: z.number().int(), flagged: z.number().int() }),
  /** Flagged employees first. */
  employees: z.array(
    z.object({
      employeeId: z.string(),
      name: z.string().nullable(),
      issues: z.array(WageIssue),
    }),
  ),
});
export type WageCheckResponse = z.infer<typeof WageCheckResponse>;
