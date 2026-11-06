import { describe, expect, it } from "vitest";
import {
  columnText,
  decodeEntities,
  pageRows,
  parseBboxXhtml,
  parseTesseractTsv,
  rowText,
} from "../../src/bbox";
import { cell, cellRight, page } from "./layout";

const XHTML = `<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title></head><body>
<doc>
  <page width="595.919980" height="841.919980">
    <flow><block xMin="1" yMin="1" xMax="2" yMax="2"><line xMin="1" yMin="1" xMax="2" yMax="2">
      <word xMin="31.4" yMin="20.4" xMax="40.0" yMax="36.3">4.</word>
      <word xMin="42.0" yMin="20.4" xMax="90.0" yMax="36.3">Profession</word>
      <word xMin="92.0" yMin="20.4" xMax="99.0" yMax="36.3">&amp;</word>
      <word xMin="101.0" yMin="20.4" xMax="140.0" yMax="36.3">Work&#x2019;s</word>
      <word xMin="142.0" yMin="20.4" xMax="150.0" yMax="36.3">  </word>
    </line></block></flow>
  </page>
  <page width="595.919980" height="841.919980">
    <flow><block xMin="1" yMin="1" xMax="2" yMax="2"><line xMin="1" yMin="1" xMax="2" yMax="2">
      <word xMin="45.4" yMin="25.0" xMax="80.0" yMax="40.9">Party&apos;s</word>
    </line></block></flow>
  </page>
</doc></body></html>`;

describe("parseBboxXhtml", () => {
  it("reads page sizes and word boxes, numbering pages from 1", () => {
    const pages = parseBboxXhtml(XHTML);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toMatchObject({ page: 1, width: 595.91998, height: 841.91998 });
    expect(pages[1]?.page).toBe(2);
    expect(pages[0]?.words[0]).toEqual({
      text: "4.",
      xMin: 31.4,
      yMin: 20.4,
      xMax: 40,
      yMax: 36.3,
    });
  });

  it("decodes entities and drops empty words", () => {
    const [first, second] = parseBboxXhtml(XHTML);
    expect(first?.words.map((w) => w.text)).toEqual(["4.", "Profession", "&", "Work’s"]);
    expect(second?.words[0]?.text).toBe("Party's");
  });

  it("returns no pages for empty input", () => {
    expect(parseBboxXhtml("")).toEqual([]);
  });
});

describe("parseTesseractTsv", () => {
  // Header, then a 300 dpi page with one line of two words (and an empty block row).
  const TSV = [
    "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
    "1\t1\t0\t0\t0\t0\t0\t0\t2550\t3300\t-1\t",
    "2\t1\t1\t0\t0\t0\t300\t600\t600\t60\t-1\t",
    "4\t1\t1\t1\t1\t0\t300\t600\t600\t60\t-1\t",
    "5\t1\t1\t1\t1\t1\t300\t610\t150\t40\t96\tBasic",
    "5\t1\t1\t1\t1\t2\t500\t600\t200\t50\t95\tWage:",
    "1\t2\t0\t0\t0\t0\t0\t0\t2550\t3300\t-1\t",
  ].join("\n");

  it("reads pages and words in points, each word as tall as its line", () => {
    expect(parseTesseractTsv(TSV, 300)).toEqual([
      {
        page: 1,
        width: 612,
        height: 792,
        words: [
          { text: "Basic", xMin: 72, xMax: 108, yMin: 144, yMax: 158.4 },
          { text: "Wage:", xMin: 120, xMax: 168, yMin: 144, yMax: 158.4 },
        ],
      },
      { page: 2, width: 612, height: 792, words: [] },
    ]);
  });
});

describe("decodeEntities", () => {
  it("handles named, decimal and hex entities and leaves unknown ones", () => {
    expect(decodeEntities("a &lt;b&gt; &quot;c&quot; &#39;d&#39; &#x0627; &bogus;")).toBe(
      `a <b> "c" 'd' ا &bogus;`,
    );
  });
});

describe("pageRows", () => {
  it("groups words on the same line even when their tops differ slightly", () => {
    const layout = page(
      1,
      cell("Employee name:", 45.4, 160.7),
      cell("يبرحلا رون", 232.4, 161.3),
      cell("Nationality:", 45.4, 184.6),
    );
    const rows = pageRows(layout);
    expect(rows.map(rowText)).toEqual(["Employee name: يبرحلا رون", "Nationality:"]);
  });

  it("splits a row into cells at wide gaps and assigns columns by the left edge", () => {
    const layout = page(
      1,
      cell("Contract type:", 45.4, 319.7),
      cellRight("Fixed-term Contract", 290.8, 319.7),
      cell("ةدملا ددحم دقع", 308, 319.7),
      cellRight(": هتدم ثيح نم دقعلا عون", 550.8, 319.7),
    );
    const [row] = pageRows(layout);
    expect(row?.segments.map((s) => [s.text, s.column])).toEqual([
      ["Contract type:", "en"],
      ["Fixed-term Contract", "en"],
      ["ةدملا ددحم دقع", "ar"],
      [": هتدم ثيح نم دقعلا عون", "ar"],
    ]);
    expect(row && columnText(row, "en")).toBe("Contract type: Fixed-term Contract");
  });

  it("keeps a value centred on the midline in the English column", () => {
    const layout = page(
      1,
      cell("Contract number:", 45.4, 295.8),
      cell("10000001", 278, 295.8),
    );
    const [row] = pageRows(layout);
    expect(row?.segments[1]).toMatchObject({ text: "10000001", column: "en" });
  });

  it("orders rows top to bottom and words left to right", () => {
    const layout = page(
      1,
      cell("second", 45.4, 300),
      cell("first", 45.4, 100),
      cell("b", 120, 100),
      cell("a", 100, 100),
    );
    expect(pageRows(layout).map(rowText)).toEqual(["first a b", "second"]);
  });
});
