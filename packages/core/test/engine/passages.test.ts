import { describe, expect, it } from "vitest";
import type { ClauseLocation } from "@rater/contracts";
import { CROP_CONTEXT_PT, passageCrop, passagesFor } from "../../src/passages";

const PAGE = { pageWidth: 595.92, pageHeight: 842.04 };

/** A clause box across both columns, 40 pt high, at `yMin` on `page`. */
const located = (clause: string, page: number, yMin: number): ClauseLocation => ({
  clause,
  page,
  ...PAGE,
  xMin: 45.4,
  yMin,
  xMax: 574.2,
  yMax: yMin + 40,
});

const LOCATIONS = [
  located("1", 1, 120),
  located("11", 4, 700),
  located("11", 5, 38),
  located("15", 8, 360),
  located("15.1", 8, 400),
  located("15.4", 8, 520),
];

const CLAUSES = [
  {
    number: "15.1",
    textEn: "This is an unlimited contract.",
    textAr: "عقد غير محدد المدة",
  },
  { number: "15.4", textEn: "Two months of basic wage.", textAr: null },
];

describe("passageCrop", () => {
  it("takes the full page width and a line of context above and below", () => {
    expect(passageCrop(located("15.4", 8, 520))).toEqual({
      xMin: 0,
      yMin: 520 - CROP_CONTEXT_PT,
      xMax: PAGE.pageWidth,
      yMax: 560 + CROP_CONTEXT_PT,
    });
  });

  it("stays inside the page at the top and bottom edges", () => {
    expect(passageCrop(located("1", 1, 5)).yMin).toBe(0);
    expect(passageCrop(located("14", 9, PAGE.pageHeight - 20)).yMax).toBe(
      PAGE.pageHeight,
    );
  });
});

describe("passagesFor", () => {
  it("gives a located clause its box, its crop and its stored text", () => {
    expect(passagesFor(["15.4"], LOCATIONS, CLAUSES)).toEqual([
      {
        clause: "15.4",
        page: 8,
        ...PAGE,
        box: { xMin: 45.4, yMin: 520, xMax: 574.2, yMax: 560 },
        crop: passageCrop(located("15.4", 8, 520)),
        textEn: "Two months of basic wage.",
        textAr: null,
        approximate: false,
      },
    ]);
  });

  it("keeps the order of the references and drops repeats and blanks", () => {
    const passages = passagesFor(
      ["15.1", "1", "15.1", null, undefined],
      LOCATIONS,
      CLAUSES,
    );
    expect(passages.map((passage) => passage.clause)).toEqual(["15.1", "1"]);
  });

  it("returns one passage per page for a clause that runs onto the next page", () => {
    const passages = passagesFor(["11"], LOCATIONS, CLAUSES);
    expect(passages.map((passage) => [passage.clause, passage.page])).toEqual([
      ["11", 4],
      ["11", 5],
    ]);
  });

  it("falls back to the closest located ancestor and says so", () => {
    const [passage] = passagesFor(["11.2"], LOCATIONS, CLAUSES);
    expect(passage).toMatchObject({ clause: "11", page: 4, approximate: true });

    const section = passagesFor(["15.7"], LOCATIONS, CLAUSES);
    expect(section).toHaveLength(1);
    expect(section[0]).toMatchObject({ clause: "15", approximate: true, textEn: null });
  });

  it("gives nothing for a clause with no located ancestor", () => {
    expect(passagesFor(["9.1.1"], LOCATIONS, CLAUSES)).toEqual([]);
    expect(passagesFor(["15.4"], [], CLAUSES)).toEqual([]);
  });
});
