import { createHash } from "node:crypto";
import type {
  Clause,
  ContractFieldName,
  ContractFields,
  ContractType,
  FieldProvenance,
  ProbationExcludedDay,
  Wage,
} from "@rater/contracts";
import { pageRows, rowText, type TextRow, type TextSegment } from "./bbox";
import { arabicPhrasePattern, isArabicText, normaliseArabic } from "./detect";
import type {
  ExtractionIssue,
  ExtractionResult,
  NamePlaceholder,
  PageLayout,
  PageRegion,
} from "./types";

// ---------------------------------------------------------------------------------------------
// Document model: the page rows of the whole contract, footers removed.
// ---------------------------------------------------------------------------------------------

/** One text row of the contract with its English and Arabic cells. */
interface Line {
  page: number;
  yMin: number;
  yMax: number;
  en: TextSegment[];
  ar: TextSegment[];
}

type SectionKey =
  | "contractInfo"
  | "firstParty"
  | "secondParty"
  | "profession"
  | "period"
  | "probation"
  | "hours"
  | "leave"
  | "wage"
  | "bank"
  | "firstObligations"
  | "secondObligations"
  | "law"
  | "general"
  | "additional"
  | "appendix";

/** Section headings are found by title, not by number or position, so renumbering is tolerated. */
const SECTION_TITLES: [SectionKey, RegExp][] = [
  ["contractInfo", /^contract information/i],
  ["firstParty", /^first party'?s information/i],
  ["secondParty", /^second party'?s information/i],
  ["profession", /^profession/i],
  ["period", /^contract period/i],
  ["probation", /^probation/i],
  ["hours", /^work hours/i],
  ["leave", /^annual leave/i],
  ["wage", /^wages? (&|and) benefits/i],
  ["bank", /bank account/i],
  ["firstObligations", /^first party'?s obligations/i],
  ["secondObligations", /^second party'?s obligations/i],
  ["law", /^applicable law/i],
  ["general", /^general provisions/i],
  ["additional", /^additional terms/i],
  ["appendix", /^appendix/i],
];

interface Section {
  key: SectionKey;
  /** Index of the heading line. */
  start: number;
  /** Index of the next heading line (exclusive end of the body). */
  end: number;
}

class ContractDocument {
  readonly lines: Line[];
  readonly footers: TextRow[];
  readonly sections: Section[];
  readonly pageSizes = new Map<number, { width: number; height: number }>();

  constructor(pages: PageLayout[]) {
    this.lines = [];
    this.footers = [];
    for (const page of pages) {
      this.pageSizes.set(page.page, { width: page.width, height: page.height });
      for (const row of pageRows(page)) {
        if (isFooter(row, page)) this.footers.push(row);
        else this.lines.push(toLine(row));
      }
    }
    this.sections = findSections(this.lines);
  }

  section(key: SectionKey): Section | undefined {
    return this.sections.find((s) => s.key === key);
  }

  /** Lines of a section body (heading excluded); the whole document when the heading is missing. */
  sectionLines(key: SectionKey): Line[] {
    const section = this.section(key);
    return section ? this.lines.slice(section.start + 1, section.end) : this.lines;
  }

  /** English text of a section body as one whitespace-normalised string. */
  sectionText(key: SectionKey): string {
    return englishText(this.sectionLines(key));
  }
}

function toLine(row: TextRow): Line {
  return {
    page: row.page,
    yMin: row.yMin,
    yMax: row.yMax,
    en: row.segments.filter((s) => s.column === "en"),
    ar: row.segments.filter((s) => s.column === "ar"),
  };
}

/** Bottom band of every page holds "downloaded at ... by ..." and the page number. */
const FOOTER_BAND_PT = 60;
/** "تم التحميل بتاريخ" (downloaded at) only ever appears in the footer. */
const DOWNLOADED_AT = arabicPhrasePattern("تم التحميل بتاريخ");

function isFooter(row: TextRow, page: PageLayout): boolean {
  return (
    row.yMin >= page.height - FOOTER_BAND_PT ||
    DOWNLOADED_AT.test(normaliseArabic(rowText(row)))
  );
}

function findSections(lines: Line[]): Section[] {
  const headings: { key: SectionKey; index: number }[] = [];
  lines.forEach((line, index) => {
    const first = line.en[0];
    const match = first ? /^(\d{1,2})\.\s+(.+)$/.exec(cleanEnglish(first.text)) : null;
    if (!match?.[2]) return;
    const title = match[2];
    const found = SECTION_TITLES.find(
      ([key, pattern]) => pattern.test(title) && !headings.some((h) => h.key === key),
    );
    if (found) headings.push({ key: found[0], index });
  });
  return headings.map((heading, i) => ({
    key: heading.key,
    start: heading.index,
    end: headings[i + 1]?.index ?? lines.length,
  }));
}

/** Straight quotes and single spaces, so labels and phrases match however the PDF typed them. */
function cleanEnglish(text: string): string {
  return text
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function englishText(lines: Line[]): string {
  return cleanEnglish(
    lines.map((line) => line.en.map((s) => s.text).join(" ")).join(" "),
  );
}

// ---------------------------------------------------------------------------------------------
// Labelled values ("Contract type:  Fixed-term Contract")
// ---------------------------------------------------------------------------------------------

interface LabelledValue {
  /** Label without clause numbering or the trailing colon, lower-cased. */
  label: string;
  /** English-column value as printed (may be Arabic, e.g. names). */
  value: string;
  /** Arabic-column value as printed (pdftotext visual order). */
  valueAr: string;
  page: number;
  lineIndex: number;
}

/** Continuation lines of a wrapped label or value are one text line (~14 pt) apart. */
const WRAP_STEP_PT = 18;
/** A continuation line's text starts clearly right of the label's left edge. */
const LABEL_INDENT_PT = 12;

/**
 * Finds every "Label: value" pair in the English column. Tolerates labels that wrap onto a
 * second line ("Transportation" / "Allowance:"), values that wrap ("Power of Attorney with" /
 * "the Entity"), and values at any x offset.
 */
function collectLabelledValues(lines: Line[]): LabelledValue[] {
  const values: LabelledValue[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const first = line?.en[0];
    if (!line || !first) continue;

    let label = first.text;
    let labelEnd = i;
    const next = lines[i + 1];
    const nextFirst = next?.en[0];
    if (
      !label.trim().endsWith(":") &&
      next &&
      nextFirst &&
      isWrapOf(line, next) &&
      Math.abs(nextFirst.xMin - first.xMin) < 2 &&
      nextFirst.text.trim().endsWith(":")
    ) {
      label = `${label} ${nextFirst.text}`;
      labelEnd = i + 1;
    }
    if (!label.trim().endsWith(":")) continue;

    const arabicLabel = arabicLabelSegment(line.ar);
    const isArabicValue = (s: TextSegment) =>
      s !== arabicLabel &&
      !s.text.includes(":") &&
      !(arabicLabel && Math.abs(s.xMax - arabicLabel.xMax) < 2);
    // One entry per printed line, so wrapped values can be joined in reading order.
    const valueLines = [line.en.slice(1)];
    const arabicLines = [line.ar.filter(isArabicValue)];
    if (labelEnd > i) {
      valueLines.push(lines[labelEnd]?.en.slice(1) ?? []);
      arabicLines.push(lines[labelEnd]?.ar.filter(isArabicValue) ?? []);
    }
    let last = lines[labelEnd] ?? line;
    for (let j = labelEnd + 1; j < lines.length; j++) {
      const candidate = lines[j];
      if (!candidate || !isWrapOf(last, candidate)) break;
      const startsAtLabel =
        candidate.en[0] !== undefined &&
        candidate.en[0].xMin < first.xMin + LABEL_INDENT_PT;
      if (startsAtLabel) break;
      valueLines.push(candidate.en);
      arabicLines.push(candidate.ar.filter(isArabicValue));
      last = candidate;
    }

    values.push({
      label: normaliseLabel(label),
      value: joinLines(valueLines),
      valueAr: joinLines(arabicLines),
      page: line.page,
      lineIndex: i,
    });
    i = labelEnd;
  }
  return values;
}

function isWrapOf(previous: Line, next: Line): boolean {
  return (
    next.page === previous.page &&
    next.yMin - previous.yMin > 0 &&
    next.yMin - previous.yMin <= WRAP_STEP_PT
  );
}

/**
 * In the Arabic column the label is the rightmost cell and the value sits left of it. Lines that
 * continue the label are right-aligned with it; lines that continue the value are not.
 */
function arabicLabelSegment(segments: TextSegment[]): TextSegment | undefined {
  const rightmost = segments[segments.length - 1];
  if (!rightmost) return undefined;
  return segments.length >= 2 || rightmost.text.includes(":") ? rightmost : undefined;
}

/**
 * Joins the printed lines of a wrapped value. pdftotext gives Arabic in visual (reversed) order,
 * so Arabic lines are joined last line first: reversing the result then reads in logical order.
 */
function joinLines(lines: TextSegment[][]): string {
  const texts = lines
    .map((segments) =>
      segments
        .map((s) => s.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
  const ordered = texts.every(isArabicText) ? [...texts].reverse() : texts;
  return ordered.join(" ");
}

function normaliseLabel(label: string): string {
  return cleanEnglish(label)
    .replace(/^\d+(\.\d+)*\.?\s+/, "")
    .replace(/\s*:\s*$/, "")
    .toLowerCase();
}

class LabelIndex {
  private readonly values: LabelledValue[];

  constructor(private readonly doc: ContractDocument) {
    this.values = collectLabelledValues(doc.lines);
  }

  /** First value whose label matches, preferring the given section. */
  find(label: RegExp, sectionKey?: SectionKey): LabelledValue | undefined {
    const section = sectionKey ? this.doc.section(sectionKey) : undefined;
    const inSection = section
      ? this.values.find(
          (v) =>
            v.lineIndex > section.start &&
            v.lineIndex < section.end &&
            label.test(v.label),
        )
      : undefined;
    return inSection ?? this.values.find((v) => label.test(v.label));
  }

  findAll(label: RegExp, sectionKey: SectionKey): LabelledValue[] {
    const section = this.doc.section(sectionKey);
    if (!section) return [];
    return this.values.filter(
      (v) =>
        v.lineIndex > section.start && v.lineIndex < section.end && label.test(v.label),
    );
  }
}

// ---------------------------------------------------------------------------------------------
// Value parsers
// ---------------------------------------------------------------------------------------------

/** "2025/11/15" (Qiwa) or "15/11/2025" → "2025-11-15". Null when it is not a valid date. */
export function parseQiwaDate(text: string): string | null {
  const ymd = /(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/.exec(text);
  const dmy = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(text);
  const parts = ymd ? [ymd[1], ymd[2], ymd[3]] : dmy ? [dmy[3], dmy[2], dmy[1]] : null;
  if (!parts) return null;
  const [year, month, day] = parts.map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  if (!valid) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** "10,000.00 Monthly" → { amount: 10000, period: "monthly" }. */
export function parseMoney(
  text: string,
): { amount: number; period: string | null } | null {
  const match = /(\d[\d,]*(?:\.\d+)?)\s*([A-Za-z]+)?/.exec(text);
  if (!match?.[1]) return null;
  const amount = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(amount)) return null;
  return { amount, period: match[2]?.toLowerCase() ?? null };
}

/** Maps the printed contract type to the enum. */
export function mapContractType(raw: string | null): ContractType {
  if (!raw) return "unknown";
  if (/fixed[\s-]*(term|period|duration)/i.test(raw)) return "fixed_term";
  if (
    /indefinite|unlimited|open[\s-]*ended|unspecified (term|period|duration)/i.test(raw)
  )
    return "indefinite";
  if (/specific (work|task|project)|for a project/i.test(raw)) return "specific_work";
  return "unknown";
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

function parseCount(token: string | undefined): number | null {
  if (!token) return null;
  const word = NUMBER_WORDS[token.toLowerCase()];
  if (word !== undefined) return word;
  const value = Number(token);
  return Number.isFinite(value) ? value : null;
}

/** "valid for a period of 1 year" → 12; "... of 18 months" → 18. */
export function parseTermMonths(text: string): number | null {
  const match =
    /valid for a period of\s*\(?\s*(\d+|[a-z]+)\s*\)?\s*(year|month)s?\b/i.exec(text);
  const count = parseCount(match?.[1]);
  if (!match || count === null || count <= 0) return null;
  return match[2]?.toLowerCase() === "year" ? count * 12 : count;
}

const EXCLUDED_DAY_NAMES: [RegExp, ProbationExcludedDay][] = [
  [/eid al[\s-]*fitr/i, "eid_al_fitr"],
  [/eid al[\s-]*adha/i, "eid_al_adha"],
  [/national day/i, "national_day"],
  [/foundation day/i, "foundation_day"],
  [/sick leave/i, "sick_leave"],
];

function parseExcludedDays(probationText: string): ProbationExcludedDay[] {
  const match =
    /do not count towards (?:this|the probationary) period\s*:?([^.]*)\./i.exec(
      probationText,
    );
  if (!match?.[1]) return [];
  const items = match[1]
    .split(/,|\band\b/)
    .map((s) => s.trim())
    .filter(Boolean);
  return items.map(
    (item) => EXCLUDED_DAY_NAMES.find(([pattern]) => pattern.test(item))?.[1] ?? "other",
  );
}

function firstNumber(pattern: RegExp, text: string): number | null {
  const match = pattern.exec(text);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

// ---------------------------------------------------------------------------------------------
// Step 2: extraction
// ---------------------------------------------------------------------------------------------

const REQUIRED_FIELDS: ContractFieldName[] = [
  "contractType",
  "commencementDate",
  "probationDays",
  "annualLeaveDays",
  "wage",
];

/** Issues on these fields mean the numbers can't be trusted and a human should look. */
const BLOCKING_FIELDS = new Set<string>([...REQUIRED_FIELDS, "weeklyHours"]);

/** Wage parts must add up to the total within this many SAR. */
const WAGE_TOLERANCE_SAR = 1;

/** Step 2: reads sections 1-14 into ContractFields and Section 15 into clauses. */
export function extractContract(pages: PageLayout[]): ExtractionResult {
  const reader = new FieldReader(pages);
  const info = readContractInfo(reader);
  const fields: ContractFields = {
    ...info,
    ...readContractPeriod(reader, info.contractType),
    ...readProbation(reader),
    ...readWorkingTime(reader),
    annualLeaveDays: readAnnualLeave(reader),
    wage: readWage(reader),
    overtimePremiumPct: readOvertimePremium(reader),
    ...readEmployeeAndJob(reader),
  };
  checkRequiredFields(fields, reader);

  const section15 = readSection15(reader.doc);
  reader.issues.push(...section15.issues);
  const parties = readParties(reader.doc, reader.labels);
  return {
    fields,
    provenance: reader.provenance,
    clauses: section15.clauses,
    section15ArabicRegions: section15.regions,
    identifyingStrings: parties.strings,
    namePlaceholders: parties.placeholders,
    issues: reader.issues,
    needsReview: reader.issues.some((issue) => BLOCKING_FIELDS.has(issue.field)),
  };
}

/** What every section reader needs: the document, its labels, and where to record results. */
class FieldReader {
  readonly doc: ContractDocument;
  readonly labels: LabelIndex;
  readonly issues: ExtractionIssue[] = [];
  readonly provenance: ExtractionResult["provenance"] = {};

  constructor(pages: PageLayout[]) {
    this.doc = new ContractDocument(pages);
    this.labels = new LabelIndex(this.doc);
  }

  /** Records where a field was found. */
  note(
    field: ContractFieldName,
    page: number | null,
    confidence: FieldProvenance["confidence"] = "high",
  ): void {
    this.provenance[field] = { page, confidence };
  }

  /** Page of a section heading. */
  pageOf(key: SectionKey): number | null {
    return this.doc.lines[this.doc.section(key)?.start ?? -1]?.page ?? null;
  }

  /** First number captured by `pattern` in a section's English text; noted as found there. */
  numberIn(key: SectionKey, field: ContractFieldName, pattern: RegExp): number | null {
    const value = firstNumber(pattern, this.doc.sectionText(key));
    if (value !== null) this.note(field, this.pageOf(key));
    return value;
  }

  issue(field: string, message: string): void {
    this.issues.push({ field, message });
  }
}

/** Section 1: type and dates. */
function readContractInfo(reader: FieldReader) {
  const typeValue = reader.labels.find(/^contract type$/, "contractInfo");
  const contractTypeRaw = typeValue?.value || null;
  const contractType = mapContractType(contractTypeRaw);
  if (typeValue) reader.note("contractType", typeValue.page);
  if (contractTypeRaw && contractType === "unknown") {
    reader.issue("contractType", `Unrecognised contract type "${contractTypeRaw}".`);
  }
  return {
    contractType,
    contractTypeRaw,
    executionDate: readDate(reader, "executionDate", /^contract execution date$/),
    commencementDate: readDate(
      reader,
      "commencementDate",
      /^commencement date$/,
      /^starting date$/,
    ),
    endDate: readDate(reader, "endDate", /^contract end date$/),
  };
}

function readDate(
  reader: FieldReader,
  field: ContractFieldName,
  ...labels: RegExp[]
): string | null {
  for (const label of labels) {
    const found = reader.labels.find(label, "contractInfo");
    if (!found) continue;
    const date = parseQiwaDate(found.value);
    if (date) {
      reader.note(field, found.page);
      return date;
    }
    // Indefinite contracts may print a dash for the end date.
    if (found.value && !/^[-–—]+$/.test(found.value)) {
      reader.issue(field, `Could not read the date "${found.value}".`);
    }
  }
  return null;
}

/** Section 5, clause 5.1: term, auto-renewal and the non-renewal notice. */
function readContractPeriod(reader: FieldReader, contractType: ContractType) {
  const text = reader.doc.sectionText("period");
  const termMonths = parseTermMonths(text);
  if (termMonths !== null) reader.note("termMonths", reader.pageOf("period"));
  if (contractType === "fixed_term" && termMonths === null) {
    reader.issue(
      "termMonths",
      "Fixed-term contract without a readable term in clause 5.1.",
    );
  }

  let autoRenew: boolean | null = null;
  if (/automatically renewed/i.test(text))
    autoRenew = !/not be automatically renewed/i.test(text);
  else if (/shall not be renewed|non-renewable/i.test(text)) autoRenew = false;
  if (autoRenew !== null) reader.note("autoRenew", reader.pageOf("period"));

  const renewalNoticeDays = reader.numberIn(
    "period",
    "renewalNoticeDays",
    /at least\s*\(?\s*(\d+)\s*\)?\s*days before/i,
  );
  return { termMonths, autoRenew, renewalNoticeDays };
}

/** Section 6, clause 6.1. */
function readProbation(reader: FieldReader) {
  const text = reader.doc.sectionText("probation");
  let probationDays = reader.numberIn(
    "probation",
    "probationDays",
    /probationary period of\s*\(?\s*(\d+)\s*\)?\s*days/i,
  );
  if (
    probationDays === null &&
    /not subject to (a|any) probationary period/i.test(text)
  ) {
    probationDays = 0;
    reader.note("probationDays", reader.pageOf("probation"));
  }
  return { probationDays, probationExcludedDays: parseExcludedDays(text) };
}

/** Section 7: working days, hours and rest days. */
function readWorkingTime(reader: FieldReader) {
  const workDaysPerWeek = reader.numberIn(
    "hours",
    "workDaysPerWeek",
    /working days shall be\s*\(?\s*(\d+(?:\.\d+)?)\s*\)?\s*days/i,
  );
  let dailyHours = reader.numberIn(
    "hours",
    "dailyHours",
    /working hours shall be daily\s*\(?\s*(\d+(?:\.\d+)?)/i,
  );
  let weeklyHours = reader.numberIn(
    "hours",
    "weeklyHours",
    /working hours shall be weekly\s*\(?\s*(\d+(?:\.\d+)?)/i,
  );
  const restDaysPerWeek = reader.numberIn(
    "hours",
    "restDaysPerWeek",
    /(\d+(?:\.\d+)?)\s*\)?\s*rest days?/i,
  );

  // The template prints one of the two; derive the other so rules can use either.
  if (weeklyHours === null && dailyHours !== null && workDaysPerWeek !== null) {
    weeklyHours = dailyHours * workDaysPerWeek;
    reader.note("weeklyHours", reader.pageOf("hours"), "medium");
  } else if (dailyHours === null && weeklyHours !== null && workDaysPerWeek) {
    dailyHours = weeklyHours / workDaysPerWeek;
    reader.note("dailyHours", reader.pageOf("hours"), "medium");
  }
  return { workDaysPerWeek, dailyHours, weeklyHours, restDaysPerWeek };
}

/** Section 8, clause 8.1. */
function readAnnualLeave(reader: FieldReader): number | null {
  return reader.numberIn(
    "leave",
    "annualLeaveDays",
    /vacation of\s*\(?\s*(\d+)\s*\)?\s*(?:calendar\s+)?days/i,
  );
}

/** Section 11: overtime pay "equal to the total hourly wage plus (N%) of the basic hourly wage". */
function readOvertimePremium(reader: FieldReader): number | null {
  return reader.numberIn(
    "firstObligations",
    "overtimePremiumPct",
    /plus\s*\(\s*(\d+(?:\.\d+)?)\s*%\s*\)\s*of the basic hourly wage/i,
  );
}

/** Sections 3 and 4: nationality, occupation, work location. */
function readEmployeeAndJob(reader: FieldReader) {
  const text = (
    label: RegExp,
    section: SectionKey,
    field: ContractFieldName,
  ): string | null => {
    const found = reader.labels.find(label, section);
    if (!found?.value) return null;
    reader.note(field, found.page);
    return found.value;
  };
  const nationalityText = text(/^nationality$/, "secondParty", "nationality");
  const nationality: ContractFields["nationality"] = nationalityText
    ? /^saudi( arabian?)?$/i.test(nationalityText)
      ? "saudi"
      : "non_saudi"
    : null;
  return {
    nationality,
    occupation: text(/^occupation$/, "profession", "occupation"),
    workLocation: text(/^work location$/, "profession", "workLocation"),
  };
}

function checkRequiredFields(fields: ContractFields, reader: FieldReader): void {
  for (const field of REQUIRED_FIELDS) {
    const value = fields[field];
    if (value === null || value === "unknown")
      reader.issue(field, `Required field ${field} was not found.`);
  }
  if (fields.dailyHours === null && fields.weeklyHours === null) {
    reader.issue("weeklyHours", "Neither daily nor weekly working hours were found.");
  }
  if (!reader.doc.section("additional")) {
    reader.issue("section15", 'Section "15. Additional Terms" was not found.');
  }
}

/** Section 9.1.1: basic, housing, transport, other allowances and the printed total. */
function readWage(reader: FieldReader): Wage | null {
  const amount = (label: RegExp): number | null => {
    const found = reader.labels.find(label, "wage");
    const money = found ? parseMoney(found.value) : null;
    if (!money) return null;
    if (money.period && money.period !== "monthly") {
      reader.issue("wage", `Wage is printed per "${money.period}", expected monthly.`);
    }
    return money.amount;
  };
  const basic = amount(/^basic wage$/);
  const total = amount(/^total wage$/);
  if (basic === null || total === null) return null;
  const housing = amount(/^housing allowance$/) ?? 0;
  const transport = amount(/^transportation allowance$/) ?? 0;
  const other = reader.labels
    .findAll(/allowances?$/, "wage")
    .filter((v) => !/^(housing|transportation) allowance$/.test(v.label))
    .reduce((sum, v) => sum + (parseMoney(v.value)?.amount ?? 0), 0);

  const parts = basic + housing + transport + other;
  if (Math.abs(parts - total) > WAGE_TOLERANCE_SAR) {
    reader.issue(
      "wage",
      `Wage parts add up to ${parts.toFixed(2)} but the total wage is ${total.toFixed(2)}.`,
    );
  }
  reader.note("wage", reader.labels.find(/^total wage$/, "wage")?.page ?? null);
  return { basic, housing, transport, other, total };
}

// ---------------------------------------------------------------------------------------------
// Section 15
// ---------------------------------------------------------------------------------------------

/** "15.3 The employer ..." at the start of an English line. The space after the number is required. */
const CLAUSE_MARKER = /^15\s*\.\s*(\d{1,2}(?:\.\d{1,2})*)\.?(?:\s+(.*))?$/;
/** Space kept between the OCR region and the headings above and below it. */
const REGION_PAD_PT = 2;

function readSection15(doc: ContractDocument): {
  clauses: Clause[];
  regions: PageRegion[];
  issues: ExtractionIssue[];
} {
  const section = doc.section("additional");
  if (!section) return { clauses: [], regions: [], issues: [] };
  const issues: ExtractionIssue[] = [];
  if (!doc.section("appendix")) {
    issues.push({
      field: "section15",
      message: 'Section "16. Appendix" was not found; Section 15 may run long.',
    });
  }
  const body = doc.lines.slice(section.start + 1, section.end);

  const drafts: { number: string; parts: string[] }[] = [];
  const preamble: string[] = [];
  for (const line of body) {
    const text = cleanEnglish(englishLineText(line));
    if (!text) continue;
    const marker = CLAUSE_MARKER.exec(text);
    if (marker?.[1]) drafts.push({ number: `15.${marker[1]}`, parts: [marker[2] ?? ""] });
    else if (drafts.length > 0) drafts[drafts.length - 1]?.parts.push(text);
    else preamble.push(text);
  }
  if (drafts.length === 0 && preamble.join(" ").split(" ").length >= 4) {
    issues.push({
      field: "section15",
      message: "Section 15 has text but no numbered items; read as one clause.",
    });
    drafts.push({ number: "15.1", parts: preamble });
  }

  const clauses: Clause[] = [];
  for (const draft of drafts) {
    const textEn = draft.parts.join(" ").replace(/\s+/g, " ").trim();
    if (!textEn) continue;
    clauses.push({
      section: 15,
      number: draft.number,
      textEn,
      textAr: null,
      textHash: hashClauseText(textEn),
    });
  }

  return { clauses, regions: section15Regions(doc, section), issues };
}

function englishLineText(line: Line): string {
  return line.en.map((s) => s.text).join(" ");
}

/**
 * The Arabic half of every page Section 15 touches, from below the "15." heading to above the
 * "16." heading (or the footer). Arabic and English clauses share table rows, so this covers the
 * Arabic text even when it is longer or shorter than the English.
 */
function section15Regions(doc: ContractDocument, section: Section): PageRegion[] {
  const heading = doc.lines[section.start];
  const next = doc.lines[section.end];
  if (!heading) return [];
  const lastPage = next
    ? next.page
    : (doc.lines[doc.lines.length - 1]?.page ?? heading.page);
  const regions: PageRegion[] = [];
  for (let page = heading.page; page <= lastPage; page++) {
    const size = doc.pageSizes.get(page);
    if (!size) continue;
    const pageLines = doc.lines.filter((line) => line.page === page);
    const top =
      page === heading.page
        ? heading.yMax + REGION_PAD_PT
        : (pageLines[0]?.yMin ?? 0) - REGION_PAD_PT;
    const bottom =
      next && page === next.page
        ? next.yMin - REGION_PAD_PT
        : footerTop(doc, page, size.height);
    if (bottom - top < 5) continue;
    regions.push({
      page,
      xMin: size.width / 2,
      yMin: Math.max(0, top),
      xMax: size.width,
      yMax: bottom,
    });
  }
  return regions;
}

function footerTop(doc: ContractDocument, page: number, height: number): number {
  const tops = doc.footers.filter((row) => row.page === page).map((row) => row.yMin);
  return (tops.length > 0 ? Math.min(...tops) : height - FOOTER_BAND_PT) - REGION_PAD_PT;
}

/** sha256 hex of the lower-cased, whitespace-normalised English clause text. */
export function hashClauseText(text: string): string {
  return createHash("sha256")
    .update(text.toLowerCase().replace(/\s+/g, " ").trim())
    .digest("hex");
}

/**
 * Merges Tesseract output for the Section 15 Arabic regions into the clauses. Each clause starts
 * on a new OCR line with its number. Tesseract often keeps only the sub-number ("3 لصاحب العمل..."
 * for 15.3), sometimes the full "15.3" or a mirrored "3.15", and may print Arabic-Indic digits.
 * A full number is accepted for any later clause; a bare sub-number only for the next clause in
 * order, so a wrapped line that happens to start with a number is not taken for a clause start.
 * Best effort: a clause whose number is not found keeps its textAr.
 */
export function attachArabicOcr(clauses: Clause[], ocrText: string): Clause[] {
  if (!ocrText.trim() || clauses.length === 0) return clauses;
  const lines = normaliseOcrDigits(ocrText).split(/\r?\n/);
  const pieces = new Map<string, string[]>();
  let current: string[] | null = null;
  let nextIndex = 0;
  for (const line of lines) {
    const marker = clauseMarker(line, clauses, nextIndex);
    if (marker) {
      current = [marker.rest];
      pieces.set(marker.number, current);
      nextIndex = marker.index + 1;
    } else {
      current?.push(line);
    }
  }
  if (pieces.size === 0 && clauses.length === 1) {
    pieces.set(clauses[0]?.number ?? "", lines);
  }
  return clauses.map((clause) => {
    const textAr = normaliseArabic(pieces.get(clause.number)?.join(" ") ?? "");
    return textAr ? { ...clause, textAr } : clause;
  });
}

function normaliseOcrDigits(text: string): string {
  return text
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u066B\u066C]/g, ".");
}

const FULL_MARKER = /^\s*15\s*[.,]\s*(\d{1,2})(?!\d)[\s.:)-]*(.*)$/;
const MIRRORED_MARKER = /^\s*(\d{1,2})\s*[.,]\s*15(?!\d)[\s.:)-]*(.*)$/;
const BARE_MARKER = /^\s*(\d{1,2})(?!\d)\s*[.:)-]?\s+(.*)$/;

function clauseMarker(
  line: string,
  clauses: Clause[],
  nextIndex: number,
): { number: string; index: number; rest: string } | null {
  const full = FULL_MARKER.exec(line) ?? MIRRORED_MARKER.exec(line);
  if (full?.[1]) {
    const number = `15.${Number(full[1])}`;
    const index = clauses.findIndex((c, i) => i >= nextIndex && c.number === number);
    if (index >= 0) return { number, index, rest: full[2] ?? "" };
  }
  const bare = BARE_MARKER.exec(line);
  const expected = clauses[nextIndex];
  if (bare?.[1] && expected && expected.number === `15.${Number(bare[1])}`) {
    return { number: expected.number, index: nextIndex, rest: bare[2] ?? "" };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Identifying strings (for redaction only)
// ---------------------------------------------------------------------------------------------

function readParties(
  doc: ContractDocument,
  labels: LabelIndex,
): { strings: string[]; placeholders: Record<string, NamePlaceholder> } {
  const placeholders: Record<string, NamePlaceholder> = {};
  const add = (text: string | undefined, placeholder: NamePlaceholder) => {
    const clean = text?.replace(/\s+/g, " ").trim();
    if (!clean || !hasLetters(clean) || placeholders[clean]) return;
    placeholders[clean] = placeholder;
  };

  const employer = labels.find(/^establishment name/, "firstParty");
  add(employer?.value, "[EMPLOYER]");
  add(employer?.valueAr, "[EMPLOYER]");
  const employee = labels.find(/^employee name$/, "secondParty");
  add(employee?.value, "[EMPLOYEE]");
  add(employee?.valueAr, "[EMPLOYEE]");
  const signatory = labels.find(/^signatory representative$/, "firstParty");
  add(signatory?.value, "[NAME]");
  add(signatory?.valueAr, "[NAME]");

  for (const name of footerNames(doc)) add(name, "[NAME]");
  for (const line of doc.lines) {
    const createdBy = /created by (.+?) at \d/i.exec(englishLineText(line));
    add(createdBy?.[1], "[NAME]");
  }
  return { strings: Object.keys(placeholders), placeholders };
}

const BY_PATTERN = arabicPhrasePattern("بواسطة", "gu");

/** Names in the "بواسطة : <name> - <ID>" footer cell (whoever downloaded the PDF). */
function footerNames(doc: ContractDocument): string[] {
  const names = new Set<string>();
  for (const segment of doc.footers.flatMap((row) => row.segments)) {
    const text = normaliseArabic(segment.text);
    if (!text.match(BY_PATTERN)) continue;
    const rest = text.replace(BY_PATTERN, " ");
    for (const part of rest.split(/[:|]|\s[-–]\s/)) {
      const name = part.replace(/\d+/g, " ").replace(/\s+/g, " ").trim();
      if (hasLetters(name)) names.add(name);
    }
  }
  return [...names];
}

function hasLetters(text: string): boolean {
  const letters = text.match(/\p{L}/gu) ?? [];
  return letters.length >= 2 && (isArabicText(text) || /[A-Za-z]{2}/.test(text));
}
