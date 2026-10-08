import { z } from "zod";

/*
 * The wage check: the same person's pay as the Qiwa contract, the offer letter (the offline
 * contract) and the payroll (Mudad wage file) state it, compared field by field.
 */

export const WageIssueKind = z.enum([
  /** Payroll pays a different basic or housing, or less transport, than the Qiwa contract. */
  "payroll_differs",
  /** Payroll pays less in total than the Qiwa contract. */
  "underpaid",
  /** The offer letter promised something the Qiwa contract does not say. */
  "offer_differs",
  /** In payroll, but there is no Qiwa contract. */
  "no_contract",
  /** A Qiwa contract, but no payroll row this month. */
  "not_paid",
  /** Deductions are more than half the wage (Art. 93). */
  "deductions_over_half",
  /** Net pay is not gross minus deductions: an error in the wage file. */
  "net_mismatch",
]);
export type WageIssueKind = z.infer<typeof WageIssueKind>;

export const WageField = z.enum([
  "basic",
  "housing",
  "transport",
  "total",
  "deductions",
  "net",
]);
export type WageField = z.infer<typeof WageField>;

export const WageIssue = z.object({
  kind: WageIssueKind,
  field: WageField.nullable(),
  /** What the reference source says (Qiwa contract; gross pay for payroll-only checks). */
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

export const EmployeeWageCheck = z.object({
  employeeId: z.string(),
  name: z.string().nullable(),
  issues: z.array(WageIssue),
});
export type EmployeeWageCheck = z.infer<typeof EmployeeWageCheck>;

export const WageCheckResponse = z.object({
  summary: z.object({
    employees: z.number().int(),
    flagged: z.number().int(),
    /** Sum of the monthly shortfalls of underpaid employees, in SAR. */
    underpaidSar: z.number(),
  }),
  /** Flagged employees first. */
  employees: z.array(EmployeeWageCheck),
});
export type WageCheckResponse = z.infer<typeof WageCheckResponse>;
