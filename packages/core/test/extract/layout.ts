import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseBboxXhtml } from "../../src/bbox";
import type { BboxWord, PageLayout } from "../../src/types";

/** A4 as Qiwa prints it. */
export const PAGE_WIDTH = 595.92;
export const PAGE_HEIGHT = 841.92;

const FIXTURES = fileURLToPath(new URL("../fixtures/", import.meta.url));

/** Pages of a synthetic fixture (see evals/template/README.md). */
export function fixturePages(id: string): PageLayout[] {
  return parseBboxXhtml(readFileSync(`${FIXTURES}${id}.bbox.html`, "utf8"));
}

/** One cell of text: words laid out left to right from `x`, 5 pt per character, 3 pt spaces. */
export function cell(text: string, x: number, y: number, height = 15.9): BboxWord[] {
  const words: BboxWord[] = [];
  let left = x;
  for (const part of text.split(" ").filter(Boolean)) {
    const width = part.length * 5;
    words.push({ text: part, xMin: left, yMin: y, xMax: left + width, yMax: y + height });
    left += width + 3;
  }
  return words;
}

/** A cell whose right edge is at `right` (right-aligned values and Arabic text). */
export function cellRight(text: string, right: number, y: number): BboxWord[] {
  const width = text
    .split(" ")
    .filter(Boolean)
    .reduce((sum, part) => sum + part.length * 5 + 3, -3);
  return cell(text, right - width, y);
}

export function page(number: number, ...cells: BboxWord[][]): PageLayout {
  return { page: number, width: PAGE_WIDTH, height: PAGE_HEIGHT, words: cells.flat() };
}

/** English heading at the Qiwa heading indent. */
export function heading(text: string, y: number): BboxWord[] {
  return cell(text, 31.4, y);
}

/** English paragraph line at the label indent. */
export function para(text: string, y: number): BboxWord[] {
  return cell(text, 45.4, y);
}

/** English label with a value right-aligned at the English column edge. */
export function labelled(label: string, value: string, y: number): BboxWord[] {
  return [...cell(label, 45.4, y), ...cellRight(value, 290.8, y)];
}

/** The per-page footer: download stamp and "by <name> - <id>", as pdftotext prints them. */
export function footer(nameVisual: string, id: string): BboxWord[] {
  return [
    ...cell("10:30 2026-01-15 : خيراتب ليمحتلا مت", 21.7, 803.4, 13),
    ...cell(`${id} - ${nameVisual} : ةطساوب`, 21.7, 815.7, 13),
    ...cellRight("10 نم 1 ةحفصلا | 10000001 : دقعلا مقر", 574.2, 815.7),
  ];
}
