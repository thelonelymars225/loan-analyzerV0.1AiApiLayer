import type { ContractFields } from "@rater/contracts";
import { addMonths } from "./dates";

/** Guards the month count against nonsense dates (50 years). */
const MAX_TERM_MONTHS = 600;

/**
 * The contract term in months: clause 5.1's figure, or, when 5.1 could not be read, the months
 * from the start date to the end date. Qiwa end dates are inclusive (start + N months − 1 day,
 * e.g. 2026-01-11 to 2027-01-10 is 12 months), so the term is the smallest N for which
 * start + N months falls after the end date. Null when neither is known.
 */
export function termMonthsOf(fields: ContractFields): number | null {
  if (fields.termMonths !== null) return fields.termMonths;
  const { commencementDate: start, endDate: end } = fields;
  if (start === null || end === null || end < start) return null;
  let months = 1;
  while (months < MAX_TERM_MONTHS && addMonths(start, months) <= end) months++;
  return months;
}
