import type { Passage, RatingReport, Severity, ViewFinding } from "@rater/contracts";
import { findingAnchor, SEVERITY_TONE, type Tone } from "./report";

/*
 * What the contract viewer shows: the report's findings as numbered items, and the marks they
 * leave on the pages. Pure functions, so the page component only wires them to the URL.
 */

/** The side panel's tabs. "issues" is the default; "good" turns on the green marks. */
export type ViewerTab = "issues" | "good";
export const VIEWER_TABS: readonly ViewerTab[] = ["issues", "good"];

export interface ViewerItem {
  /** The finding's card anchor, so the viewer and the report link to each other. */
  id: string;
  tab: ViewerTab;
  /**
   * Position in the contract (1-based) among this tab's items, the same number on the pin
   * and in the list. Null for a finding that was not placed exactly.
   */
  number: number | null;
  finding: ViewFinding;
  /** The passage shown first: the finding's own clause. Null for an unplaced finding. */
  passage: Passage | null;
}

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2, none: 3 };

/**
 * Issues sorted by severity (High, Medium, Low) and then by place in the contract; positive
 * findings in contract order. Numbers always follow the contract, whatever the list order.
 */
export function viewerItems(
  report: Pick<RatingReport, "findings" | "good">,
): Record<ViewerTab, ViewerItem[]> {
  return {
    issues: numberedInContractOrder("issues", report.findings).sort(bySeverityThenNumber),
    good: numberedInContractOrder("good", report.good).sort(byNumber),
  };
}

function numberedInContractOrder(tab: ViewerTab, findings: ViewFinding[]): ViewerItem[] {
  const items: ViewerItem[] = findings.map((finding) => ({
    id: findingAnchor(finding),
    tab,
    number: null,
    finding,
    passage: finding.passages[0] ?? null,
  }));
  // Only exact places are numbered: a whole-section fallback would otherwise take the
  // number of the first clause in that section.
  const placed = items
    .filter((item) => item.passage !== null && !item.passage.approximate)
    .sort((a, b) => comparePosition(a.passage!, b.passage!));
  placed.forEach((item, index) => {
    item.number = index + 1;
  });
  return items;
}

/** Reading order: page, then top to bottom. */
export function comparePosition(a: Passage, b: Passage): number {
  return a.page - b.page || a.box.yMin - b.box.yMin || a.clause.localeCompare(b.clause);
}

function byNumber(a: ViewerItem, b: ViewerItem): number {
  return (a.number ?? Infinity) - (b.number ?? Infinity);
}

function bySeverityThenNumber(a: ViewerItem, b: ViewerItem): number {
  return (
    SEVERITY_RANK[a.finding.severity] - SEVERITY_RANK[b.finding.severity] ||
    byNumber(a, b)
  );
}

export type SeverityFilter = "all" | Severity;
export const SEVERITY_FILTERS: readonly SeverityFilter[] = [
  "all",
  "high",
  "medium",
  "low",
];

export function filterBySeverity(
  items: ViewerItem[],
  filter: SeverityFilter,
): ViewerItem[] {
  return filter === "all"
    ? items
    : items.filter((item) => item.finding.severity === filter);
}

/** One highlight on a page: a passage of an item, in the item's colour. */
export interface PageMark {
  itemId: string;
  number: number | null;
  title: string;
  passage: Passage;
  tone: Tone;
  selected: boolean;
}

/**
 * The marks to draw for the items on show. Every passage of an item is marked (a conflict
 * marks its clause and the template clause it contradicts); the selected item's selected
 * passage is the one the page scrolls to.
 */
export function pageMarks(
  items: ViewerItem[],
  selected: { itemId: string; passage: Passage | null } | null,
): PageMark[] {
  return items.flatMap((item) =>
    item.finding.passages.map((passage) => ({
      itemId: item.id,
      number: item.number,
      title: item.finding.title,
      passage,
      tone: item.tab === "good" ? "good" : SEVERITY_TONE[item.finding.severity],
      selected:
        selected !== null &&
        selected.itemId === item.id &&
        (selected.passage === null || samePlace(selected.passage, passage)),
    })),
  );
}

export function samePlace(
  a: Pick<Passage, "clause" | "page">,
  b: Pick<Passage, "clause" | "page">,
): boolean {
  return a.clause === b.clause && a.page === b.page;
}

/** "7" is a whole section; "7.1" or "15.4.2" is a clause inside one. */
export function isSectionNumber(clause: string): boolean {
  return !clause.includes(".");
}

export interface PageSize {
  width: number;
  height: number;
}

/** A4 portrait, which every Qiwa contract so far has been; used until a page's own size is known. */
export const DEFAULT_PAGE_SIZE: PageSize = { width: 595.92, height: 842.04 };

/** Page sizes the passages reveal; pages nothing points at fall back to the default. */
export function pageSizes(items: ViewerItem[], pages: number): PageSize[] {
  const known = new Map<number, PageSize>();
  for (const item of items) {
    for (const passage of item.finding.passages) {
      known.set(passage.page, { width: passage.pageWidth, height: passage.pageHeight });
    }
  }
  return Array.from(
    { length: pages },
    (_, index) => known.get(index + 1) ?? DEFAULT_PAGE_SIZE,
  );
}

/** Which item and passage the URL points at: `?focus=<item id>&clause=15.6&page=8`. */
export interface ViewerFocus {
  itemId: string;
  passage: Passage | null;
}

export function focusFromParams(
  params: URLSearchParams,
  items: ViewerItem[],
): ViewerFocus | null {
  const itemId = params.get("focus");
  const item = items.find((candidate) => candidate.id === itemId);
  if (!item) return null;
  const clause = params.get("clause");
  const page = Number(params.get("page"));
  const passage =
    item.finding.passages.find((candidate) =>
      samePlace(candidate, { clause: clause ?? "", page }),
    ) ?? item.passage;
  return { itemId: item.id, passage };
}

/** The search params that focus an item (and one of its passages). */
export function focusParams(item: ViewerItem, passage: Passage | null = item.passage) {
  const params: Record<string, string> = { focus: item.id };
  if (passage) {
    params.clause = passage.clause;
    params.page = String(passage.page);
  }
  return params;
}

/** The default tab is "issues"; anything else in the URL is ignored. */
export function tabFromParams(params: URLSearchParams): ViewerTab {
  return params.get("tab") === "good" ? "good" : "issues";
}
