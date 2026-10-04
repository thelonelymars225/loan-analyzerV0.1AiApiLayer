/*
 * Text helpers for the offline analyser: one normal form for English clause text, and readers
 * for the numbers clauses state ("two (2) months", "one hundred and eighty days", "25%").
 */

/** Lower-case English with plain quotes, dashes and spaces, so detector patterns stay simple. */
export function normaliseEnglish(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u2018\u2019\u201b\u02bc\u2032\u00b4`]/g, "'")
    .replace(/[\u201c\u201d\u201e\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Sentences of a normalised clause. Does not split after "art." or "no." so that
 * "Art. 57 of the law" stays in one sentence.
 */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<!\b(?:art|arts|no|cl))[.;!?]+(?:\s+|$)/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== "");
}

const SMALL_NUMBERS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

// Longest words first, so "seventeen" is not read as "seven".
const NUMBER_WORDS = [...Object.keys(SMALL_NUMBERS), ...Object.keys(TENS), "hundred"]
  .sort((a, b) => b.length - a.length)
  .join("|");

/** "two", "twenty-four", "one hundred and eighty". */
const WORD_NUMBER = `(?:${NUMBER_WORDS})(?:[ -](?:and[ -])?(?:${NUMBER_WORDS}))*`;
const DIGITS = String.raw`\d+(?:\.\d+)?`;
/**
 * The "a" of "for a year" counts as one, but not the "a" of "8 hours a day" or "15 days a
 * year", which means "per".
 */
const ONE_AS_ARTICLE = String.raw`(?<!\b(?:hours?|days?|weeks?|months?|years?|times|riyals?|sar)\s)an?`;
/** A number as clauses write it, including "two and a half" and the "a" of "a year". */
const NUMBER = `(?:${DIGITS}|${WORD_NUMBER}(?: and a half)?|${ONE_AS_ARTICLE})`;
/** The repeat in brackets that contracts add: "two (2)" or "2 (two)". */
const BRACKETED_REPEAT = String.raw`(?:\s*\(\s*(?:${DIGITS}|${WORD_NUMBER})\s*\))?`;
/** Words that may sit between a number and its unit: "15 working days", "two full years". */
const UNIT_MODIFIER = String.raw`(?:(?:calendar|working|business|full|consecutive|additional|more|further|extra)\s+)?`;

const QUANTITY = new RegExp(
  String.raw`\b(${NUMBER})${BRACKETED_REPEAT}\s*-?\s*${UNIT_MODIFIER}(hours?|days?|weeks?|months?|years?)\b`,
  "g",
);

const PERCENTAGE = new RegExp(
  String.raw`\b(${DIGITS}|${WORD_NUMBER})\s*(?:%|per[ -]?cent\b)`,
  "g",
);

/** Reads a number written in digits or English words; null if it is not one. */
export function parseNumber(phrase: string): number | null {
  const text = phrase.trim();
  if (/^\d/.test(text)) return Number(text);
  if (text === "a" || text === "an") return 1;

  const half = text.endsWith(" and a half") ? 0.5 : 0;
  const words = half ? text.slice(0, -" and a half".length) : text;
  let total = 0;
  for (const word of words.split(/[ -]+/)) {
    if (word === "and") continue;
    if (word === "hundred") {
      total = (total || 1) * 100;
      continue;
    }
    const value = SMALL_NUMBERS[word] ?? TENS[word];
    if (value === undefined) return null;
    total += value;
  }
  return total + half;
}

export type Unit = "hour" | "day" | "week" | "month" | "year";

/** A number with a unit of time, and where it sits in the text. */
export interface Quantity {
  value: number;
  unit: Unit;
  index: number;
  end: number;
}

/** Every "number + unit of time" in the text, in order. */
export function findQuantities(text: string): Quantity[] {
  const quantities: Quantity[] = [];
  for (const match of text.matchAll(QUANTITY)) {
    const value = parseNumber(match[1] ?? "");
    const unit = (match[2] ?? "").replace(/s$/, "") as Unit;
    if (value === null) continue;
    quantities.push({
      value,
      unit,
      index: match.index,
      end: match.index + match[0].length,
    });
  }
  return quantities;
}

/** Every percentage in the text, in order ("25%", "fifty percent"). */
export function findPercentages(text: string): number[] {
  return [...text.matchAll(PERCENTAGE)]
    .map((match) => parseNumber(match[1] ?? ""))
    .filter((value): value is number => value !== null);
}

/** Months in a quantity of weeks, months or years; null for hours and days. */
export function toMonths(quantity: Quantity): number | null {
  switch (quantity.unit) {
    case "year":
      return quantity.value * 12;
    case "month":
      return quantity.value;
    case "week":
      return round(quantity.value / 4.345);
    default:
      return null;
  }
}

/** Days in a quantity of days, weeks, months (30 days) or years (365 days); null for hours. */
export function toDays(quantity: Quantity): number | null {
  switch (quantity.unit) {
    case "day":
      return quantity.value;
    case "week":
      return quantity.value * 7;
    case "month":
      return quantity.value * 30;
    case "year":
      return quantity.value * 365;
    default:
      return null;
  }
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** "3" or "1.5" for explanations. */
export function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
