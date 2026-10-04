import type { ContractFields, Finding, Impact, Severity } from "@rater/contracts";
import { termMonthsOf } from "./engine/term";
import { isProblemVerdict } from "./engine/verdicts";
import type { AnalysedFinding } from "./types";

/*
 * Step 5: SAR impact with plain formulas. Only problem findings get an impact, and only when
 * the contract states the numbers the formula needs. An Art. 77 clause that pays at least the
 * legal default stops being a problem here (it keeps the comparison).
 */

/** Statutory minimum annual leave (Art. 109) that leave_value counts the shortfall against. */
const ANNUAL_LEAVE_MIN_DAYS = 21;
/** The law counts a month as 30 days when turning a monthly wage into a daily one. */
const DAYS_PER_MONTH = 30;
/** Art. 77 floor: never less than two months' wage. */
const ART77_FLOOR_MONTHS = 2;
/**
 * A fixed Art. 77 amount that undercuts the legal default by at least this many months of the
 * total wage is a large loss for the worker, so the finding is raised to high severity even
 * though the clause is lawful. Test #1: two months' basic against a 12-month term.
 */
const ART77_ESCALATION_MONTHS = 6;
const ART77_AT_LEAST_DEFAULT_MSG =
  "The fixed compensation for ending the contract without a valid reason is at least what Art. 77 would pay by default.";

/** Adds the SAR impact to each finding and returns plain Finding objects. */
export function applyImpact(
  findings: AnalysedFinding[],
  fields: ContractFields,
): Finding[] {
  return findings.map((analysed) => {
    const { impactParams: _params, impactKind: _kind, ...finding } = analysed;
    if (!isProblemVerdict(finding.verdict)) return finding;
    switch (analysed.impactKind ?? analysed.impact?.kind) {
      case "eos_gap":
        return { ...finding, impact: eosGap(analysed, fields) ?? finding.impact };
      case "art77_gap":
        return withArt77Gap(finding, analysed, fields);
      case "leave_value":
        return {
          ...finding,
          impact:
            leaveValue(leaveDaysOf(analysed, fields), fields.wage) ?? finding.impact,
        };
      default:
        return finding;
    }
  });
}

/**
 * End-of-service award lost when it is calculated on basic wage instead of the actual wage.
 * The award is half a month's wage per year for years 1-5 and a full month's wage per year
 * after that (Art. 84), so with d = total − basic: 1y = d/2, 5y = 5d/2, 10y = 5d/2 + 5d.
 */
function eosGap(finding: AnalysedFinding, fields: ContractFields): Impact | null {
  const wage = fields.wage;
  if (finding.impactParams?.eosBase !== "basic" || wage === null) return null;
  const monthlyGap = wage.total - wage.basic;
  if (monthlyGap <= 0) return null;
  const firstFiveYears = 5 * (monthlyGap / 2);
  return {
    kind: "eos_gap",
    sar: {
      "1y": roundSar(monthlyGap / 2),
      "5y": roundSar(firstFiveYears),
      "10y": roundSar(firstFiveYears + 5 * monthlyGap),
    },
    note: "Award lost by calculating it on basic wage instead of the actual wage, after 1, 5 and 10 years of service.",
  };
}

/**
 * Fixed compensation for ending the contract without a valid reason (Art. 77) against the
 * legal default. For a fixed-term contract the default is the wages for the rest of the term;
 * the worst case is an ending right after a renewal, which is a whole term. The term comes from
 * clause 5.1, or from the start and end dates when 5.1 could not be read. Without a known
 * fixed term the default is shown at the statutory floor of two months' wage.
 */
function withArt77Gap(
  finding: Finding,
  analysed: AnalysedFinding,
  fields: ContractFields,
): Finding {
  const months = analysed.impactParams?.compensationMonths;
  const wage = fields.wage;
  if (months === undefined || wage === null) return finding;

  // "Wage" in the law means the actual (total) wage (Art. 2), so only an explicit "basic" uses basic.
  const contractBase =
    analysed.impactParams?.compensationBase === "basic" ? wage.basic : wage.total;
  const contract = months * contractBase;
  const termMonths = fields.contractType === "fixed_term" ? termMonthsOf(fields) : null;
  const defaultMonths = termMonths ?? ART77_FLOOR_MONTHS;
  const legalDefault = wage.total * defaultMonths;
  const gap = legalDefault - contract;

  const impact: Impact = {
    kind: "art77_gap",
    sar: {
      contract: roundSar(contract),
      default: roundSar(legalDefault),
      gap: roundSar(gap),
    },
    note:
      termMonths !== null
        ? `Legal default: wages for the rest of the term, up to ${defaultMonths} months if the contract is ended right after a renewal.`
        : "Legal default shown at the Art. 77 floor of two months' wage.",
  };
  if (gap <= 0) return paysAtLeastTheDefault(finding, impact);
  const escalate =
    finding.verdict === "worse_than_default" &&
    gap >= ART77_ESCALATION_MONTHS * wage.total;
  const severity: Severity = escalate ? "high" : finding.severity;
  return { ...finding, impact, severity };
}

/**
 * A fixed amount that is at least the legal default costs the worker nothing, so the finding
 * is not a problem: compliant, no severity, nothing to ask for. The comparison stays attached.
 */
function paysAtLeastTheDefault(finding: Finding, impact: Impact): Finding {
  const { askFor: _askFor, suggestedWording: _wording, ...rest } = finding;
  return {
    ...rest,
    verdict: "compliant",
    severity: "none",
    impact,
    explanation: `${finding.explanation} The fixed amount is at least the legal default, so it costs the worker nothing.`,
    employeeMsg: ART77_AT_LEAST_DEFAULT_MSG,
    hrMsg: ART77_AT_LEAST_DEFAULT_MSG,
  };
}

/**
 * The annual leave days a finding is about. A field finding is about clause 8.1. A Section 15
 * finding is about its own clause, whose day count the analyser does not report (ImpactParams
 * has no leave days yet), so it gets no figure rather than 8.1's shortfall, which the field
 * finding already shows.
 */
function leaveDaysOf(analysed: AnalysedFinding, fields: ContractFields): number | null {
  return analysed.source === "clause" ? null : fields.annualLeaveDays;
}

/** Value of the leave days below the legal minimum, per year, at the daily wage (total / 30). */
function leaveValue(days: number | null, wage: ContractFields["wage"]): Impact | null {
  if (days === null || wage === null || days >= ANNUAL_LEAVE_MIN_DAYS) return null;
  const missingDays = ANNUAL_LEAVE_MIN_DAYS - days;
  return {
    kind: "leave_value",
    sar: { perYear: roundSar(missingDays * (wage.total / DAYS_PER_MONTH)) },
    note: `${missingDays} days of leave a year below the legal minimum, at the daily wage.`,
  };
}

function roundSar(amount: number): number {
  return Math.round(amount * 100) / 100;
}
