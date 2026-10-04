import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ContractType, ImpactParams, Severity, Verdict } from "@rater/contracts";

/**
 * The Section 15 clause library (evals/clause-library.json): synthetic clauses, each tagged with
 * the answer the analyser should give. The eval cases take their Section 15 text from it, and
 * test/clause-library.test.ts runs every text through the offline analyser.
 */

const LIBRARY_PATH = fileURLToPath(new URL("../clause-library.json", import.meta.url));

export const ClauseText = z.object({ en: z.string().min(1), ar: z.string().min(1) });
export type ClauseText = z.infer<typeof ClauseText>;

/** What the clause step (4b) should answer for one clause, before the impact step. */
export const ExpectedMatch = z.object({
  ruleId: z.string(),
  verdict: Verdict,
  severity: Severity,
  impactParams: ImpactParams.optional(),
});
export type ExpectedMatch = z.infer<typeof ExpectedMatch>;

/** What the cross-check (4c) should answer when Section 1 records `contractType`. */
export const ExpectedConflict = z.object({
  contractType: ContractType,
  ruleId: z.string(),
  verdict: Verdict,
  severity: Severity,
});
export type ExpectedConflict = z.infer<typeof ExpectedConflict>;

export const LibraryClause = ClauseText.extend({
  key: z.string().regex(/^[a-z0-9_]+$/),
  /** null: the clause should match no rule. */
  expected: ExpectedMatch.nullable(),
  crossCheck: ExpectedConflict.optional(),
  /** Same meaning, other words: one or two per clause. */
  paraphrases: z.array(ClauseText).min(1).max(2),
});
export type LibraryClause = z.infer<typeof LibraryClause>;

export const ClauseLibrary = z.object({
  clauses: z.array(LibraryClause).min(1),
});
export type ClauseLibrary = z.infer<typeof ClauseLibrary>;

export function loadClauseLibrary(path: string = LIBRARY_PATH): ClauseLibrary {
  const library = ClauseLibrary.parse(JSON.parse(readFileSync(path, "utf8")));
  const keys = library.clauses.map((clause) => clause.key);
  const duplicate = keys.find((key, index) => keys.indexOf(key) !== index);
  if (duplicate) throw new Error(`clause-library.json: duplicate key "${duplicate}"`);
  return library;
}

/** The clause's own text first, then its paraphrases. */
export function variantsOf(clause: LibraryClause): ClauseText[] {
  return [{ en: clause.en, ar: clause.ar }, ...clause.paraphrases];
}

/** The library clause whose text (or one of its paraphrases) is exactly this one. */
export function findLibraryClause(
  library: ClauseLibrary,
  text: ClauseText,
): LibraryClause | null {
  return (
    library.clauses.find((clause) =>
      variantsOf(clause).some(
        (variant) => variant.en === text.en && variant.ar === text.ar,
      ),
    ) ?? null
  );
}
