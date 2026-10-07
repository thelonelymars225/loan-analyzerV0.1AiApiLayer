import { describe, expect, it } from "vitest";
import type { LawArticle } from "@rater/contracts";
import { matchesRef, MemoryArticleLookup } from "../src";

/**
 * Which corpus entry an article is, e.g. "labor_law 83(1)". Deliberately not the citation
 * format: that belongs to packages/core (formatCitation), which cites articles in findings.
 */
function entry(a: LawArticle): string {
  return `${a.source} ${a.article}${a.paragraph ? `(${a.paragraph})` : ""}`;
}

function article(overrides: Partial<LawArticle>): LawArticle {
  return {
    lawVersion: "2025-11",
    source: "labor_law",
    article: "1",
    paragraph: null,
    textAr: null,
    textEnUnofficial: "Example text.",
    sourceUrl: null,
    effectiveFrom: null,
    effectiveTo: null,
    ...overrides,
  };
}

describe("matchesRef", () => {
  const para1 = article({ article: "83", paragraph: "1" });
  const para1a = article({ article: "83", paragraph: "1(a)" });
  const para10 = article({ article: "83", paragraph: "10" });
  const whole = article({ article: "84" });

  it("needs the same source and article number", () => {
    expect(matchesRef(whole, { source: "labor_law", article: "84" })).toBe(true);
    expect(matchesRef(whole, { source: "labor_law", article: "8" })).toBe(false);
    expect(matchesRef(whole, { source: "implementing_regulations", article: "84" })).toBe(
      false,
    );
  });

  it("matches every paragraph when the reference names none", () => {
    expect(matchesRef(para1, { source: "labor_law", article: "83" })).toBe(true);
    expect(matchesRef(para10, { source: "labor_law", article: "83" })).toBe(true);
  });

  it("matches paragraphs by prefix, at a digit boundary", () => {
    const ref = { source: "labor_law" as const, article: "83", paragraph: "1" };
    expect(matchesRef(para1, ref)).toBe(true);
    expect(matchesRef(para1a, ref)).toBe(true);
    expect(matchesRef(para10, ref)).toBe(false);
  });

  it("lets a whole-article chunk answer a paragraph reference", () => {
    expect(
      matchesRef(whole, { source: "labor_law", article: "84", paragraph: "2" }),
    ).toBe(true);
  });
});

describe("MemoryArticleLookup.byRefs", () => {
  const lookup = new MemoryArticleLookup();

  it("finds articles by reference, in corpus order, without duplicates", async () => {
    const found = await lookup.byRefs([
      { source: "labor_law", article: "84" },
      { source: "labor_law", article: "2" },
      { source: "labor_law", article: "84" },
    ]);
    expect(found.map(entry)).toEqual(["labor_law 2", "labor_law 84"]);
  });

  it("finds one paragraph or all of them", async () => {
    const one = await lookup.byRefs([
      { source: "labor_law", article: "83", paragraph: "1" },
    ]);
    expect(one.map(entry)).toEqual(["labor_law 83(1)"]);
    const all = await lookup.byRefs([{ source: "labor_law", article: "83" }]);
    expect(all.map(entry)).toEqual([
      "labor_law 83(1)",
      "labor_law 83(2)",
      "labor_law 83(3)",
    ]);
  });

  it("finds regulation and template entries", async () => {
    const found = await lookup.byRefs([
      { source: "implementing_regulations", article: "20" },
      { source: "qiwa_template", article: "14.8.1" },
    ]);
    expect(found.map(entry)).toEqual([
      "implementing_regulations 20",
      "qiwa_template 14.8.1",
    ]);
  });

  it("returns nothing for unknown references", async () => {
    expect(await lookup.byRefs([{ source: "labor_law", article: "999" }])).toEqual([]);
    expect(await lookup.byRefs([])).toEqual([]);
  });
});
