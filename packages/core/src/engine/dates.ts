/**
 * ISO calendar dates (YYYY-MM-DD) for deadlines. Dates are handled in UTC so no time zone
 * can move a deadline by a day. ISO dates compare correctly as plain strings.
 */

function toUtc(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const date = toUtc(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return toIso(date);
}

/** Adds calendar months, keeping the day when it exists: 2025-01-31 + 1 month = 2025-02-28. */
export function addMonths(iso: string, months: number): string {
  const start = toUtc(iso);
  const target = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, 1),
  );
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(start.getUTCDate(), lastDay));
  return toIso(target);
}
