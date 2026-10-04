import { describe, expect, it } from "vitest";
import {
  arabicPhrasePattern,
  detectQiwa,
  isArabicText,
  normaliseArabic,
  reverseText,
} from "../../src/detect";
import { cell, fixturePages, page } from "./layout";

describe("detectQiwa", () => {
  it.each(["fixed-term-bad-s15", "indefinite-clean", "wage-mismatch"])(
    "accepts the synthetic Qiwa contract %s",
    (id) => {
      expect(detectQiwa(fixturePages(id))).toEqual({ ok: true });
    },
  );

  it("rejects a document without the Qiwa title", () => {
    const result = detectQiwa(fixturePages("not-qiwa"));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/Unified Employment Contract/);
  });

  it("rejects an empty document and a page without a text layer", () => {
    expect(detectQiwa([])).toEqual({ ok: false, reason: "The PDF has no pages." });
    const scanned = detectQiwa([page(1)]);
    expect(scanned.ok).toBe(false);
    expect(!scanned.ok && scanned.reason).toMatch(/no text layer/);
  });

  it("only looks at page 1", () => {
    const pages = [
      page(1, cell("Offer letter", 45, 100)),
      page(2, cell("Unified Employment Contract", 305, 120)),
    ];
    expect(detectQiwa(pages).ok).toBe(false);
  });

  it("accepts the English title in any case and spacing", () => {
    expect(detectQiwa([page(1, cell("UNIFIED  EMPLOYMENT CONTRACT", 305, 120))]).ok).toBe(
      true,
    );
  });

  it("accepts the Arabic title alone, as pdftotext prints it (visual order, split glyph runs)", () => {
    // Real Qiwa output: "عقد" comes out as two glyph runs and every word reversed.
    expect(detectQiwa([page(1, cell("دحوملا لمعلا د قع", 376, 82))]).ok).toBe(true);
    // Logical order, as other PDF producers write it.
    expect(detectQiwa([page(1, cell("عقد العمل الموحد", 376, 82))]).ok).toBe(true);
    // With bidi marks and tatweel.
    expect(
      detectQiwa([page(1, cell("\u200Fعق\u0640د العمل الموح\u0640د", 376, 82))]).ok,
    ).toBe(true);
  });
});

describe("normaliseArabic", () => {
  it("folds presentation forms, removes bidi controls and tatweel, collapses spaces", () => {
    // U+FEFB is the lam-alef ligature presentation form; NFKC turns it into "لا".
    expect(normaliseArabic("\u202Bس\u0640لام  \uFEFB\u202C")).toBe("سلام لا");
  });
});

describe("arabicPhrasePattern", () => {
  const pattern = arabicPhrasePattern("الأجر الأساسي");

  it("matches logical order, reversed visual order and odd spacing", () => {
    expect(pattern.test("الأجر الأساسي")).toBe(true);
    expect(pattern.test(reverseText("الأجر الأساسي"))).toBe(true);
    expect(pattern.test("ال أجر الأ ساسي")).toBe(true);
  });

  it("matches a lam-alef pair in either order (ligature glyphs reverse it)", () => {
    // DejaVu prints "الأجر" as the visual run "رجلأا": reversing it gives "األجر".
    expect(pattern.test("رجلأا")).toBe(false); // only part of the phrase
    expect(arabicPhrasePattern("الأجر").test("رجلأا")).toBe(true);
  });

  it("treats alef, yaa and taa marbuta variants as equal", () => {
    expect(arabicPhrasePattern("مكافأة نهاية").test("مكافاه نهايه")).toBe(true);
    expect(arabicPhrasePattern("على").test("علي")).toBe(true);
  });
});

describe("isArabicText", () => {
  it("is true only for Arabic without Latin letters", () => {
    expect(isArabicText("نور الحربي")).toBe(true);
    expect(isArabicText("Nour الحربي")).toBe(false);
    expect(isArabicText("12345")).toBe(false);
  });
});
