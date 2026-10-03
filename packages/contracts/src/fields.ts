import { z } from "zod";
import { Confidence } from "./enums";

/** ISO calendar date, YYYY-MM-DD (Gregorian; Qiwa uses Gregorian per clause 14.6). */
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ContractType = z.enum(["fixed_term", "indefinite", "specific_work", "unknown"]);
export type ContractType = z.infer<typeof ContractType>;

/** Days the law allows to be excluded from probation (Art. 53). */
export const ProbationExcludedDay = z.enum([
  "eid_al_fitr",
  "eid_al_adha",
  "national_day",
  "foundation_day",
  "sick_leave",
  "other",
]);
export type ProbationExcludedDay = z.infer<typeof ProbationExcludedDay>;

/** Monthly wage split in SAR. */
export const Wage = z.object({
  basic: z.number().nonnegative(),
  housing: z.number().nonnegative(),
  transport: z.number().nonnegative(),
  /** Sum of any other fixed allowances. */
  other: z.number().nonnegative(),
  /** Total wage as printed on the contract. */
  total: z.number().nonnegative(),
});
export type Wage = z.infer<typeof Wage>;

/**
 * Values read from sections 1-14 of a Qiwa contract. Null means the field was not found.
 * No names, ID numbers, IBANs or phone numbers live here: those are only used for redaction.
 */
export const ContractFields = z.object({
  contractType: ContractType,
  /** The contract type exactly as printed, e.g. "Fixed-term Contract". */
  contractTypeRaw: z.string().nullable(),
  executionDate: IsoDate.nullable(),
  commencementDate: IsoDate.nullable(),
  endDate: IsoDate.nullable(),
  /** Term length in months for fixed-term contracts (clause 5.1). */
  termMonths: z.number().int().positive().nullable(),
  autoRenew: z.boolean().nullable(),
  /** Days before the end date that non-renewal notice must be given (clause 5.1). */
  renewalNoticeDays: z.number().int().nonnegative().nullable(),
  probationDays: z.number().int().nonnegative().nullable(),
  probationExcludedDays: z.array(ProbationExcludedDay),
  workDaysPerWeek: z.number().nonnegative().nullable(),
  dailyHours: z.number().nonnegative().nullable(),
  weeklyHours: z.number().nonnegative().nullable(),
  restDaysPerWeek: z.number().nonnegative().nullable(),
  annualLeaveDays: z.number().int().nonnegative().nullable(),
  wage: Wage.nullable(),
  /** Overtime premium as a percentage of the basic hourly wage (clause 11.2), e.g. 50. */
  overtimePremiumPct: z.number().nonnegative().nullable(),
  /** "saudi" or "non_saudi". Needed for the renewal-conversion rule (Art. 55). */
  nationality: z.enum(["saudi", "non_saudi"]).nullable(),
  occupation: z.string().nullable(),
  workLocation: z.string().nullable(),
});
export type ContractFields = z.infer<typeof ContractFields>;
export type ContractFieldName = keyof ContractFields;

/** Where a field came from, for the contract_fields table. */
export const FieldProvenance = z.object({
  page: z.number().int().positive().nullable(),
  confidence: Confidence,
});
export type FieldProvenance = z.infer<typeof FieldProvenance>;

/** One Section 15 ("Additional Terms") item. */
export const Clause = z.object({
  section: z.number().int(),
  /** Clause number as printed, e.g. "15.6". */
  number: z.string(),
  textEn: z.string(),
  /** Arabic text from OCR. Arabic prevails (clause 14.7). Null when OCR was unavailable. */
  textAr: z.string().nullable(),
  /** sha256 of the normalised English text; key for the clause cache. */
  textHash: z.string(),
});
export type Clause = z.infer<typeof Clause>;
