import type {
  ContractFields,
  ContractType,
  Deadline,
  Finding,
  ProbationExcludedDay,
  Rule,
  Verdict,
} from "@rater/contracts";
import { addDays, addMonths } from "./engine/dates";
import { findingText } from "./engine/messages";
import {
  fillPlaceholders,
  formatNumber,
  type PlaceholderValues,
} from "./engine/placeholders";
import { termMonthsOf } from "./engine/term";
import { isProblemVerdict } from "./engine/verdicts";

/*
 * Step 4a: deterministic checks on the fields read from sections 1-14.
 * Rules are data; this file only holds the one check function each rule ID names.
 */

// Legal limits (Labor Law as amended in 2025) and the market convention for allowances.
const PROBATION_MAX_DAYS = 180; // Art. 53
const ANNUAL_LEAVE_MIN_DAYS = 21; // Art. 109; 30 after 5 years, which a new contract can't reach
const DAILY_HOURS_MAX = 8; // Art. 98
const WEEKLY_HOURS_MAX = 48; // Art. 98
const OVERTIME_PREMIUM_MIN_PCT = 50; // Art. 107
const HOUSING_NORM = { pct: 25, tolerance: 5 }; // % of basic wage, market convention
const TRANSPORT_NORM = { pct: 10, tolerance: 3 };

/** Days Exec. Reg. Art. 19 allows to pause probation. */
const ALLOWED_PROBATION_EXCLUSIONS: ReadonlySet<ProbationExcludedDay> = new Set([
  "eid_al_fitr",
  "eid_al_adha",
  "national_day",
  "foundation_day",
  "sick_leave",
]);

/** The Qiwa template clause each rule reads, shown as the finding's clause. */
const TEMPLATE_CLAUSE: Readonly<Record<string, string>> = {
  "PROB-MAX-01": "6.1",
  "PROB-EXCL-01": "6.1",
  "PROB-NOCOMP-01": "6.2",
  "LEAVE-MIN-01": "8.1",
  "HOURS-MAX-01": "7",
  "OT-RATE-01": "11.2",
  "RENEW-CONVERT-01": "5.1",
  "RENEW-DEADLINE-01": "5.1",
  "MARKET-ALLOW-01": "9.1.1",
};

/** What one field check found. */
export interface FieldCheckOutcome {
  verdict: Verdict;
  /** Neutral, factual statement of the comparison. */
  explanation: string;
  /** Values for the rule's {placeholders}. */
  values: PlaceholderValues;
}

/** Returns null when the fields the check needs were not extracted: then there is nothing to say. */
export type FieldCheck = (fields: ContractFields) => FieldCheckOutcome | null;

/** One check per field and market rule, keyed by rule ID. A rule without a check is skipped. */
export const FIELD_CHECKS: Readonly<Record<string, FieldCheck>> = {
  "PROB-MAX-01": checkProbationLength,
  "PROB-EXCL-01": checkProbationExclusions,
  "LEAVE-MIN-01": checkAnnualLeave,
  "HOURS-MAX-01": checkWorkingHours,
  "OT-RATE-01": checkOvertimePremium,
  "MARKET-ALLOW-01": checkAllowances,
};

export type DeadlineCheck = (
  rule: Rule,
  fields: ContractFields,
  today: string,
) => Deadline | null;

/** Rules that produce a dated deadline instead of (or as well as) a finding. */
export const DEADLINE_CHECKS: Readonly<Record<string, DeadlineCheck>> = {
  "RENEW-DEADLINE-01": renewalNoticeDeadline,
  // The info rule on probation (Art. 54) carries the end-of-probation date.
  "PROB-NOCOMP-01": probationEndDeadline,
};

/** When an info rule applies. Info rules not listed here always apply. */
const INFO_CONDITIONS: Readonly<Record<string, (fields: ContractFields) => boolean>> = {
  "PROB-NOCOMP-01": (f) => f.probationDays !== 0,
  "RENEW-CONVERT-01": (f) => f.contractType === "fixed_term" && f.nationality === "saudi",
  "NOTICE-INDEF-01": (f) => f.contractType === "indefinite",
  "SETTLE-TIME-01": () => true,
};

/** Step 4a: field, market and info findings, plus the renewal and probation deadlines. */
export function runFieldRules(
  fields: ContractFields,
  rules: Rule[],
  opts: { today: string },
): { findings: Finding[]; deadlines: Deadline[] } {
  const findings: Finding[] = [];
  const deadlines: Deadline[] = [];
  for (const rule of rules) {
    const finding = evaluateRule(rule, fields);
    if (finding) findings.push(finding);
    const deadline = DEADLINE_CHECKS[rule.id]?.(rule, fields, opts.today);
    if (deadline) deadlines.push(deadline);
  }
  deadlines.sort((a, b) => a.date.localeCompare(b.date));
  return { findings, deadlines };
}

/**
 * The placeholder values a field rule fills from the contract, e.g. {value} for LEAVE-MIN-01.
 * renderReport uses it to fill messages of findings that were stored unfilled.
 */
export function fieldPlaceholderValues(
  ruleId: string,
  fields: ContractFields,
): PlaceholderValues {
  return FIELD_CHECKS[ruleId]?.(fields)?.values ?? {};
}

function evaluateRule(rule: Rule, fields: ContractFields): Finding | null {
  if (rule.kind === "field" || rule.kind === "market") {
    const outcome = FIELD_CHECKS[rule.id]?.(fields);
    return outcome ? fieldFinding(rule, outcome) : null;
  }
  if (rule.kind === "info") {
    const applies = INFO_CONDITIONS[rule.id] ?? (() => true);
    return applies(fields) ? infoFinding(rule) : null;
  }
  return null;
}

function fieldFinding(rule: Rule, outcome: FieldCheckOutcome): Finding {
  return {
    ruleId: rule.id,
    clause: TEMPLATE_CLAUSE[rule.id] ?? null,
    verdict: outcome.verdict,
    severity: isProblemVerdict(outcome.verdict) ? rule.severityIfFail : "none",
    confidence: rule.confidence,
    categories: rule.categories,
    articles: rule.articles,
    impact: null,
    explanation: outcome.explanation,
    ...findingText(rule, outcome.verdict, outcome.values),
    source: rule.kind === "market" ? "market" : "field_rule",
    needsReview: false,
  };
}

function infoFinding(rule: Rule): Finding {
  return {
    ruleId: rule.id,
    clause: TEMPLATE_CLAUSE[rule.id] ?? null,
    verdict: "compliant",
    severity: "none",
    confidence: rule.confidence,
    categories: rule.categories,
    articles: rule.articles,
    impact: null,
    explanation: rule.title,
    ...findingText(rule, "compliant"),
    source: "info",
    needsReview: false,
  };
}

// ---------------------------------------------------------------------------------------------
// Field checks
// ---------------------------------------------------------------------------------------------

/**
 * Exactly at the legal limit is compliant; past it (above a maximum, below a minimum) is
 * likely void; anything kinder to the worker is better than the law.
 */
function verdictAgainstLimit(
  value: number,
  limit: number,
  limitIs: "max" | "min",
): Verdict {
  if (value === limit) return "compliant";
  const kinder = limitIs === "max" ? value < limit : value > limit;
  return kinder ? "better_than_law" : "likely_void";
}

function checkProbationLength(fields: ContractFields): FieldCheckOutcome | null {
  const days = fields.probationDays;
  if (days === null) return null;
  return {
    verdict: verdictAgainstLimit(days, PROBATION_MAX_DAYS, "max"),
    explanation: `Probation is ${days} days; the legal maximum is ${PROBATION_MAX_DAYS} days in total.`,
    values: { value: String(days), limit: String(PROBATION_MAX_DAYS) },
  };
}

function checkProbationExclusions(fields: ContractFields): FieldCheckOutcome | null {
  if (!fields.probationDays) return null;
  const notAllowed = fields.probationExcludedDays.filter(
    (day) => !ALLOWED_PROBATION_EXCLUSIONS.has(day),
  );
  if (notAllowed.length > 0) {
    return {
      verdict: "likely_void",
      explanation:
        "Probation is also paused for days the regulations don't list. Only Eid al-Fitr, Eid al-Adha, National Day, Foundation Day and sick leave may pause it.",
      values: {},
    };
  }
  return {
    verdict: "compliant",
    explanation:
      "Only days the regulations list (the two Eids, National Day, Foundation Day and sick leave) pause probation.",
    values: {},
  };
}

function checkAnnualLeave(fields: ContractFields): FieldCheckOutcome | null {
  const days = fields.annualLeaveDays;
  if (days === null) return null;
  return {
    verdict: verdictAgainstLimit(days, ANNUAL_LEAVE_MIN_DAYS, "min"),
    explanation: `Annual leave is ${days} days a year; the legal minimum is ${ANNUAL_LEAVE_MIN_DAYS} days (30 after 5 years of service).`,
    values: {
      value: String(days),
      limit: String(ANNUAL_LEAVE_MIN_DAYS),
      days: String(Math.max(0, ANNUAL_LEAVE_MIN_DAYS - days)),
    },
  };
}

function checkWorkingHours(fields: ContractFields): FieldCheckOutcome | null {
  const daily = fields.dailyHours;
  const weekly =
    fields.weeklyHours ??
    (daily !== null && fields.workDaysPerWeek !== null
      ? daily * fields.workDaysPerWeek
      : null);
  if (daily === null && weekly === null) return null;

  const over = (daily ?? 0) > DAILY_HOURS_MAX || (weekly ?? 0) > WEEKLY_HOURS_MAX;
  // The week decides "better than the law"; the day only when the week is unknown.
  const under =
    weekly !== null ? weekly < WEEKLY_HOURS_MAX : (daily ?? 0) < DAILY_HOURS_MAX;
  const verdict: Verdict = over ? "likely_void" : under ? "better_than_law" : "compliant";

  const stated = [
    daily !== null ? `${formatNumber(daily)} a day` : null,
    weekly !== null ? `${formatNumber(weekly)} a week` : null,
  ].filter((part) => part !== null);
  // Art. 98 has two criteria. A contract that states only the week uses the weekly one, and
  // extraction never makes up a daily figure from it, so only the 48-hour cap applies then.
  const cap =
    daily === null
      ? `${WEEKLY_HOURS_MAX} a week under the weekly criterion`
      : `${DAILY_HOURS_MAX} a day and ${WEEKLY_HOURS_MAX} a week`;
  return {
    verdict,
    explanation: `Normal hours are ${stated.join(" and ")}; the legal cap is ${cap}.`,
    values:
      weekly !== null
        ? { value: formatNumber(weekly), limit: String(WEEKLY_HOURS_MAX) }
        : { limit: String(WEEKLY_HOURS_MAX) },
  };
}

function checkOvertimePremium(fields: ContractFields): FieldCheckOutcome | null {
  const pct = fields.overtimePremiumPct;
  if (pct === null) return null;
  return {
    verdict: verdictAgainstLimit(pct, OVERTIME_PREMIUM_MIN_PCT, "min"),
    explanation: `Overtime pays the hourly wage plus ${formatNumber(pct)}% of the basic hourly wage; the legal minimum is ${OVERTIME_PREMIUM_MIN_PCT}%.`,
    values: { value: formatNumber(pct), limit: String(OVERTIME_PREMIUM_MIN_PCT) },
  };
}

type MarketPosition = "below" | "at" | "above";

const POSITION_WORDS: Record<MarketPosition, string> = {
  below: "below",
  at: "in line with",
  above: "above",
};

const POSITION_VERDICT: Record<MarketPosition, Verdict> = {
  below: "worse_than_default",
  at: "compliant",
  above: "better_than_law",
};

function positionAgainstNorm(
  pct: number,
  norm: { pct: number; tolerance: number },
): MarketPosition {
  if (pct < norm.pct - norm.tolerance) return "below";
  if (pct > norm.pct + norm.tolerance) return "above";
  return "at";
}

/** Market convention, not law: housing about 25% and transport about 10% of the basic wage. */
function checkAllowances(fields: ContractFields): FieldCheckOutcome | null {
  const wage = fields.wage;
  if (wage === null || wage.basic <= 0) return null;
  const housingPct = (wage.housing / wage.basic) * 100;
  const transportPct = (wage.transport / wage.basic) * 100;
  const positions = [
    positionAgainstNorm(housingPct, HOUSING_NORM),
    positionAgainstNorm(transportPct, TRANSPORT_NORM),
  ];
  // A shortfall in either allowance counts; "above" needs neither to be short.
  const position: MarketPosition = positions.includes("below")
    ? "below"
    : positions.includes("above")
      ? "above"
      : "at";
  return {
    verdict: POSITION_VERDICT[position],
    explanation: `Housing is ${formatNumber(housingPct)}% of the basic wage (market norm about ${HOUSING_NORM.pct}%) and transport is ${formatNumber(transportPct)}% (about ${TRANSPORT_NORM.pct}%).`,
    values: {
      position: POSITION_WORDS[position],
      value: `${formatNumber(housingPct)}% / ${formatNumber(transportPct)}%`,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Deadlines
// ---------------------------------------------------------------------------------------------

/** Guards the roll-forward loop against nonsense dates. */
const MAX_TERMS_TO_ROLL = 100;

/**
 * Non-renewal notice is due renewalNoticeDays before the end date. When that date has passed
 * on an auto-renewing contract, the contract has already renewed, so the next deadline is
 * one or more terms later. A contract that does not auto-renew has no deadline to meet, and
 * neither does one whose date has passed when renewal or the term is unknown.
 */
function renewalNoticeDeadline(
  rule: Rule,
  fields: ContractFields,
  today: string,
): Deadline | null {
  const { endDate, renewalNoticeDays, autoRenew } = fields;
  if (endDate === null || renewalNoticeDays === null || autoRenew === false) return null;

  let date = addDays(endDate, -renewalNoticeDays);
  const termMonths = termMonthsOf(fields);
  if (autoRenew && termMonths) {
    // Count terms from the original end date so month-end dates don't drift.
    for (let terms = 1; date < today && terms <= MAX_TERMS_TO_ROLL; terms++) {
      date = addDays(addMonths(endDate, terms * termMonths), -renewalNoticeDays);
    }
  }
  // A date already passed is nothing the reader can act on, so it is not shown.
  if (date < today) return null;
  return {
    ruleId: rule.id,
    date,
    kind: "renewal_notice",
    employeeMsg: fillPlaceholders(rule.employeeMsg, { deadline: date }),
    hrMsg: fillPlaceholders(rule.hrMsg, { deadline: date }),
  };
}

const PROBATION_END_MSG = {
  employee:
    "Your probation ends on {deadline} at the earliest (later if Eid holidays, National Day, Foundation Day or sick leave fall within it). Until then either side can end the contract with no compensation and no end-of-service award.",
  hr: "Probation ends on {deadline} at the earliest (excluded days push it later). Until then either party may end the contract without compensation (Art. 54).",
};

/**
 * Last day of probation: commencement + probationDays − 1, never past the 180-day legal cap
 * (Art. 53 makes the extra days void, and PROB-MAX-01 says so). Only shown while it is ahead.
 */
function probationEndDeadline(
  rule: Rule,
  fields: ContractFields,
  today: string,
): Deadline | null {
  const { commencementDate, probationDays } = fields;
  if (commencementDate === null || !probationDays) return null;
  const lawfulDays = Math.min(probationDays, PROBATION_MAX_DAYS);
  const date = addDays(commencementDate, lawfulDays - 1);
  if (date < today) return null;
  return {
    ruleId: rule.id,
    date,
    kind: "probation_end",
    employeeMsg: fillPlaceholders(PROBATION_END_MSG.employee, { deadline: date }),
    hrMsg: fillPlaceholders(PROBATION_END_MSG.hr, { deadline: date }),
  };
}

// ---------------------------------------------------------------------------------------------
// Field summary for the analyser
// ---------------------------------------------------------------------------------------------

const CONTRACT_TYPE_LABEL: Record<ContractType, string> = {
  fixed_term: "fixed-term",
  indefinite: "indefinite (open-ended)",
  specific_work: "for a specific work",
  unknown: "not found",
};

const NOT_FOUND = "not found";

function orNotFound(value: number | string | null, unit = ""): string {
  if (value === null) return NOT_FOUND;
  return typeof value === "number" ? `${formatNumber(value)}${unit}` : value;
}

function yesNo(value: boolean | null): string {
  return value === null ? NOT_FOUND : value ? "yes" : "no";
}

function sar(amount: number): string {
  return amount.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/**
 * One-paragraph summary of sections 1-14 for the analyser prompts. It holds contract terms
 * only: no names, ID numbers, nationality, occupation or work location.
 */
export function summariseFields(fields: ContractFields): string {
  const wage = fields.wage;
  const parts = [
    `Contract type: ${CONTRACT_TYPE_LABEL[fields.contractType]}.`,
    `Start date: ${orNotFound(fields.commencementDate)}.`,
    `End date: ${orNotFound(fields.endDate)}.`,
    `Term: ${orNotFound(fields.termMonths, " months")}.`,
    `Renews automatically: ${yesNo(fields.autoRenew)}.`,
    `Non-renewal notice: ${orNotFound(fields.renewalNoticeDays, " days before the end date")}.`,
    `Probation: ${orNotFound(fields.probationDays, " days")}.`,
    `Working days per week: ${orNotFound(fields.workDaysPerWeek)}.`,
    `Daily hours: ${orNotFound(fields.dailyHours)}.`,
    `Weekly hours: ${orNotFound(fields.weeklyHours)}.`,
    `Rest days per week: ${orNotFound(fields.restDaysPerWeek)}.`,
    `Annual leave: ${orNotFound(fields.annualLeaveDays, " days a year")}.`,
    wage
      ? `Monthly wage (SAR): basic ${sar(wage.basic)}, housing ${sar(wage.housing)}, transport ${sar(wage.transport)}, other allowances ${sar(wage.other)}, total ${sar(wage.total)}.`
      : `Monthly wage: ${NOT_FOUND}.`,
    `Overtime premium: ${orNotFound(fields.overtimePremiumPct, "% of the basic hourly wage")}.`,
  ];
  return parts.join(" ");
}
