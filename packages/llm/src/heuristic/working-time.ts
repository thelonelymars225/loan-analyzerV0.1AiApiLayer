import type { ClauseText, Detection } from "./detection";
import { passes, problem } from "./detection";
import type { Quantity } from "./text";
import { findQuantities, formatNumber, splitSentences, toDays } from "./text";

/*
 * Detectors for clauses about time: probation (PROB-MAX-01), annual leave (LEAVE-MIN-01,
 * LEAVE-FORFEIT-01) and working hours (HOURS-MAX-01). The probation, leave and hours rules
 * check sections 1-14 too; here they match only when a Section 15 clause sets the term itself.
 */

/**
 * A count of days that is a deadline, not a length of time: "30 days in advance", "15 days'
 * notice", "15 days written notice". Probation and leave detectors both skip these.
 */
const DEADLINE_AFTER =
  /^\s*(?:'s?\s+)?(?:(?:written|prior|advance)\s+)?(?:in advance|before|prior|notice|ahead)\b/;

// ---------------------------------------------------------------------------------------------
// PROB-MAX-01: probation longer than 180 days in total
// ---------------------------------------------------------------------------------------------

const PROBATION = /\bprobation\w*|\btrial period\b|\btest period\b/;
const PROBATION_LIMIT_DAYS = 180;

export function detectProbation({ text, probationDays }: ClauseText): Detection | null {
  if (!PROBATION.test(text)) return null;
  const total = totalProbation(text, probationDays);
  if (total === null) return null;

  if (total > PROBATION_LIMIT_DAYS) {
    return problem(
      "likely_void",
      "high",
      `This clause makes the probation ${total} days in total. The Labor Law caps probation at ${PROBATION_LIMIT_DAYS} days, including any extension.`,
    );
  }
  if (total === PROBATION_LIMIT_DAYS) {
    return passes(
      "compliant",
      `This clause sets probation at the legal maximum of ${PROBATION_LIMIT_DAYS} days.`,
    );
  }
  return passes(
    "better_than_law",
    `This clause sets probation at ${total} days, shorter than the legal maximum of ${PROBATION_LIMIT_DAYS} days.`,
  );
}

/**
 * What a day count in a probation clause is: the probation's length ("probation is 90 days"),
 * days added to it ("may be extended by 90 days") or its total ("extendable to 180 days").
 */
type CountKind = "length" | "added" | "total";

/** Words that lengthen the probation: "extended", "renewed", "in addition to". */
const EXTENSION =
  /\bextend\w*|\bextensions?\b|\bprolong\w*|\brenew\w*|\bin addition to\b/;
/** "may be repeated once", "may be renewed": with no days stated, the probation is served twice. */
const SERVED_TWICE = /\brepeat\w*|\brenew\w*|\bthe same (?:period|duration)\b/;

// The words just before (or after) a day count say which kind it is.
/** "a further 90 days", "another probation of 90 days", "an extension of 90 days". */
const ADDED_BEFORE =
  /\b(?:additional|further|another|extra|second)\s+(?:probation\w*\s+|trial\s+)?(?:period\s+)?(?:of\s+)?(?:up to\s+)?$|\bextension (?:period )?of\s+(?:up to\s+)?$/;
/** "a total of 180 days", or anywhere earlier "including any extension". */
const TOTAL_BEFORE =
  /\btotal(?:ling)?(?: of)?\s+$|\bincluding (?:any |all |the )?extensions?\b/;
/** "180 days in total". */
const TOTAL_AFTER = /^\s*(?:in total|in all|altogether)\b/;
/** After an extension word: "extended by 90 days", "renewed for a period not exceeding 90 days". */
const BY_OR_FOR_BEFORE = /\b(?:by|for)\s+(?:[a-z'-]+\s+){0,5}$/;
/** A limit on the probation: "extended to 180 days", "shall not exceed 180 days". */
const LIMIT_BEFORE =
  /\b(?:to|up to|beyond|not (?:to )?exceed(?:ing)?|no (?:more|longer) than|at most|(?:a )?maximum(?: of)?)\s+$/;
/** "notice of 15 days" (the "15 days' notice" order is DEADLINE_AFTER). */
const NOTICE_BEFORE = /\bnotice(?: period)? of\s+$/;

/**
 * Probation days in total, or null when the clause states none. A stated total wins. Otherwise
 * it is the length the clause states (or clause 6.1's, when the clause only extends it) plus
 * the days added: "may be extended by 90 days" on top of 6.1's 90 days is 180.
 */
function totalProbation(text: string, probationDays: number | null): number | null {
  const counts = probationCounts(text);
  const daysOf = (kind: CountKind) =>
    counts.filter((count) => count.kind === kind).map((count) => count.days);

  const totals = daysOf("total");
  if (totals.length > 0) return Math.max(...totals);

  const stated = daysOf("length")[0] ?? null;
  const added = daysOf("added").reduce((sum, days) => sum + days, 0);
  if (added > 0) return (stated ?? probationDays ?? 0) + added;

  const base = stated ?? probationDays;
  if (base !== null && SERVED_TWICE.test(text)) return base * 2;
  return stated;
}

/** Every day count in the clause, with its kind. Notice periods are left out. */
function probationCounts(text: string): { days: number; kind: CountKind }[] {
  return splitSentences(text).flatMap((sentence) =>
    findQuantities(sentence).flatMap((quantity) => {
      const days = toDays(quantity);
      const before = sentence.slice(0, quantity.index);
      const after = sentence.slice(quantity.end);
      if (days === null || NOTICE_BEFORE.test(before) || DEADLINE_AFTER.test(after)) {
        return [];
      }
      return [{ days, kind: countKind(before, after) }];
    }),
  );
}

/** The kind of one day count, from the sentence text before and after it. */
function countKind(before: string, after: string): CountKind {
  const afterExtension = EXTENSION.test(before);
  if (ADDED_BEFORE.test(before)) return "added";
  if (TOTAL_BEFORE.test(before) || TOTAL_AFTER.test(after)) return "total";
  if (afterExtension && BY_OR_FOR_BEFORE.test(before)) return "added";
  if (LIMIT_BEFORE.test(before)) return "total";
  // Any other count after an extension word is what it adds: "renewed once, 120 days".
  return afterExtension ? "added" : "length";
}

// ---------------------------------------------------------------------------------------------
// LEAVE-MIN-01: fewer than 21 days of annual leave (30 after five years)
// ---------------------------------------------------------------------------------------------

const ANNUAL_LEAVE =
  /\b(?:annual|yearly|paid)\s+(?:leave|vacation|holidays?)\b|\bvacations?\b|\bleave (?:entitlement|days)\b|\bdays? of (?:annual |paid )?leave\b/;
const OTHER_LEAVE =
  /\b(?:sick|maternity|paternity|hajj|marriage|bereavement|exam|study|unpaid|emergency)\s+leave\b/;
const AFTER_FIVE_YEARS =
  /\b(?:after|over|more than|exceeding|beyond|once the employee completes)\s+(?:five|5)(?:\s*\(\s*5\s*\))?\s+(?:consecutive\s+|full\s+)?years\b/;
const CARRY_FORWARD =
  /\bcarr(?:y|ied|ies)[- ](?:forward|over)\b|\bcarry-?over\b|\baccumulat\w*/;
const MIN_LEAVE_DAYS = 21;
const MIN_LEAVE_DAYS_AFTER_FIVE_YEARS = 30;

export function detectLeaveMinimum({ text }: ClauseText): Detection | null {
  if (!ANNUAL_LEAVE.test(text)) return null;
  if (OTHER_LEAVE.test(text) && !/\bannual\b/.test(text)) return null;

  const days = entitlementDays(text);
  const base = days[0];
  if (base === undefined) return null;
  const afterFiveYears = AFTER_FIVE_YEARS.test(text) ? days[1] : undefined;

  if (base < MIN_LEAVE_DAYS) {
    return problem(
      "likely_void",
      "high",
      `This clause gives ${base} days of annual leave a year. The Labor Law guarantees at least ${MIN_LEAVE_DAYS} days, rising to ${MIN_LEAVE_DAYS_AFTER_FIVE_YEARS} after five years of service.`,
    );
  }
  if (afterFiveYears !== undefined && afterFiveYears < MIN_LEAVE_DAYS_AFTER_FIVE_YEARS) {
    return problem(
      "likely_void",
      "high",
      `This clause gives ${afterFiveYears} days of annual leave after five years. The Labor Law guarantees at least ${MIN_LEAVE_DAYS_AFTER_FIVE_YEARS} days once the worker has five years of service.`,
    );
  }
  if (base === MIN_LEAVE_DAYS) {
    return passes(
      "compliant",
      `This clause gives the legal minimum of ${MIN_LEAVE_DAYS} days of annual leave.`,
    );
  }
  return passes(
    "better_than_law",
    `This clause gives ${base} days of annual leave, more than the legal minimum of ${MIN_LEAVE_DAYS} days.`,
  );
}

/**
 * Day counts the clause grants as leave. Counts in a sentence about carrying leave forward
 * ("up to 10 days may be carried over") and notice periods are not entitlements.
 */
function entitlementDays(text: string): number[] {
  return splitSentences(text)
    .filter((sentence) => !CARRY_FORWARD.test(sentence))
    .flatMap((sentence) =>
      findQuantities(sentence).filter(
        (quantity) =>
          !DEADLINE_AFTER.test(sentence.slice(quantity.end, quantity.end + 20)),
      ),
    )
    .filter((quantity) => quantity.unit === "day" || quantity.unit === "week")
    .map((quantity) => toDays(quantity) ?? 0);
}

// ---------------------------------------------------------------------------------------------
// LEAVE-FORFEIT-01: untaken leave lapses, or is not paid out
// ---------------------------------------------------------------------------------------------

const LEAVE_TOPIC =
  /\b(?:annual|paid|unused|untaken|accrued|remaining|outstanding)\s+(?:leave|vacation|holidays?)\b|\bvacations?\b|\bleave (?:balance|days|entitlement)\b|\bholiday entitlement\b|\bleave (?:not|that is not|which is not) (?:used|taken)\b/;
const FORFEITED = new RegExp(
  [
    String.raw`\bforfeit\w*|\blaps(?:e|es|ed|ing)\b|\bexpire[sd]?\b|\buse it or lose it\b`,
    String.raw`\b(?:will|shall|is|are) (?:be )?(?:lost|cancell?ed|void|waived|deducted)\b`,
    String.raw`\bwithout (?:any )?(?:compensation|payment|pay|cash)\b|\bno (?:compensation|payment|cash|pay)\b`,
    String.raw`\bnot (?:be )?(?:compensated|paid|encashed|cashed)\b|\bnot entitled to (?:any )?(?:compensation|payment|cash|pay)\b`,
    String.raw`\bcannot be (?:encashed|compensated|paid)\b`,
  ].join("|"),
);
const NO_CARRY_FORWARD = new RegExp(
  [
    String.raw`\bcarr(?:y|ied|ies)[- ](?:forward|over)\b|\bcarry-?over\b|\broll(?:ed)?[- ]?over\b|\baccumulat\w*`,
    String.raw`\btransferr?ed to the (?:next|following) year\b`,
    String.raw`\bsame (?:calendar |financial )?year\b|\bwithin the (?:calendar |same |financial )?year\b`,
  ].join("|"),
);
const PAID_OUT =
  /\b(?:paid|compensated|encashed) (?:in cash|for)\b|\bcash (?:compensation|payment|in lieu)\b/;

export function detectLeaveForfeiture({ text }: ClauseText): Detection | null {
  if (!LEAVE_TOPIC.test(text)) return null;
  if (FORFEITED.test(text)) {
    return problem(
      "likely_void",
      "medium",
      "This clause makes untaken annual leave lapse or go unpaid. The Labor Law requires the worker to be paid for leave they did not take, and a waiver of that right is void.",
    );
  }
  if (!NO_CARRY_FORWARD.test(text)) return null;
  if (PAID_OUT.test(text)) {
    return passes(
      "compliant",
      "This clause stops leave being carried forward but pays for untaken days, which the Labor Law allows.",
      "medium",
    );
  }
  return problem(
    "unclear",
    "low",
    "This clause says annual leave must be used within the year and cannot be carried forward. The employer may refuse carry-over, but the worker must still be paid for any leave they could not take, so the clause should not be read as 'use it or lose it'.",
  );
}

// ---------------------------------------------------------------------------------------------
// HOURS-MAX-01: normal hours above 8 a day or 48 a week (6 and 36 in Ramadan)
// ---------------------------------------------------------------------------------------------

const HOURS_TOPIC =
  /\bworking hours\b|\bhours of work\b|\bwork(?:ing)? (?:day|week)\b|\bhours (?:a|per|each|every) (?:working )?(?:day|week)\b|\b(?:daily|weekly)\b/;
const OVERTIME_WORDS = /\bover[- ]?time\b|\b(?:extra|additional) (?:working )?hours\b/;
const RAMADAN = /\bramadan\b/;

interface HourLimits {
  daily: number;
  weekly: number;
}

const NORMAL_LIMITS: HourLimits = { daily: 8, weekly: 48 };
const RAMADAN_LIMITS: HourLimits = { daily: 6, weekly: 36 };

export function detectWorkingHours({ text }: ClauseText): Detection | null {
  if (!HOURS_TOPIC.test(text)) return null;
  const limits = RAMADAN.test(text) ? RAMADAN_LIMITS : NORMAL_LIMITS;
  const stated = statedHours(text);
  if (stated.length === 0) return null;

  const over = stated.find((hours) => hours.value > limits[hours.period]);
  if (over) {
    return problem(
      "likely_void",
      "high",
      `This clause sets normal working hours at ${formatNumber(over.value)} a ${over.period === "daily" ? "day" : "week"}. The Labor Law caps them at ${limits.daily} hours a day and ${limits.weekly} a week${limits === RAMADAN_LIMITS ? " during Ramadan" : ""}.`,
    );
  }
  if (stated.every((hours) => hours.value === limits[hours.period])) {
    return passes("compliant", `This clause sets working hours at the legal maximum.`);
  }
  return passes(
    "better_than_law",
    `This clause sets working hours below the legal maximum of ${limits.daily} hours a day and ${limits.weekly} a week.`,
  );
}

/** Normal-hours figures in the clause, each read as daily or weekly. Overtime figures are skipped. */
function statedHours(text: string): { value: number; period: "daily" | "weekly" }[] {
  return splitSentences(text).flatMap((sentence) => {
    const overtimeAt = sentence.search(OVERTIME_WORDS);
    return findQuantities(sentence)
      .filter((quantity) => quantity.unit === "hour")
      .filter((quantity) => overtimeAt === -1 || quantity.index < overtimeAt)
      .flatMap((quantity) => {
        const period = hoursPeriod(sentence, quantity);
        return period ? [{ value: quantity.value, period }] : [];
      });
  });
}

/** Whether "N hours" is per day or per week, from the words right after or before it. */
function hoursPeriod(sentence: string, quantity: Quantity): "daily" | "weekly" | null {
  const after = sentence.slice(quantity.end, quantity.end + 30);
  const before = sentence.slice(Math.max(0, quantity.index - 40), quantity.index);
  if (
    /^\s*(?:of work\s+)?(?:a|per|each|every|in a|in each)\s+(?:working\s+)?day\b|^\s*daily\b/.test(
      after,
    )
  ) {
    return "daily";
  }
  if (
    /^\s*(?:of work\s+)?(?:a|per|each|every|in a|in each)\s+(?:working\s+)?week\b|^\s*weekly\b/.test(
      after,
    )
  ) {
    return "weekly";
  }
  if (/\bdaily\b|\b(?:a|per|each) day\b/.test(before)) return "daily";
  if (/\bweekly\b|\b(?:a|per|each) week\b/.test(before)) return "weekly";
  return null;
}
