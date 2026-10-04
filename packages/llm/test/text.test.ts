import { describe, expect, it } from "vitest";
import { glossArabic, normaliseArabicText } from "../src/heuristic/arabic";
import {
  findPercentages,
  findQuantities,
  normaliseEnglish,
  parseNumber,
  splitSentences,
} from "../src/heuristic/text";

describe("parseNumber", () => {
  it.each([
    ["2", 2],
    ["2.5", 2.5],
    ["two", 2],
    ["fifteen", 15],
    ["seventeen", 17],
    ["twenty-four", 24],
    ["thirty six", 36],
    ["one hundred and eighty", 180],
    ["two and a half", 2.5],
    ["a", 1],
    ["an", 1],
  ])("%s → %d", (phrase, value) => {
    expect(parseNumber(phrase)).toBe(value);
  });

  it("returns null for words that are not numbers", () => {
    expect(parseNumber("several")).toBeNull();
  });
});

describe("findQuantities", () => {
  const read = (text: string) =>
    findQuantities(normaliseEnglish(text)).map(({ value, unit }) => [value, unit]);

  it.each([
    ["compensation of two (2) months' basic wage", [[2, "month"]]],
    ["2 (two) months", [[2, "month"]]],
    ["one hundred and eighty (180) days", [[180, "day"]]],
    ["a period of three years", [[3, "year"]]],
    ["for a year after the contract ends", [[1, "year"]]],
    ["15 working days of leave", [[15, "day"]]],
    ["an additional ninety (90) days", [[90, "day"]]],
    ["a 12-month restriction", [[12, "month"]]],
    [
      "8 hours a day and 48 hours a week",
      [
        [8, "hour"],
        [48, "hour"],
      ],
    ],
    ["one and a half months", [[1.5, "month"]]],
  ])("%s", (text, expected) => {
    expect(read(text)).toEqual(expected);
  });

  it("does not read number words inside other words", () => {
    expect(read("someone shall attend tenders monthly")).toEqual([]);
  });
});

describe("findPercentages", () => {
  it("reads digits, 'percent' and number words", () => {
    expect(findPercentages("plus (50%) of the wage")).toEqual([50]);
    expect(findPercentages("25 percent and 12.5 per cent")).toEqual([25, 12.5]);
    expect(findPercentages("twenty percent")).toEqual([20]);
  });
});

describe("normaliseEnglish and splitSentences", () => {
  it("lower-cases and unifies quotes, dashes and spaces", () => {
    expect(normaliseEnglish("Two  Months\u2019 \u2014 Basic\nWage")).toBe(
      "two months' - basic wage",
    );
  });

  it("keeps 'Art. 57' inside its sentence", () => {
    expect(splitSentences("ends under art. 57 of the law. next one; third")).toEqual([
      "ends under art. 57 of the law",
      "next one",
      "third",
    ]);
  });
});

describe("Arabic normalisation and gloss", () => {
  it("folds letter variants, strips diacritics, tatweel and bidi marks, and reads Arabic digits", () => {
    expect(
      normaliseArabicText("\u200f\u0625\u062c\u0640\u0627\u0632\u0629\u064c ٢٧٠"),
    ).toBe("اجازه 270");
  });

  it("glosses known phrases into English", () => {
    expect(glossArabic("تحسب مكافأة نهاية الخدمة على أساس الأجر الأساسي فقط")).toContain(
      "end-of-service award",
    );
    expect(glossArabic("بدل النقل")).toBe("transport allowance");
  });
});
