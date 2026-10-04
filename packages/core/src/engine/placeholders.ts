/**
 * Rule messages may contain {placeholders}: {deadline}, {days}, {limit}, {position}, {value}.
 * Values are filled when a finding is built and again when a report is rendered.
 */
export type PlaceholderValues = Partial<Record<string, string>>;

const PLACEHOLDER = /\{(\w+)\}/g;

/** Replaces every placeholder that has a value. Unknown placeholders are left as they are. */
export function fillPlaceholders(template: string, values: PlaceholderValues): string {
  return template.replace(PLACEHOLDER, (whole, name: string) => values[name] ?? whole);
}

/** True when every placeholder in the template has a value. */
export function canFill(template: string, values: PlaceholderValues): boolean {
  return [...template.matchAll(PLACEHOLDER)].every(
    (match) => values[match[1] ?? ""] !== undefined,
  );
}

/** A number as messages show it: at most one decimal, no trailing ".0". */
export function formatNumber(value: number): string {
  return String(Math.round(value * 10) / 10);
}
