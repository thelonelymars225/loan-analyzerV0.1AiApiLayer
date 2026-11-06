import type { WageCheckInput, WageRecord } from "./wage-check";

/*
 * CSV readers for the wage check. The column names follow an unofficial Mudad/WPS template;
 * when the real one arrives, only these maps need to change.
 */

export const PAYROLL_COLUMNS = {
  employeeId: "EmployeeID",
  name: "EmployeeName",
  basic: "BasicSalary",
  housing: "HousingAllowance",
  /** Every other allowance, transport included. */
  transport: "OtherAllowances",
};

/** One row per person and source: "qiwa" for the Qiwa contract, "offline" for the offer letter. */
export const CONTRACT_COLUMNS = {
  ...PAYROLL_COLUMNS,
  transport: "TransportAllowance",
  total: "TotalWage",
  source: "Source",
};

export class WageFileError extends Error {
  override readonly name = "WageFileError";
}

/** Payroll rows, as paid (see asPaid). */
export function readPayrollCsv(text: string): WageRecord[] {
  return readRows(text, PAYROLL_COLUMNS).map((row) =>
    asPaid(toRecord(row, PAYROLL_COLUMNS)),
  );
}

/** A payroll row as paid: a missing amount is 0, and a missing total is the sum of the parts. */
export function asPaid(r: WageRecord): WageRecord {
  const [basic, housing, transport] = [r.basic ?? 0, r.housing ?? 0, r.transport ?? 0];
  const total = r.total ?? Math.round((basic + housing + transport) * 100) / 100;
  return { ...r, basic, housing, transport, total };
}

export function readContractsCsv(text: string): Pick<WageCheckInput, "qiwa" | "offers"> {
  const c = CONTRACT_COLUMNS;
  const qiwa: WageRecord[] = [];
  const offers: WageRecord[] = [];
  for (const row of readRows(text, c)) {
    const record = { ...toRecord(row, c), total: amount(row, c.total) };
    const source = row.get(c.source)?.toLowerCase();
    if (source === "qiwa") qiwa.push(record);
    else if (source === "offline") offers.push(record);
    else throw new WageFileError(`${c.source} must be qiwa or offline, not "${source}".`);
  }
  return { qiwa, offers };
}

/** Rows as column → cell maps. Tolerates a BOM, CRLF, quoted cells and empty rows. */
function readRows(text: string, columns: Record<string, string>): Map<string, string>[] {
  const lines = text.replace("\uFEFF", "").split(/\r?\n/);
  const header = cells(lines.shift() ?? "");
  const missing = Object.values(columns).filter((name) => !header.includes(name));
  if (missing.length > 0)
    throw new WageFileError(`Missing columns: ${missing.join(", ")}.`);
  return lines
    .filter((line) => line.replace(/[,\s]/g, ""))
    .map((line) => {
      const row = cells(line);
      return new Map(header.map((name, i) => [name, row[i] ?? ""]));
    });
}

/** One line's cells. Excel quotes a cell holding a comma: "Khan, Imran" or "6,500". */
const cells = (line: string) =>
  line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((cell) =>
    cell
      .trim()
      .replace(/^"(.*)"$/, "$1")
      .replace(/""/g, '"'),
  );

function toRecord(row: Map<string, string>, c: typeof PAYROLL_COLUMNS): WageRecord {
  const employeeId = row.get(c.employeeId)?.replace(/\D/g, "");
  if (!employeeId) {
    const line = [...row.values()].join(",");
    throw new WageFileError(`A row has no ${c.employeeId}: ${line}`);
  }
  return {
    employeeId,
    name: row.get(c.name) || null,
    basic: amount(row, c.basic),
    housing: amount(row, c.housing),
    transport: amount(row, c.transport),
    total: null,
  };
}

function amount(row: Map<string, string>, column: string): number | null {
  // Thousands separators, as in "6,500", are dropped.
  const raw = row.get(column)?.replace(/[\s,]/g, "");
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value))
    throw new WageFileError(`${column} "${raw}" is not a number.`);
  return value;
}
