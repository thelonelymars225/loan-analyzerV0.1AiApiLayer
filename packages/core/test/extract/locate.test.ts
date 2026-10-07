import { describe, expect, it } from "vitest";
import { extractContract } from "../../src/extract";
import { locateClauses, type LocatableDocument } from "../../src/locate";
import { fixturePages, PAGE_HEIGHT, PAGE_WIDTH } from "./layout";

describe("locateClauses on the synthetic fixtures", () => {
  const { clauseLocations } = extractContract(fixturePages("fixed-term-bad-s15"));
  const of = (clause: string) => clauseLocations.filter((l) => l.clause === clause);

  it("places every Section 15 clause on its page, top to bottom, without overlaps", () => {
    const items = ["15.1", "15.2", "15.3", "15.4", "15.5", "15.6", "15.7"].map((clause) =>
      of(clause),
    );
    for (const boxes of items) expect(boxes).toHaveLength(1);
    const boxes = items.map((found) => found[0]!);
    expect(new Set(boxes.map((box) => box.page)).size).toBe(1);
    for (let i = 1; i < boxes.length; i++) {
      expect(boxes[i]!.yMin).toBeGreaterThan(boxes[i - 1]!.yMax);
    }
    // Each box spans both columns: from the English indent to the Arabic right edge.
    for (const box of boxes) {
      expect(box.xMin).toBeLessThan(PAGE_WIDTH / 2);
      expect(box.xMax).toBeGreaterThan(PAGE_WIDTH / 2);
      expect(box.pageWidth).toBeCloseTo(PAGE_WIDTH, 2);
      expect(box.pageHeight).toBeCloseTo(PAGE_HEIGHT, 2);
    }
  });

  it("knows the template clauses the field rules point at", () => {
    for (const clause of ["5.1", "6.1", "6.2", "8.1", "9.1.1"]) {
      expect(of(clause), clause).toHaveLength(1);
    }
    // "9.1.1 Wage:" covers the wage table: its own row and the allowance rows below it.
    const [wage] = of("9.1.1");
    const [basic] = of("9.1.1.1");
    const [total] = of("9.1.1.5");
    expect(wage!.yMin).toBeLessThanOrEqual(basic!.yMin);
    expect(wage!.yMax).toBeGreaterThanOrEqual(total!.yMax);
  });

  it("covers a whole section, heading included, with one box per page it runs onto", () => {
    const section = of("15");
    expect(section).toHaveLength(1);
    expect(section[0]!.yMin).toBeLessThan(of("15.1")[0]!.yMin);
    expect(section[0]!.yMax).toBeGreaterThanOrEqual(of("15.7")[0]!.yMax);

    // Section 11 starts on page 4 and continues on page 5.
    expect(of("11").map((box) => box.page)).toEqual([4, 5]);
    expect(of("11.6")[0]!.page).toBe(5);
  });

  it("holds boxes only, in page bounds", () => {
    for (const box of clauseLocations) {
      expect(Object.keys(box).sort()).toEqual(
        [
          "clause",
          "page",
          "pageHeight",
          "pageWidth",
          "xMax",
          "xMin",
          "yMax",
          "yMin",
        ].sort(),
      );
      expect(box.xMin).toBeGreaterThanOrEqual(0);
      expect(box.yMin).toBeGreaterThanOrEqual(0);
      expect(box.xMax).toBeLessThanOrEqual(box.pageWidth);
      expect(box.yMax).toBeLessThanOrEqual(box.pageHeight);
    }
  });
});

describe("locateClauses on hand-built rows", () => {
  /** One cell, 5 pt per character, one text line high. */
  const segment = (text: string, x: number, y: number) => ({
    text,
    xMin: x,
    yMin: y,
    xMax: x + text.length * 5,
    yMax: y + 15.9,
  });
  /** A table row: English at the label indent, Arabic right-aligned at the page edge. */
  const row = (page: number, y: number, en: string, ar = "") => ({
    page,
    en: en ? [segment(en, 45.4, y)] : [],
    ar: ar ? [segment(ar, 574.2 - ar.length * 5, y)] : [],
  });
  const sizes = new Map([
    [1, { width: PAGE_WIDTH, height: PAGE_HEIGHT }],
    [2, { width: PAGE_WIDTH, height: PAGE_HEIGHT }],
  ]);

  it("gives a clause that runs onto the next page one box per page", () => {
    const doc: LocatableDocument = {
      lines: [
        row(1, 700, "15. Additional Terms", "شروط إضافية"),
        row(1, 720, "15.1 The employee shall", "يلتزم العامل"),
        row(1, 740, "keep all information", "بالمحافظة على"),
        row(2, 30, "confidential for two years.", "السرية لمدة سنتين."),
        row(2, 50, "15.2 Transfer anywhere.", "النقل إلى أي موقع."),
      ],
      sections: [{ number: "15", start: 0, end: 5 }],
      pageSizes: sizes,
    };
    const located = locateClauses(doc);
    expect(located.filter((l) => l.clause === "15.1")).toEqual([
      expect.objectContaining({ page: 1, yMin: 720, yMax: 740 + 15.9 }),
      expect.objectContaining({ page: 2, yMin: 30, yMax: 30 + 15.9 }),
    ]);
    expect(located.filter((l) => l.clause === "15.2")).toEqual([
      expect.objectContaining({ page: 2, yMin: 50 }),
    ]);
    // The section spans both pages too, from its heading to its last row.
    expect(located.filter((l) => l.clause === "15").map((l) => [l.page, l.yMin])).toEqual(
      [
        [1, 700],
        [2, 30],
      ],
    );
  });

  it("ignores numbers that belong to another section or sit inside a sentence", () => {
    const doc: LocatableDocument = {
      lines: [
        row(1, 100, "5. Contract Period"),
        row(1, 120, "5.1 This contract is valid for 1.5 years"),
        row(1, 140, "6.1 looks like the next section but is not"),
        row(1, 160, "2.5 of the law applies"),
      ],
      sections: [{ number: "5", start: 0, end: 4 }],
      pageSizes: sizes,
    };
    const located = locateClauses(doc);
    expect(located.map((l) => l.clause)).toEqual(["5", "5.1"]);
    // Every row after "5.1" belongs to it.
    expect(located.find((l) => l.clause === "5.1")?.yMax).toBe(160 + 15.9);
  });

  it("returns nothing for a page it has no size for", () => {
    const doc: LocatableDocument = {
      lines: [row(3, 100, "7. Work Hours")],
      sections: [{ number: "7", start: 0, end: 1 }],
      pageSizes: sizes,
    };
    expect(locateClauses(doc)).toEqual([]);
  });
});
