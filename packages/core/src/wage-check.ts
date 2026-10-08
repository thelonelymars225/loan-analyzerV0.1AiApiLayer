import type {
  EmployeeWageCheck,
  WageCheckResponse,
  WageField,
  WageIssue,
} from "@rater/contracts";

/** One person's monthly pay as one source states it, in SAR. Null: the source does not say. */
export interface WageRecord {
  /** National ID or iqama number. */
  employeeId: string;
  name: string | null;
  basic: number | null;
  housing: number | null;
  transport: number | null;
  total: number | null;
}

/** One payroll row. `transport` holds all other allowances; `total` is gross pay. */
export interface PayrollRecord extends WageRecord {
  deductions: number;
  net: number;
}

export interface WageCheckInput {
  qiwa: WageRecord[];
  offers: WageRecord[];
  payroll: PayrollRecord[];
}

const PARTS = ["basic", "housing", "transport"] as const;
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
  const ids = [...new Set([...qiwa.keys(), ...payroll.keys()])];

  const employees: EmployeeWageCheck[] = ids.map((id) => {
    const contract = qiwa.get(id);
    const paid = payroll.get(id);
    const offer = offers.get(id);
    const issues: WageIssue[] = [];
    if (contract && paid) issues.push(...comparePayroll(contract, paid));
    if (contract && offer) issues.push(...compareOffer(contract, offer));
    if (!contract) issues.push(noContract());
    if (!paid) issues.push(notPaid(contract?.total ?? null));
    if (paid) issues.push(...checkPayrollRow(paid));
    const name = paid?.name ?? contract?.name ?? offer?.name ?? null;
    return { employeeId: id, name, issues };
  });

  employees.sort((a, b) => Number(b.issues.length > 0) - Number(a.issues.length > 0));
  const underpaidSar = employees
    .flatMap((e) => e.issues)
    .filter((i) => i.kind === "underpaid")
    .reduce((sum, i) => sum - (i.gap ?? 0), 0);
  return {
    summary: {
      employees: employees.length,
      flagged: employees.filter((e) => e.issues.length > 0).length,
      underpaidSar: round(underpaidSar),
    },
    employees,
  };
}

function comparePayroll(contract: WageRecord, paid: PayrollRecord): WageIssue[] {
  const issues: WageIssue[] = [];
  for (const field of PARTS) {
    const gap = diff(contract[field], paid[field]);
    if (gap === null || Math.abs(gap) < EPSILON) continue;
    if (field === "transport" && gap > 0) continue;
    issues.push(
      issue("payroll_differs", field, contract[field], paid[field], {
        articles: gap < 0 ? payArticles(field) : [],
        message:
          gap < 0
            ? `Payroll pays ${fmt(-gap)} SAR less ${field} than the Qiwa contract.`
            : `Payroll pays ${fmt(gap)} SAR more ${field} than the Qiwa contract: update the contract so the raise is documented.`,
      }),
    );
  }
  const gap = diff(contract.total, paid.total);
  if (gap !== null && gap <= -EPSILON) {
    issues.push(
      issue("underpaid", "total", contract.total, paid.total, {
        articles: ["61"],
        message: `Underpaid ${fmt(-gap)} SAR this month against the Qiwa contract.`,
      }),
    );
  }
  return issues;
}

function compareOffer(contract: WageRecord, offer: WageRecord): WageIssue[] {
  const issues: WageIssue[] = [];
  for (const field of [...PARTS, "total"] as const) {
    const gap = diff(contract[field], offer[field]);
    if (gap === null || Math.abs(gap) < EPSILON) continue;
    issues.push(
      issue("offer_differs", field, contract[field], offer[field], {
        articles: [],
        message:
          gap > 0
            ? `The offer letter promised ${fmt(gap)} SAR more ${field} than the Qiwa contract says.`
            : `The offer letter says ${fmt(-gap)} SAR less ${field} than the Qiwa contract.`,
      }),
    );
  }
  return issues;
}

function noContract(): WageIssue {
  return issue("no_contract", null, null, null, {
    articles: ["37"],
    message: "Paid through payroll, but there is no Qiwa contract for this ID.",
  });
}

function notPaid(total: number | null): WageIssue {
  return issue("not_paid", "total", total, null, {
    articles: ["61"],
    message: "Has a Qiwa contract but is missing from this month's payroll.",
  });
}

function checkPayrollRow(paid: PayrollRecord): WageIssue[] {
  const gross = paid.total ?? 0;
  const issues: WageIssue[] = [];
  if (paid.deductions > gross / 2 + EPSILON) {
    issues.push(
      issue("deductions_over_half", "deductions", round(gross / 2), paid.deductions, {
        articles: ["93"],
        message: `Deductions of ${fmt(paid.deductions)} SAR are more than half the ${fmt(gross)} SAR wage.`,
      }),
    );
  }
  const expectedNet = round(gross - paid.deductions);
  if (Math.abs(paid.net - expectedNet) >= EPSILON) {
    issues.push(
      issue("net_mismatch", "net", expectedNet, paid.net, {
        articles: [],
        message: `Net pay ${fmt(paid.net)} SAR is not gross minus deductions (${fmt(expectedNet)} SAR): check the wage file.`,
      }),
    );
  }
  return issues;
}

/** A lower basic also lowers end-of-service (Art. 84) and Art. 77 compensation. */
function payArticles(field: WageField): string[] {
  return field === "basic" ? ["61", "84", "77"] : ["61"];
}

function issue(
  kind: WageIssue["kind"],
  field: WageField | null,
  expected: number | null,
  actual: number | null,
  rest: Pick<WageIssue, "articles" | "message">,
): WageIssue {
  return { kind, field, expected, actual, gap: diff(expected, actual), ...rest };
}

function diff(expected: number | null, actual: number | null): number | null {
  return expected === null || actual === null ? null : round(actual - expected);
}

function byId<T extends WageRecord>(records: T[]): Map<string, T> {
  return new Map(records.map((r) => [r.employeeId, r]));
}

const round = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
