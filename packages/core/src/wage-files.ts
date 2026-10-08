import type { PayrollRecord, WageRecord } from "./wage-check";

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
  other: "OtherAllowances",
  deductions: "Deductions",
  net: "NetSalary",
};

/** One row per person and source: "qiwa" for the Qiwa contract, "offline" for the offer letter. */
export const CONTRACT_COLUMNS = {
  employeeId: "EmployeeID",
  name: "EmployeeName",
  source: "Source",
  basic: "BasicSalary",
  housing: "HousingAllowance",
  transport: "TransportAllowance",
  total: "TotalWage",
};

export class WageFileError extends Error {
  override readonly name = "WageFileError";
}

export function readPayrollCsv(text: string): PayrollRecord[] {
  return readRows(text, Object.values(PAYROLL_COLUMNS)).map((row) => {
    const c = PAYROLL_COLUMNS;
    const basic = amount(row, c.basic) ?? 0;
    const housing = amount(row, c.housing) ?? 0;
    const transport = amount(row, c.other) ?? 0;
    return {
      employeeId: id(row, c.employeeId),
      name: row.get(c.name) || null,
      basic,
      housing,
      transport,
      total: Math.round((basic + housing + transport) * 100) / 100,
      deductions: amount(row, c.deductions) ?? 0,
      net: amount(row, c.net) ?? 0,
    };
  });
}

export function readContractsCsv(text: string): {
  qiwa: WageRecord[];
  offers: WageRecord[];
} {
  const c = CONTRACT_COLUMNS;
  const qiwa: WageRecord[] = [];
  const offers: WageRecord[] = [];
  for (const row of readRows(text, [c.employeeId, c.source, c.total])) {
    const record: WageRecord = {
      employeeId: id(row, c.employeeId),
      name: row.get(c.name) || null,
      basic: amount(row, c.basic),
      housing: amount(row, c.housing),
      transport: amount(row, c.transport),
      total: amount(row, c.total),
    };
    const source = row.get(c.source)?.toLowerCase();
    if (source === "qiwa") qiwa.push(record);
    else if (source === "offline") offers.push(record);
    else
      throw new WageFileError(
        `${c.source} must be "qiwa" or "offline", not "${source}".`,
      );
  }
  return { qiwa, offers };
}

/** Rows as header → value maps. Handles a BOM, CRLF and quoted cells. */
function readRows(text: string, required: string[]): Map<string, string>[] {
  const [header, ...rows] = parseCsv(text.replace(/^\uFEFF/, ""));
  if (!header) throw new WageFileError("The file is empty.");
  const missing = required.filter((name) => !header.includes(name));
  if (missing.length > 0) {
    throw new WageFileError(`Missing column(s): ${missing.join(", ")}.`);
  }
  return rows
    .filter((cells) => cells.some((cell) => cell !== ""))
    .map((cells) => new Map(header.map((name, i) => [name, cells[i] ?? ""])));
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const endCell = () => {
    row.push(cell.trim());
    cell = "";
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted && ch === '"' && text[i + 1] === '"') {
      cell += '"';
      i++;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (quoted || (ch !== "," && ch !== "\n" && ch !== "\r")) {
      cell += ch;
    } else if (ch === ",") {
      endCell();
    } else {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endCell();
      rows.push(row);
      row = [];
    }
  }
  if (cell !== "" || row.length > 0) {
    endCell();
    rows.push(row);
  }
  return rows;
}

function id(row: Map<string, string>, column: string): string {
  const value = row.get(column)?.replace(/\D/g, "");
  if (!value) throw new WageFileError(`A row has no ${column}.`);
  return value;
}

function amount(row: Map<string, string>, column: string): number | null {
  const raw = row.get(column)?.replace(/[,\s]/g, "");
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value))
    throw new WageFileError(`${column} "${raw}" is not a number.`);
  return value;
}
