import type { WageCheckResponse, WageIssue } from "@rater/contracts";

/** One person's monthly pay as one source states it, in SAR. Null: the source does not say. */
export interface WageRecord {
  /** National ID or iqama number. */
  employeeId: string;
  name: string | null;
  basic: number | null;
  housing: number | null;
  /** In payroll: every other allowance, transport included. */
  transport: number | null;
  total: number | null;
}

export interface WageCheckInput {
  qiwa: WageRecord[];
  offers: WageRecord[];
  payroll: WageRecord[];
}

const FIELDS = ["basic", "housing", "transport", "total"] as const;
/** Articles a shortfall touches. A lower basic also lowers end-of-service (84) and Art. 77 pay. */
const ARTICLES = {
  basic: ["61", "84", "77"],
  housing: ["61"],
  transport: ["61"],
  total: ["61"],
};
/** Half a halala: amounts are compared after rounding to two decimals. */
const EPSILON = 0.005;

/**
 * Compares each person's Qiwa contract with their payroll row and offer letter.
 * Basic and housing must match exactly. Payroll "other allowances" may exceed the contract's
 * transport (overtime and bonuses land there), but not fall short of it.
 */
export function checkWages(input: WageCheckInput): WageCheckResponse {
  const qiwa = byId(input.qiwa);
  const offers = byId(input.offers);
  const payroll = byId(input.payroll);
  const employees = [...new Set([...qiwa.keys(), ...payroll.keys()])].map((id) => {
    const contract = qiwa.get(id);
    const paid = payroll.get(id);
    const offer = offers.get(id);
    const issues: WageIssue[] = [];
    if (contract && paid) issues.push(...compare(contract, paid, "payroll"));
    if (contract && offer) issues.push(...compare(contract, offer, "offer"));
    if (!contract) {
      const message = "Paid through payroll, but there is no Qiwa contract for this ID.";
      issues.push({ ...NONE, kind: "no_contract", articles: ["37"], message });
    }
    if (!paid) {
      const message = "Has a Qiwa contract but is missing from this month's payroll.";
      issues.push({
        ...NONE,
        kind: "not_paid",
        field: "total",
        articles: ["61"],
        message,
      });
    }
    const name = paid?.name ?? contract?.name ?? offer?.name ?? null;
    return { employeeId: id, name, issues };
  });
  employees.sort((a, b) => Number(b.issues.length > 0) - Number(a.issues.length > 0));
  const flagged = employees.filter((e) => e.issues.length > 0).length;
  return { summary: { employees: employees.length, flagged }, employees };
}

/** An issue where one source has nothing to compare. */
const NONE = { field: null, expected: null, actual: null, gap: null };

/** Field-by-field gaps between the Qiwa contract and the other source. */
function compare(contract: WageRecord, other: WageRecord, source: "payroll" | "offer") {
  const issues: WageIssue[] = [];
  for (const field of FIELDS) {
    const expected = contract[field];
    const actual = other[field];
    if (expected === null || actual === null) continue;
    const gap = round(actual - expected);
    // Payroll may exceed the contract's transport, and so its total: overtime and bonuses.
    const extra =
      source === "payroll" && gap > 0 && !["basic", "housing"].includes(field);
    if (Math.abs(gap) < EPSILON || extra) continue;
    const push = (kind: WageIssue["kind"], articles: string[], message: string) =>
      issues.push({ kind, field, expected, actual, gap, articles, message });
    const diff = `${fmt(Math.abs(gap))} SAR ${gap < 0 ? "less" : "more"} ${field}`;
    if (source === "offer") {
      push("offer_differs", [], `Offer letter: ${diff} than Qiwa.`);
    } else if (field === "total") {
      push("underpaid", ["61"], `Underpaid ${fmt(-gap)} SAR this month.`);
    } else {
      const articles = gap < 0 ? ARTICLES[field] : [];
      push("payroll_differs", articles, `Payroll: ${diff} than Qiwa.`);
    }
  }
  return issues;
}

const byId = (records: WageRecord[]) => new Map(records.map((r) => [r.employeeId, r]));
const round = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
