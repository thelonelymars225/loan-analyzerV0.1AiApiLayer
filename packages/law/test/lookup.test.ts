import { describe, expect, it } from "vitest";
import type { LawArticle } from "@rater/contracts";
import {
  embedArticle,
  HashEmbedder,
  loadCorpus,
  matchesRef,
  MemoryArticleLookup,
  toLawArticleRow,
} from "../src";

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

describe("MemoryArticleLookup.search", () => {
  const lookup = new MemoryArticleLookup();
  const top = async (text: string, k: number) =>
    (await lookup.search(text, k)).map(entry);

  it.each([
    [
      "The end-of-service award shall be calculated on the basis of the basic salary only.",
      "labor_law 84",
    ],
    ["Overtime shall be compensated at 25% of the basic hourly wage.", "labor_law 107"],
    ["The Arabic text prevails over the English text.", "qiwa_template 14.7"],
    ["Any term that contradicts the Labor Law is void.", "qiwa_template 14.5"],
  ])("English: %s → %s first", async (query, expected) => {
    expect((await top(query, 3))[0]).toBe(expected);
  });

  it("English: a transfer clause finds the relocation rules", async () => {
    const hits = await top(
      "The employer may transfer the employee to any of its branches or projects anywhere in the Kingdom.",
      3,
    );
    expect(hits).toContain("implementing_regulations 20");
  });

  it.each([
    ["الإجازة السنوية واحد وعشرون يوما", "labor_law 109(1)"],
    ["التعويض عن إنهاء العقد لسبب غير مشروع", "labor_law 77"],
    ["لا يجوز تشغيل العامل أكثر من ثماني ساعات في اليوم", "labor_law 98"],
    ["ينتهي العقد بإنجاز العمل المتفق عليه", "labor_law 57"],
    ["يحق لصاحب العمل نقل الموظف إلى أي مدينة في المملكة", "labor_law 58(1)"],
  ])("Arabic: %s → %s first", async (query, expected) => {
    expect((await top(query, 3))[0]).toBe(expected);
  });

  it("Arabic: probation with Arabic-Indic digits finds Art. 53 and Exec. Reg. Art. 19", async () => {
    const hits = await top("فترة التجربة ٢٧٠ يوماً", 3);
    expect(hits).toContain("labor_law 53");
    expect(hits).toContain("implementing_regulations 19");
  });

  it("finds an article a clause cites by number", async () => {
    const hits = await top("ends upon completion of the project under Article 57", 3);
    expect(hits).toContain("labor_law 57");
  });

  it("returns at most k results, and none for k = 0 or empty text", async () => {
    expect(await lookup.search("annual leave", 2)).toHaveLength(2);
    expect(await lookup.search("annual leave", 0)).toEqual([]);
    expect(await lookup.search("", 5)).toEqual([]);
  });

  it("is deterministic", async () => {
    const query = "non-compete after the contract ends";
    expect(await top(query, 5)).toEqual(await top(query, 5));
  });
});

describe("toLawArticleRow", () => {
  it("maps a corpus article to a law_articles row with its embedding", () => {
    const embedder = new HashEmbedder();
    const source = loadCorpus().find((a) => a.article === "84")!;
    const row = toLawArticleRow(source, embedder);
    expect(row).toMatchObject({
      id: "law_2025-11_labor_law_84",
      lawVersion: "2025-11",
      sourceDoc: "labor_law",
      article: "84",
      paragraph: null,
      textAr: source.textAr,
      textEnUnofficial: source.textEnUnofficial,
      sourceUrl: source.sourceUrl,
    });
    expect(row.embedding).toEqual(embedArticle(source, embedder));
    expect(row.embedding).toHaveLength(embedder.dim);
  });
});
