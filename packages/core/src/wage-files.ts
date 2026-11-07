import type { WageCheckInput, WageRecord } from "./wage-check";

/*
 * CSV readers for the wage check. The column names follow an unofficial Mudad/WPS template;
 * when the real one arrives, only these maps need to change. An Excel sheet is read as the
 * same rows (the API turns it into CSV first).
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

/**
 * Arabic names the columns go by in Saudi HR and payroll exports. Headers are compared
 * loosely (see headerKey), so "Employee ID", "employee_id" and "رقم الهوية / الإقامة" match too.
 */
const ARABIC_NAMES: Record<string, string[]> = {
  EmployeeID: ["رقم الهوية", "رقم الإقامة", "رقم الهوية / الإقامة", "رقم الهوية/الإقامة"],
  EmployeeName: ["اسم الموظف", "اسم العامل", "الاسم"],
  BasicSalary: ["الراتب الأساسي", "الأجر الأساسي"],
  HousingAllowance: ["بدل السكن"],
  OtherAllowances: ["البدلات الأخرى", "بدلات أخرى"],
  TransportAllowance: ["بدل النقل", "بدل المواصلات"],
  TotalWage: ["إجمالي الأجر", "إجمالي الراتب", "الإجمالي"],
  Source: ["المصدر"],
};

/** Exports often put a title or a date above the header row; it is looked for this far down. */
const HEADER_SEARCH_ROWS = 10;

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

/**
 * Rows as column → cell maps, keyed by our English column names whatever the file calls them.
 * Tolerates a BOM, CRLF, quoted cells, empty rows and title rows above the header.
 */
function readRows(text: string, columns: Record<string, string>): Map<string, string>[] {
  const lines = text.replace("\uFEFF", "").split(/\r?\n/);
  const names = Object.values(columns);
  const headerOf = (line: string) => cells(line).map((cell) => columnName(cell, names));
  const found = lines
    .slice(0, HEADER_SEARCH_ROWS)
    .findIndex((line) => headerOf(line).includes(columns.employeeId as string));
  const header = headerOf(lines.splice(0, Math.max(found, 0) + 1).pop() ?? "");
  const missing = names.filter((name) => !header.includes(name));
  if (missing.length > 0) {
    const described = missing.map((name) => {
      const arabic = ARABIC_NAMES[name]?.[0];
      return arabic ? `${name} (${arabic})` : name;
    });
    throw new WageFileError(`Missing columns: ${described.join(", ")}.`);
  }
  return lines
    .filter((line) => line.replace(/[,\s]/g, ""))
    .map((line) => {
      const row = cells(line);
      return new Map(header.map((name, i) => [name, row[i] ?? ""]));
    });
}

/** Which of `names` a header cell means, by its English or Arabic name; else the cell itself. */
function columnName(cell: string, names: string[]): string {
  const key = headerKey(cell);
  const match = names.find((name) =>
    [name, ...(ARABIC_NAMES[name] ?? [])].some((alias) => headerKey(alias) === key),
  );
  return match ?? cell;
}

/**
 * A header compared loosely: letters and digits only, lower case, and the Arabic letters
 * people type in more than one way folded together (أ إ آ → ا, ة → ه, ى → ي).
 */
function headerKey(header: string): string {
  return header
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/** Arabic-Indic digits (٠-٩, ۰-۹) as 0-9, and the Arabic decimal sign as a point. */
function latinDigits(text: string): string {
  return text
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\u066B/g, ".");
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
  const employeeId = latinDigits(row.get(c.employeeId) ?? "").replace(/\D/g, "");
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
  // Thousands separators, as in "6,500" or "٦٬٥٠٠", are dropped.
  const raw = latinDigits(row.get(column) ?? "").replace(/[\s,\u066C]/g, "");
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value))
    throw new WageFileError(`${column} "${raw}" is not a number.`);
  return value;
}
