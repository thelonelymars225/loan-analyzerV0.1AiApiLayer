/**
 * Text normalisation and tokenisation shared by the embedder and the tests.
 * Arabic text from PDFs and OCR comes with diacritics, tatweel, bidi controls and several
 * spellings of the same letter, so both sides of a comparison go through normaliseText().
 */

/** Harakat, Quranic marks and the superscript alef. */
const TASHKEEL = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const TATWEEL = /\u0640/g;
/** Bidi marks, embeddings and isolates, the Arabic letter mark, and zero-width characters. */
const INVISIBLE = /[\u061C\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
/** Alef with hamza above or below, alef with madda, alef wasla. */
const ALEF_VARIANTS = /[\u0622\u0623\u0625\u0671]/g;
/** Alef maksura, and the Persian yeh that OCR sometimes produces. */
const YAA_VARIANTS = /[\u0649\u06CC]/g;
const TAA_MARBUTA = /\u0629/g;
/** Arabic-Indic and Extended Arabic-Indic digits; NFKC leaves them alone. */
const ARABIC_DIGITS = /[\u0660-\u0669\u06F0-\u06F9]/g;

const ALEF = "\u0627";
const YAA = "\u064A";
const HAA = "\u0647";

/**
 * NFKC, strip invisible characters, tashkeel and tatweel, unify alef / yaa / taa marbuta,
 * ASCII digits, lower case. The result is for matching only, never for display.
 */
export function normaliseText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .replace(TASHKEEL, "")
    .replace(TATWEEL, "")
    .replace(ALEF_VARIANTS, ALEF)
    .replace(YAA_VARIANTS, YAA)
    .replace(TAA_MARBUTA, HAA)
    .replace(ARABIC_DIGITS, (digit) => String(digit.charCodeAt(0) & 0xf))
    .toLowerCase();
}

/** Words that carry no meaning for retrieval. Arabic entries are already normalised. */
// prettier-ignore
const STOPWORDS = new Set([
  // English
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "have", "he", "his",
  "if", "in", "is", "it", "its", "may", "of", "on", "or", "shall", "such", "that", "the",
  "their", "them", "they", "this", "to", "was", "which", "will", "with", "any", "all", "not",
  "no", "other", "upon", "than", "these", "those", "been", "were", "can", "must", "each",
  // Arabic, normalised
  "في", "من", "علي", "الي", "عن", "ان", "او", "ما", "لا", "هذا", "هذه", "ذلك", "التي", "الذي",
  "مع", "قد", "اذا", "كان",
]);

/** Prefixes built on the definite article, longest first. */
const ARABIC_ARTICLE_PREFIXES = ["وال", "بال", "كال", "فال", "ولل", "لل", "ال"];

/** Strips the definite article so "الإجازة" and "إجازة" become the same token. */
function stripArabicArticle(token: string): string {
  for (const prefix of ARABIC_ARTICLE_PREFIXES) {
    if (token.startsWith(prefix) && token.length - prefix.length >= 2) {
      return token.slice(prefix.length);
    }
  }
  return token;
}

/** Folds English plurals and third-person verbs: "years" → "year", "parties" → "party". */
function singular(token: string): string {
  if (!/^[a-z]{4,}$/.test(token) || !token.endsWith("s") || token.endsWith("ss"))
    return token;
  return token.endsWith("ies") ? `${token.slice(0, -3)}y` : token.slice(0, -1);
}

/** Normalised word tokens without stopwords. Numbers are kept: "180" and "21" matter here. */
export function tokenize(text: string): string[] {
  return normaliseText(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0 && !STOPWORDS.has(token))
    .map((token) => singular(stripArabicArticle(token)))
    .filter((token) => token.length > 1 || /\d/.test(token));
}

/**
 * Words that appear in nearly every labour-law text ("worker", "employer", "contract", and
 * their Arabic equivalents). They still count, but much less than distinctive words, so a short
 * article doesn't win a search just by sharing "employment contract" with the query.
 */
// prettier-ignore
export const COMMON_DOMAIN_WORDS = new Set([
  "employer", "employee", "worker", "contract", "employment", "work", "law", "article",
  "provision",
  "عامل", "صاحب", "عمل", "عقد", "نظام", "ماده", "طرف", "طرفين",
]);
