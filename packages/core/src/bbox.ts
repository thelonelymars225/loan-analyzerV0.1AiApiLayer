import type { BboxWord, PageLayout } from "./types";

/**
 * Parses the XHTML written by `pdftotext -bbox-layout` into pages of words.
 * Only <page> sizes and <word> boxes are used; poppler's own flow/block/line grouping is
 * ignored because it does not follow the two-column table layout of a Qiwa contract.
 */
export function parseBboxXhtml(xhtml: string): PageLayout[] {
  const pages: PageLayout[] = [];
  const pagePattern = /<page\b([^>]*)>([\s\S]*?)<\/page>/g;
  for (const match of xhtml.matchAll(pagePattern)) {
    const attrs = parseAttributes(match[1] ?? "");
    pages.push({
      page: pages.length + 1,
      width: attrs.width ?? 0,
      height: attrs.height ?? 0,
      words: parseWords(match[2] ?? ""),
    });
  }
  return pages;
}

function parseWords(pageBody: string): BboxWord[] {
  const words: BboxWord[] = [];
  for (const match of pageBody.matchAll(/<word\b([^>]*)>([\s\S]*?)<\/word>/g)) {
    const attrs = parseAttributes(match[1] ?? "");
    const text = decodeEntities(match[2] ?? "").trim();
    if (!text) continue;
    words.push({
      text,
      xMin: attrs.xMin ?? 0,
      yMin: attrs.yMin ?? 0,
      xMax: attrs.xMax ?? 0,
      yMax: attrs.yMax ?? 0,
    });
  }
  return words;
}

function parseAttributes(source: string): Record<string, number> {
  const attrs: Record<string, number> = {};
  for (const match of source.matchAll(/([A-Za-z]+)="([^"]*)"/g)) {
    const value = Number(match[2]);
    if (match[1] && Number.isFinite(value)) attrs[match[1]] = value;
  }
  return attrs;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Decodes the XML entities pdftotext emits (&amp; &apos; &#39; &#x2019; ...). */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith("#x") || name.startsWith("#X"))
      return String.fromCodePoint(parseInt(name.slice(2), 16));
    if (name.startsWith("#")) return String.fromCodePoint(parseInt(name.slice(1), 10));
    return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
  });
}

// ---------------------------------------------------------------------------------------------
// Rows and segments
//
// A Qiwa contract is a two-column table: English on the left half, Arabic on the right half, and
// each table row puts its English and Arabic text at the same height. We rebuild that structure
// from word boxes: words at the same height form a row, and a wide horizontal gap inside a row
// separates cells (label, value, Arabic value, Arabic label).
// ---------------------------------------------------------------------------------------------

export type Column = "en" | "ar";

/** Consecutive words of one row with no wide gap between them: one table cell's line. */
export interface TextSegment {
  text: string;
  column: Column;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  words: BboxWord[];
}

/** All words of one page that sit on the same text line, split into segments, left to right. */
export interface TextRow {
  page: number;
  yMin: number;
  yMax: number;
  segments: TextSegment[];
}

/** Words whose tops differ by less than this fraction of the word height share a row. */
const ROW_TOLERANCE = 0.25;
/** A gap wider than this fraction of the word height starts a new segment. */
const SEGMENT_GAP = 0.6;

/** Groups a page's words into rows (top to bottom) of segments (left to right). */
export function pageRows(page: PageLayout): TextRow[] {
  const words = [...page.words].sort((a, b) => a.yMin - b.yMin || a.xMin - b.xMin);
  const groups: BboxWord[][] = [];
  let anchor: BboxWord | undefined;
  for (const word of words) {
    const current = groups[groups.length - 1];
    if (
      current &&
      anchor &&
      Math.abs(word.yMin - anchor.yMin) <= ROW_TOLERANCE * wordHeight(anchor)
    ) {
      current.push(word);
    } else {
      groups.push([word]);
      anchor = word;
    }
  }
  const midline = page.width / 2;
  return groups.map((group) => {
    const segments = splitSegments(group, midline);
    return {
      page: page.page,
      yMin: Math.min(...group.map((w) => w.yMin)),
      yMax: Math.max(...group.map((w) => w.yMax)),
      segments,
    };
  });
}

function splitSegments(rowWords: BboxWord[], midline: number): TextSegment[] {
  const words = [...rowWords].sort((a, b) => a.xMin - b.xMin);
  const runs: BboxWord[][] = [];
  for (const word of words) {
    const run = runs[runs.length - 1];
    const previous = run?.[run.length - 1];
    const gap = previous ? word.xMin - previous.xMax : Infinity;
    const limit = previous
      ? SEGMENT_GAP * Math.max(wordHeight(previous), wordHeight(word))
      : 0;
    if (run && gap <= limit) run.push(word);
    else runs.push([word]);
  }
  return runs.map((run) => toSegment(run, midline));
}

function toSegment(words: BboxWord[], midline: number): TextSegment {
  const xMin = Math.min(...words.map((w) => w.xMin));
  return {
    text: words.map((w) => w.text).join(" "),
    // A value centred on the midline (ID numbers, dates, e-mails) starts left of it and belongs
    // to the English row, which is where its label is.
    column: xMin < midline ? "en" : "ar",
    xMin,
    xMax: Math.max(...words.map((w) => w.xMax)),
    yMin: Math.min(...words.map((w) => w.yMin)),
    yMax: Math.max(...words.map((w) => w.yMax)),
    words,
  };
}

function wordHeight(word: BboxWord): number {
  return Math.max(1, word.yMax - word.yMin);
}

/** Text of a row's segments in one column, left to right. */
export function columnText(row: TextRow, column: Column): string {
  return row.segments
    .filter((s) => s.column === column)
    .map((s) => s.text)
    .join(" ");
}

/** Text of every segment of a row, left to right. */
export function rowText(row: TextRow): string {
  return row.segments.map((s) => s.text).join(" ");
}
