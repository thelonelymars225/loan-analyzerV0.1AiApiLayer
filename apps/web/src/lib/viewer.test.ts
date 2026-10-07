import { describe, expect, it } from "vitest";
import { syntheticPassage, syntheticReport } from "../test/fixtures";
import {
  DEFAULT_PAGE_SIZE,
  filterBySeverity,
  focusFromParams,
  focusParams,
  isSectionNumber,
  pageMarks,
  pageSizes,
  tabFromParams,
  viewerItems,
} from "./viewer";

const report = syntheticReport("employee");
const items = viewerItems(report);

describe("viewerItems", () => {
  it("lists issues by severity, each numbered by its place in the contract", () => {
    expect(items.issues.map((item) => [item.finding.ruleId, item.number])).toEqual([
      ["TYPE-CONFLICT-01", 1], // high, clause 15.1
      ["COMP-ART77-01", 3], // high, clause 15.4
      ["EOS-BASE-01", 4], // high, clause 15.6
      ["TRANSFER-KSA-01", 2], // medium, clause 15.3
      ["REVIEW-00", null], // low, placed only as "Section 15": no number
    ]);
  });

  it("gives a whole-section fallback no number, so it cannot jump ahead of the clauses", () => {
    const review = items.issues.find((item) => item.finding.ruleId === "REVIEW-00");
    expect(review?.passage?.approximate).toBe(true);
    expect(review?.number).toBeNull();
  });

  it("numbers what's good separately, in contract order", () => {
    expect(items.good.map((item) => [item.finding.ruleId, item.number])).toEqual([
      ["LEAVE-MIN-01", null],
    ]);
    const withPassage = viewerItems({
      findings: [],
      good: [
        { ...report.good[0]!, passages: [syntheticPassage("8.1", 2, 300)] },
        {
          ...report.good[0]!,
          ruleId: "PROB-MAX-01",
          passages: [syntheticPassage("6.1", 2, 100)],
        },
      ],
    });
    expect(withPassage.good.map((item) => [item.finding.ruleId, item.number])).toEqual([
      ["PROB-MAX-01", 1],
      ["LEAVE-MIN-01", 2],
    ]);
  });
});

describe("filterBySeverity", () => {
  it("keeps one severity, or all", () => {
    expect(filterBySeverity(items.issues, "all")).toHaveLength(5);
    expect(filterBySeverity(items.issues, "medium").map((i) => i.finding.ruleId)).toEqual(
      ["TRANSFER-KSA-01"],
    );
  });
});

describe("pageMarks", () => {
  it("marks every passage of every item and flags the focused passage", () => {
    const conflict = items.issues.find(
      (item) => item.finding.ruleId === "TYPE-CONFLICT-01",
    )!;
    const marks = pageMarks(items.issues, {
      itemId: conflict.id,
      passage: conflict.finding.passages[1]!,
    });
    expect(marks).toHaveLength(6); // five issues, one of them with two passages
    expect(
      marks.filter((mark) => mark.selected).map((mark) => mark.passage.clause),
    ).toEqual(["1"]);
    expect(marks.find((mark) => mark.passage.clause === "15.6")?.tone).toBe("critical");
  });

  it("colours what's good green", () => {
    const good = viewerItems({
      findings: [],
      good: [{ ...report.good[0]!, passages: [syntheticPassage("8.1", 2, 300)] }],
    });
    expect(pageMarks(good.good, null)[0]?.tone).toBe("good");
  });
});

describe("pageSizes", () => {
  it("uses the size the passages reveal and A4 for the rest", () => {
    const sizes = pageSizes(items.issues, 10);
    expect(sizes).toHaveLength(10);
    expect(sizes[7]).toEqual({ width: 595.92, height: 842.04 });
    expect(sizes[4]).toBe(DEFAULT_PAGE_SIZE);
  });
});

describe("isSectionNumber", () => {
  it("tells a section from a clause", () => {
    expect(isSectionNumber("7")).toBe(true);
    expect(isSectionNumber("7.1")).toBe(false);
    expect(isSectionNumber("15.4.2")).toBe(false);
  });
});

describe("URL state", () => {
  it("finds the focused item and passage, falling back to the item's own clause", () => {
    const conflict = items.issues.find(
      (item) => item.finding.ruleId === "TYPE-CONFLICT-01",
    )!;
    const params = new URLSearchParams(
      focusParams(conflict, conflict.finding.passages[1]),
    );
    expect(params.get("focus")).toBe("finding-TYPE-CONFLICT-01-15-1");
    expect(focusFromParams(params, items.issues)?.passage?.clause).toBe("1");

    const own = new URLSearchParams({ focus: conflict.id });
    expect(focusFromParams(own, items.issues)?.passage?.clause).toBe("15.1");

    expect(
      focusFromParams(new URLSearchParams({ focus: "nope" }), items.issues),
    ).toBeNull();
  });

  it("defaults the tab to issues", () => {
    expect(tabFromParams(new URLSearchParams())).toBe("issues");
    expect(tabFromParams(new URLSearchParams({ tab: "good" }))).toBe("good");
    expect(tabFromParams(new URLSearchParams({ tab: "other" }))).toBe("issues");
  });
});
