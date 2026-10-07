import type { ClauseLocation } from "@rater/contracts";

/*
 * Where every numbered clause is printed. The report uses these boxes to show the passage
 * behind a finding and to open the contract viewer at that spot. Only boxes leave this step:
 * no text, so nothing here needs redacting.
 */

/** A text cell and its box in PDF points. The extractor's TextSegment has this shape. */
export interface PlacedText {
  text: string;
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

/** One table row of the contract with its English and Arabic cells (the extractor's Line). */
export interface PlacedRow {
  page: number;
  en: PlacedText[];
  ar: PlacedText[];
}

/** A numbered section: its heading row and the rows up to the next heading. */
export interface NumberedSection {
  /** The number printed before the title, "15" for "15. Additional Terms". */
  number: string;
  /** Index of the heading row in `lines`. */
  start: number;
  /** Index of the next heading row (exclusive). */
  end: number;
}

export interface LocatableDocument {
  lines: readonly PlacedRow[];
  sections: readonly NumberedSection[];
  pageSizes: ReadonlyMap<number, { width: number; height: number }>;
}

/** "5.1", "9.1.1.1" or "15.3" at the start of an English cell, with or without a trailing dot. */
const ITEM_NUMBER = /^(\d{1,2}(?:\.\d{1,2}){1,3})\.?(?:\s|$)/;

/**
 * Finds the box of every numbered clause and of every section. A row belongs to the last
 * item number printed above it in its section; rows before the first item (the heading and
 * any preamble) belong to the section itself. A clause's box covers its own rows and those
 * of its sub-items, so "9.1.1" spans the whole wage table and "7" the whole of Section 7.
 * A clause that runs onto the next page gets one box per page.
 *
 * Only the English column is read for numbers. An item the English column leaves out (Arabic
 * text only) is counted with the item above it, which is where it is printed anyway.
 */
export function locateClauses(doc: LocatableDocument): ClauseLocation[] {
  const rowsByItem = new Map<string, PlacedRow[]>();
  for (const section of doc.sections) {
    let current = section.number;
    for (let index = section.start; index < section.end; index++) {
      const row = doc.lines[index];
      if (!row) continue;
      const number = index > section.start ? itemNumber(row, section.number) : null;
      if (number) current = number;
      rowsByItem.set(current, [...(rowsByItem.get(current) ?? []), row]);
    }
  }

  const locations: ClauseLocation[] = [];
  for (const clause of withAncestors([...rowsByItem.keys()])) {
    const rows = [...rowsByItem]
      .filter(([item]) => item === clause || item.startsWith(`${clause}.`))
      .flatMap(([, itemRows]) => itemRows);
    locations.push(...boxesPerPage(clause, rows, doc.pageSizes));
  }
  return locations.sort(byPosition);
}

/** The item number an English cell starts with, if it belongs to this section ("5.1" in Section 5). */
function itemNumber(row: PlacedRow, sectionNumber: string): string | null {
  const first = row.en[0];
  const match = first ? ITEM_NUMBER.exec(first.text.trim()) : null;
  const number = match?.[1];
  return number && number.startsWith(`${sectionNumber}.`) ? number : null;
}

/** The numbers themselves plus every prefix: "14.8.1" also yields "14.8" and "14". */
function withAncestors(numbers: string[]): string[] {
  const all = new Set<string>();
  for (const number of numbers) {
    const parts = number.split(".");
    for (let length = 1; length <= parts.length; length++) {
      all.add(parts.slice(0, length).join("."));
    }
  }
  return [...all];
}

/** One box per page: the union of every cell of the rows printed on that page. */
function boxesPerPage(
  clause: string,
  rows: PlacedRow[],
  pageSizes: LocatableDocument["pageSizes"],
): ClauseLocation[] {
  const cellsByPage = new Map<number, PlacedText[]>();
  for (const row of rows) {
    const cells = cellsByPage.get(row.page) ?? [];
    cellsByPage.set(row.page, [...cells, ...row.en, ...row.ar]);
  }
  const locations: ClauseLocation[] = [];
  for (const [page, cells] of cellsByPage) {
    const size = pageSizes.get(page);
    if (!size || cells.length === 0) continue;
    locations.push({
      clause,
      page,
      pageWidth: size.width,
      pageHeight: size.height,
      xMin: Math.min(...cells.map((cell) => cell.xMin)),
      yMin: Math.min(...cells.map((cell) => cell.yMin)),
      xMax: Math.max(...cells.map((cell) => cell.xMax)),
      yMax: Math.max(...cells.map((cell) => cell.yMax)),
    });
  }
  return locations;
}

/** Reading order: page, then top to bottom; a section before the items inside it. */
function byPosition(a: ClauseLocation, b: ClauseLocation): number {
  return a.page - b.page || a.yMin - b.yMin || a.clause.length - b.clause.length;
}
