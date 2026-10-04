import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { CorpusEntry, LAW_VERSION, lawArticleRowId, loadCorpus } from "../src";

const corpus = loadCorpus();
const ARABIC_LETTER = /[\u0621-\u064A]/;

describe("corpus/articles.json", () => {
  it("validates as stored on disk", () => {
    const raw: unknown = JSON.parse(
      readFileSync(new URL("../corpus/articles.json", import.meta.url), "utf8"),
    );
    expect(z.array(CorpusEntry).safeParse(raw).success).toBe(true);
  });

  it("drops the maintainer note when loading", () => {
    for (const article of corpus) expect(article).not.toHaveProperty("note");
  });

  it("is all one law version", () => {
    for (const article of corpus) expect(article.lawVersion).toBe(LAW_VERSION);
  });

  it("has one entry per article or paragraph", () => {
    const keys = corpus.map((a) => `${a.source}|${a.article}|${a.paragraph ?? ""}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives every entry some text", () => {
    for (const article of corpus) {
      expect(article.textAr || article.textEnUnofficial, article.article).toBeTruthy();
    }
  });

  it("puts Arabic in textAr and English in textEnUnofficial", () => {
    for (const article of corpus) {
      if (article.textAr) expect(article.textAr, article.article).toMatch(ARABIC_LETTER);
      if (article.textEnUnofficial) {
        expect(article.textEnUnofficial, article.article).not.toMatch(ARABIC_LETTER);
      }
    }
  });

  it("covers the three source documents", () => {
    expect(new Set(corpus.map((a) => a.source))).toEqual(
      new Set(["labor_law", "implementing_regulations", "qiwa_template"]),
    );
  });

  it("marks template and regulation-20 texts as our own summaries", () => {
    const summaries = corpus.filter(
      (a) =>
        a.source === "qiwa_template" ||
        (a.source === "implementing_regulations" && a.article === "20"),
    );
    expect(summaries.map((a) => a.article).sort()).toEqual([
      "14.1",
      "14.5",
      "14.7",
      "14.8.1",
      "20",
      "5.1",
    ]);
    for (const article of summaries)
      expect(article.textEnUnofficial).toMatch(/^Summary: /);
  });

  it("links only to https sources", () => {
    for (const article of corpus) {
      if (article.sourceUrl) expect(article.sourceUrl).toMatch(/^https:\/\//);
    }
  });

  it("gives every entry a unique, stable database row ID", () => {
    const ids = corpus.map(lawArticleRowId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("law_2025-11_labor_law_83_1");
    expect(ids).toContain("law_2025-11_labor_law_79-bis");
    expect(ids).toContain("law_2025-11_qiwa_template_14.8.1");
  });
});

describe("no personal data in the law package", () => {
  const files = ["../rules/rules.json", "../corpus/articles.json"].map((path) =>
    readFileSync(new URL(path, import.meta.url), "utf8"),
  );

  it.each([
    ["national or iqama ID", /\b[12]\d{9}\b/],
    ["IBAN", /\bSA\s?\d{2}(?:\s?\d{4}){5}\b/],
    ["Saudi phone number", /(?:\+966|\b05)\d{8}\b/],
    ["email address", /[\w.+-]+@[\w-]+\.[\w.]+/],
  ])("contains no %s", (_label, pattern) => {
    for (const text of files) expect(text).not.toMatch(pattern);
  });
});
