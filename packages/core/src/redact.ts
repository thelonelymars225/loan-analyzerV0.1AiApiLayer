import type { Clause } from "@rater/contracts";
import {
  escapeRegex,
  isArabicText,
  looseArabicSource,
  normaliseArabic,
  reverseText,
} from "./detect";
import { hashClauseText } from "./extract";
import type { ExtractionResult, RedactionContext } from "./types";

/** Western, Arabic-Indic and Extended Arabic-Indic digits: OCR of Arabic text yields all three. */
const D = "[0-9\\u0660-\\u0669\\u06F0-\\u06F9]";
/** Up to three spaces, newlines or dashes between digit groups ("SA 07 8000 ..."). */
const SEP = "[\\s-]{0,3}";

/**
 * Fixed patterns, applied in this order (most specific first, so an IBAN's digits are not
 * mistaken for an ID number).
 */
const PATTERNS: { name: string; pattern: RegExp; placeholder: string }[] = [
  {
    name: "email",
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    placeholder: "[EMAIL]",
  },
  {
    // Saudi IBAN: SA + 22 digits. 12+ also catches the first half of an IBAN wrapped across lines.
    name: "iban",
    pattern: new RegExp(`\\b[Ss][Aa]${SEP}(?:${D}${SEP}){11,21}${D}`, "g"),
    placeholder: "[IBAN]",
  },
  {
    // +966 / 00966 followed by 8-9 digits (landlines and mobiles), in any grouping.
    name: "phone-intl",
    pattern: new RegExp(
      `(?<!${D})(?:(?:\\+|00)${SEP})?966(?:${SEP}${D}){8,9}(?!${D})`,
      "g",
    ),
    placeholder: "[PHONE]",
  },
  {
    // Local mobile: 05 + 8 digits.
    name: "phone-local",
    pattern: new RegExp(`(?<!${D})[0٠۰]${SEP}[5٥۵](?:${SEP}${D}){8}(?!${D})`, "g"),
    placeholder: "[PHONE]",
  },
  {
    // National ID (1...), Iqama (2...) and the employer's unified national number (7...), 10 digits.
    // The spec names 1 and 2; 7 is added because the establishment number identifies the employer.
    name: "id",
    pattern: new RegExp(`(?<!${D})[127١٢٧۱۲۷]${D}{9}(?!${D})`, "g"),
    placeholder: "[ID]",
  },
];

/** Names shorter than this (letters only) are not redacted: too likely to match ordinary words. */
const MIN_NAME_LETTERS = 3;

/** Step 3: replaces IDs, IBANs, phone numbers, e-mails and the parties' names with placeholders. */
export function redactText(text: string, ctx: RedactionContext): string {
  let result = text;
  for (const { pattern, placeholder } of PATTERNS) {
    result = result.replace(pattern, placeholder);
  }
  // Longest names first, so "Nour Al-Harbi" is replaced before a shorter "Nour".
  const names = [...ctx.names].sort((a, b) => b.text.length - a.text.length);
  for (const name of names) {
    const pattern = namePattern(name.text);
    if (pattern) result = result.replace(pattern, name.placeholder);
  }
  return result;
}

/**
 * A pattern for one name. Arabic names match however pdftotext or OCR spaced or ordered them
 * (see looseArabicSource); Latin names match case-insensitively with any whitespace between words.
 */
function namePattern(name: string): RegExp | null {
  const clean = normaliseArabic(name);
  const letters = clean.match(/\p{L}/gu) ?? [];
  if (letters.length < MIN_NAME_LETTERS) return null;
  if (isArabicText(clean)) {
    const forward = looseArabicSource(clean);
    const backward = looseArabicSource(reverseText(clean));
    return new RegExp(`(?:${forward})|(?:${backward})`, "gu");
  }
  const words = clean.split(" ").map(escapeRegex);
  return new RegExp(`(?<![\\p{L}\\p{N}])${words.join("\\s+")}(?![\\p{L}\\p{N}])`, "giu");
}

/** Builds the redaction context from the extracted identifying strings. */
export function buildRedactionContext(extraction: ExtractionResult): RedactionContext {
  const seen = new Set<string>();
  const names: RedactionContext["names"] = [];
  for (const text of extraction.identifyingStrings) {
    const clean = text.replace(/\s+/g, " ").trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    const placeholder =
      extraction.namePlaceholders?.[text] ??
      extraction.namePlaceholders?.[clean] ??
      "[NAME]";
    names.push({ text: clean, placeholder });
  }
  return { names };
}

/**
 * Redacts both languages of every clause. The hash is recomputed from the redacted English, so no
 * stored hash is a hash of personal data. It covers the English only: the clause cache key adds
 * the Arabic and the field summary (see clauseCacheKey in section15.ts).
 */
export function redactClauses(clauses: Clause[], ctx: RedactionContext): Clause[] {
  return clauses.map((clause) => {
    const textEn = redactText(clause.textEn, ctx);
    return {
      ...clause,
      textEn,
      textAr: clause.textAr === null ? null : redactText(clause.textAr, ctx),
      textHash: hashClauseText(textEn),
    };
  });
}
