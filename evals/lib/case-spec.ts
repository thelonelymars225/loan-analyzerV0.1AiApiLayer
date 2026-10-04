import { z } from "zod";

/**
 * Input for the synthetic Qiwa contract template (evals/template/qiwa.html).
 *
 * Every field has a default, so a case only states what it is testing:
 *   CaseSpec.parse({ id: "leave-15", annualLeaveDays: 15 })
 *
 * All defaults are made up: fake names, IDs starting 1000000000, IBAN SA000..., example.com
 * e-mails. Never put real contract data in a case spec.
 */

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
/** "YYYY-MM-DD HH:MM" */
const IsoDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, "expected YYYY-MM-DD HH:MM");

/** Text printed in both columns. */
export const Bilingual = z.object({ en: z.string(), ar: z.string() });
export type Bilingual = z.infer<typeof Bilingual>;

/** One Section 15 ("Additional Terms") item, printed as 15.1, 15.2, ... in order. */
export const Section15Clause = z.object({
  en: z.string().min(1),
  ar: z.string().min(1),
});
export type Section15Clause = z.infer<typeof Section15Clause>;

const Contract = z.object({
  /** 8-digit contract number. */
  number: z
    .string()
    .regex(/^\d{8}$/)
    .default("10000001"),
  type: z.enum(["fixed_term", "indefinite", "specific_work"]).default("fixed_term"),
  executionDate: IsoDate.default("2025-01-01"),
  commencementDate: IsoDate.default("2025-01-01"),
  /** Defaults to the commencement date. */
  startDate: IsoDate.nullable().default(null),
  /** Fixed-term only. Defaults to commencement + term − 1 day. */
  endDate: IsoDate.nullable().default(null),
  /** Fixed-term only: clause 5.1 prints "1 year" for 12, "18 months" for 18. */
  termMonths: z.number().int().positive().default(12),
  /** Fixed-term only: clause 5.1 auto-renewal wording. */
  autoRenew: z.boolean().default(true),
  /** Fixed-term only: "at least N days before the contract end date". */
  renewalNoticeDays: z.number().int().nonnegative().default(30),
  location: Bilingual.default({ en: "Riyadh", ar: "الرياض" }),
});

const Signatory = z.object({
  name: Bilingual.default({ en: "Fahad Al-Mithali", ar: "فهد المثالي" }),
  idNo: z.string().default("1000000002"),
  capacity: Bilingual.default({ en: "Authorized Representative", ar: "المفوض" }),
  capacityDocument: Bilingual.default({
    en: "Power of Attorney with the Entity",
    ar: "التفويض لدى الجهة",
  }),
});

const Employer = z.object({
  name: Bilingual.default({ en: "Example Trading Co.", ar: "شركة المثال للتجارة" }),
  type: Bilingual.default({ en: "Company", ar: "شركة" }),
  unifiedNo: z.string().default("7000000001"),
  nationalAddress: z.string().default("ABCD1234"),
  phone: z.string().default("+966 11 000 0000"),
  mobile: z.string().default("+966 50 000 0000"),
  email: z.string().default("hr@example.com"),
  signatory: Signatory.prefault({}),
});

const Employee = z.object({
  /** Printed once, centred across both columns, as Qiwa does. Arabic for Saudi employees. */
  name: z.string().default("نور الحربي"),
  /** "Saudi" maps to nationality "saudi"; anything else to "non_saudi". */
  nationality: Bilingual.default({ en: "Saudi", ar: "سعودي" }),
  idNo: z.string().default("1000000001"),
  gender: Bilingual.default({ en: "Female", ar: "أنثى" }),
  maritalStatus: Bilingual.default({ en: "Single", ar: "عزباء" }),
  birthDate: IsoDate.default("1998-01-01"),
  nationalAddress: z.string().default("WXYZ5678"),
  education: Bilingual.default({ en: "Bachelor's degree", ar: "بكالوريوس" }),
  speciality: Bilingual.default({ en: "Information Systems", ar: "نظم المعلومات" }),
  mobile: z.string().default("+966 55 000 0000"),
  email: z.string().default("employee@example.com"),
});

const Job = z.object({
  occupation: Bilingual.default({ en: "Software Developer", ar: "مطور برمجيات" }),
  jobTitle: Bilingual.default({ en: "Software Engineer", ar: "مهندس برمجيات" }),
  workDomain: Bilingual.default({
    en: "Inside Saudi Arabia",
    ar: "داخل المملكة العربية السعودية",
  }),
  workLocation: Bilingual.default({ en: "Riyadh", ar: "الرياض" }),
  workType: Bilingual.default({ en: "Original Contract", ar: "عقد أصلي" }),
});

const Hours = z.object({
  workDaysPerWeek: z.number().int().positive().default(5),
  dailyHours: z.number().positive().default(8),
  restDaysPerWeek: z.number().int().nonnegative().default(2),
});

const WageSpec = z.object({
  basic: z.number().nonnegative().default(10000),
  housing: z.number().nonnegative().default(2500),
  transport: z.number().nonnegative().default(1000),
  /** Printed as "9.1.1.4 Other Allowances" when above 0. */
  other: z.number().nonnegative().default(0),
  /** Printed total. Defaults to the sum of the parts; set it to test a mismatch. */
  total: z.number().nonnegative().nullable().default(null),
  /** Day of the month wages are due. */
  dueDay: z.number().int().min(1).max(28).default(1),
});

const Bank = z.object({
  name: Bilingual.default({ en: "Example Bank", ar: "البنك المثالي" }),
  iban: z
    .string()
    .regex(/^SA\d{22}$/)
    .default("SA0000000000000000000000"),
});

const Footer = z.object({
  /** "Downloaded at" stamp printed on every page. */
  downloadedAt: IsoDateTime.default("2026-01-15 10:30"),
  /** Who downloaded the PDF ("بواسطة"), usually the employee. */
  downloadedByName: z.string().default("نور الحربي"),
  downloadedById: z.string().default("1000000001"),
  /** "This contract was created by <signatory> at ..." */
  createdAt: IsoDateTime.default("2025-01-01 09:00"),
  /** "This contract is Active as in ..." */
  activeAt: IsoDateTime.default("2026-01-15 10:29"),
});

export const CaseSpec = z.object({
  /** Case id: lower-case letters, digits and dashes. Used for file names. */
  id: z.string().regex(/^[a-z0-9-]+$/),
  contract: Contract.prefault({}),
  employer: Employer.prefault({}),
  employee: Employee.prefault({}),
  job: Job.prefault({}),
  probationDays: z.number().int().nonnegative().default(90),
  /** Print the standard "do not count towards this period: Eid al-Fitr, ..." sentence. */
  probationExcludesHolidays: z.boolean().default(true),
  /**
   * More days that pause probation, added to the end of that list (e.g. unpaid leave). The
   * regulations allow only the standard ones, so any extra day breaks PROB-EXCL-01.
   */
  probationExtraExclusions: z.array(Bilingual).default([]),
  hours: Hours.prefault({}),
  annualLeaveDays: z.number().int().nonnegative().default(21),
  wage: WageSpec.prefault({}),
  /** Clause 11.4: "plus (N%) of the basic hourly wage". */
  overtimePremiumPct: z.number().nonnegative().default(50),
  bank: Bank.prefault({}),
  section15: z.array(Section15Clause).default([]),
  footer: Footer.prefault({}),
});

/** A fully defaulted case spec (what the renderer uses). */
export type CaseSpec = z.output<typeof CaseSpec>;
/** What a case file may contain: only `id` is required. */
export type CaseSpecInput = z.input<typeof CaseSpec>;
