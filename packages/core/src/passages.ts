import type { Clause, ClauseLocation, Passage } from "@rater/contracts";

/*
 * Passages: the places in the contract a finding is about, built from the clause locations the
 * extractor saved. The report attaches them to each finding; the contract viewer marks them.
 */

/**
 * The passages for one or more clause references, in the order given, one per page the
 * clause touches. A reference that was not placed falls back to the closest clause above it
 * that was ("11.2" to "11", the whole section) and is marked approximate; one with no placed
 * ancestor yields nothing. Section 15 text comes from the stored (redacted) clauses.
 */
export function passagesFor(
  references: (string | null | undefined)[],
  locations: ClauseLocation[],
  clauses: Pick<Clause, "number" | "textEn" | "textAr">[],
): Passage[] {
  const seen = new Set<string>();
  const passages: Passage[] = [];
  for (const reference of references) {
    if (!reference || seen.has(reference)) continue;
    seen.add(reference);
    const placed = closestPlaced(reference, locations);
    if (!placed) continue;
    const text = clauses.find((clause) => clause.number === placed.clause);
    for (const location of placed.locations) {
      passages.push({
        clause: placed.clause,
        page: location.page,
        pageWidth: location.pageWidth,
        pageHeight: location.pageHeight,
        box: {
          xMin: location.xMin,
          yMin: location.yMin,
          xMax: location.xMax,
          yMax: location.yMax,
        },
        textEn: text?.textEn ?? null,
        textAr: text?.textAr ?? null,
        approximate: placed.clause !== reference,
      });
    }
  }
  return passages;
}

/** The locations of `reference`, or of its nearest ancestor ("9.1.1" → "9.1" → "9"). */
function closestPlaced(
  reference: string,
  locations: ClauseLocation[],
): { clause: string; locations: ClauseLocation[] } | null {
  const parts = reference.split(".");
  for (let length = parts.length; length >= 1; length--) {
    const clause = parts.slice(0, length).join(".");
    const found = locations
      .filter((location) => location.clause === clause)
      .sort((a, b) => a.page - b.page || a.yMin - b.yMin);
    if (found.length > 0) return { clause, locations: found };
  }
  return null;
}
