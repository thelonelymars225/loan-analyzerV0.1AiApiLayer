/**
 * Number and date formatting for both languages. Arabic uses Latin digits and the Gregorian
 * calendar on purpose: Qiwa contracts state Gregorian dates (clause 14.6) with Latin digits,
 * so figures in the report match the contract the reader holds.
 */

function localeFor(language: string): string {
  return language.startsWith("ar") ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB";
}

/** "SAR 8,750.50" / "8,750.50 ر.س.". Whole amounts drop the decimals. */
export function formatSar(amount: number, language: string): string {
  const fractionDigits = Number.isInteger(amount) ? 0 : 2;
  return new Intl.NumberFormat(localeFor(language), {
    style: "currency",
    currency: "SAR",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(amount);
}

export function formatNumber(value: number, language: string): string {
  return new Intl.NumberFormat(localeFor(language)).format(value);
}

/** File size in megabytes with one decimal, e.g. "2.4". */
export function formatMegabytes(bytes: number, language: string): string {
  return new Intl.NumberFormat(localeFor(language), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(Math.max(0.1, bytes / (1024 * 1024)));
}

/** Formats an ISO date ("2026-11-06") or timestamp for display. */
export function formatDate(iso: string, language: string): string {
  // A bare date is a calendar day, not an instant: pin it to UTC so no time zone shifts it.
  const isBareDate = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const date = new Date(isBareDate ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(localeFor(language), {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(isBareDate ? { timeZone: "UTC" } : {}),
  }).format(date);
}

export function formatDateTime(iso: string, language: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(localeFor(language), {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
