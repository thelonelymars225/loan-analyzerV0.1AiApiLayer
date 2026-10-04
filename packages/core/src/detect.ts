import { pageRows, rowText } from "./bbox";
import type { Detection, PageLayout } from "./types";

const TITLE_EN = /unified\s+employment\s+contract/i;
const TITLE_AR = "عقد العمل الموحد";

/** Step 1: is this a Qiwa "Unified Employment Contract"? Looks for the title on page 1. */
export function detectQiwa(pages: PageLayout[]): Detection {
  const first = pages[0];
  if (!first) return { ok: false, reason: "The PDF has no pages." };
  if (first.words.length === 0) {
    return { ok: false, reason: "Page 1 has no text layer (scanned or image-only PDF)." };
  }
  const titleAr = arabicPhrasePattern(TITLE_AR);
  for (const row of pageRows(first)) {
    const text = rowText(row);
    if (TITLE_EN.test(text) || titleAr.test(normaliseArabic(text))) return { ok: true };
  }
  return {
    ok: false,
    reason:
      'Page 1 does not have the "Unified Employment Contract" (عقد العمل الموحد) title.',
  };
}

// ---------------------------------------------------------------------------------------------
// Arabic text helpers (shared with extract.ts and redact.ts)
// ---------------------------------------------------------------------------------------------

const BIDI_CONTROLS = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
const TATWEEL = /\u0640/g;
const ARABIC_LETTER = /[\u0621-\u064A\u0671-\u06D3\u06FA-\u06FF]/;
const LATIN_LETTER = /[A-Za-z]/;

/**
 * NFKC (turns presentation forms such as "ﻻ" into plain letters), then removes bidi control
 * characters and tatweel, and collapses whitespace.
 */
export function normaliseArabic(text: string): string {
  return text
    .normalize("NFKC")
    .replace(BIDI_CONTROLS, "")
    .replace(TATWEEL, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when the text has Arabic letters and no Latin letters. */
export function isArabicText(text: string): boolean {
  return ARABIC_LETTER.test(text) && !LATIN_LETTER.test(text);
}

/** Reverses a string by code point. pdftotext prints Arabic in visual order, i.e. reversed. */
export function reverseText(text: string): string {
  return Array.from(text).reverse().join("");
}

/** Letters OCR and PDF fonts often swap; matched as one class. */
const LETTER_CLASSES: Record<string, string> = {
  ا: "[اأإآٱ]",
  أ: "[اأإآٱ]",
  إ: "[اأإآٱ]",
  آ: "[اأإآٱ]",
  ٱ: "[اأإآٱ]",
  ي: "[يى]",
  ى: "[يى]",
  ة: "[ةه]",
  ه: "[ةه]",
};
const ALEF = /[اأإآٱ]/;
const LAM = "ل";
/** Optional harakat (short-vowel marks) between letters. */
const MARKS = "[\\u064B-\\u065F\\u0670]*";

/**
 * A regex source that finds an Arabic phrase however pdftotext or OCR spaced it: whitespace is
 * ignored, alef/yaa/taa-marbuta variants match each other, and a lam-alef pair matches in either
 * order (fonts map the ligature glyph to "لا", which reads "ال" once the visual order is reversed).
 */
export function looseArabicSource(phrase: string): string {
  const letters = Array.from(normaliseArabic(phrase).replace(/\s+/g, ""));
  const parts: string[] = [];
  for (let i = 0; i < letters.length; i++) {
    const letter = letters[i] ?? "";
    const next = letters[i + 1] ?? "";
    const isPair =
      (letter === LAM && ALEF.test(next)) || (ALEF.test(letter) && next === LAM);
    if (isPair) {
      parts.push(`(?:ل${MARKS}\\s*[اأإآٱ]|[اأإآٱ]${MARKS}\\s*ل)`);
      i++;
    } else {
      parts.push(LETTER_CLASSES[letter] ?? escapeRegex(letter));
    }
  }
  return parts.join(`${MARKS}\\s*`);
}

/** Matches an Arabic phrase in logical order or in pdftotext's reversed visual order. */
export function arabicPhrasePattern(phrase: string, flags = "u"): RegExp {
  const forward = looseArabicSource(phrase);
  const backward = looseArabicSource(reverseText(normaliseArabic(phrase)));
  return new RegExp(`(?:${forward})|(?:${backward})`, flags);
}

export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
