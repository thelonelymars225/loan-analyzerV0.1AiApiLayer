import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clauseCacheKey } from "@rater/core";
import { clauseCache } from "@rater/db";
import { parseCacheKey, PgClauseCache } from "../src/pg-clause-cache";
import { createTestDatabase, DATABASE_URL } from "./helpers/test-db";
import type { TestDatabase } from "./helpers/test-db";

const clause = {
  section: 15,
  number: "15.1",
  textEn: "The employee shall comply with the company dress code.",
  textAr: null,
  textHash: "a".repeat(64),
};
/** Core keys a clause by its text and the contract's terms (the analyser's field summary). */
const fieldSummary = "Contract type: fixed-term. Probation: 90 days.";
const versions = {
  law: "2025-11",
  ruleset: "0.1.0",
  prompt: "s15-v1",
  model: "heuristic-v1",
};

describe("parseCacheKey", () => {
  it("reads the five parts of core's clauseCacheKey", () => {
    expect(parseCacheKey(clauseCacheKey(clause, fieldSummary, versions))).toEqual({
      textHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      lawVersion: "2025-11",
      rulesetVersion: "0.1.0",
      promptVersion: "s15-v1",
      model: "heuristic-v1",
    });
  });

  it("rejects keys with missing or extra parts", () => {
    expect(() => parseCacheKey("abc|2025-11")).toThrow(/5 non-empty parts/);
    expect(() => parseCacheKey("abc||0.1.0|s15-v1|model")).toThrow(/5 non-empty parts/);
    expect(() => parseCacheKey("a|b|c|d|e|f")).toThrow(/5 non-empty parts/);
  });
});

describe.skipIf(!DATABASE_URL)("PgClauseCache", () => {
  let testDb: TestDatabase;
  let cache: PgClauseCache;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    cache = new PgClauseCache(testDb.db);
  }, 60_000);

  afterAll(async () => {
    await testDb?.drop();
  }, 60_000);

  it("misses, then returns what was stored", async () => {
    const key = clauseCacheKey(clause, fieldSummary, versions);
    expect(await cache.get(key)).toBeUndefined();

    const analysis = { clause: "15.1", matches: [] };
    await cache.set(key, analysis);
    expect(await cache.get(key)).toEqual(analysis);
  });

  it("keeps one row per key and lets a later answer replace it", async () => {
    const key = clauseCacheKey(
      { ...clause, textHash: "b".repeat(64) },
      fieldSummary,
      versions,
    );
    await cache.set(key, { clause: "15.1", matches: [], note: "first" });
    await cache.set(key, { clause: "15.1", matches: [], note: "second" });
    expect(await cache.get(key)).toMatchObject({ note: "second" });
    const rows = await testDb.db.select().from(clauseCache);
    const { textHash } = parseCacheKey(key);
    expect(rows.filter((row) => row.textHash === textHash)).toHaveLength(1);
  });

  it("separates entries by every version in the key", async () => {
    const key = clauseCacheKey(clause, fieldSummary, versions);
    await cache.set(key, { clause: "15.1", matches: [] });
    for (const changed of [
      { ...versions, law: "2026-01" },
      { ...versions, ruleset: "0.2.0" },
      { ...versions, prompt: "s15-v2" },
      { ...versions, model: "claude-opus-5-5" },
    ]) {
      expect(
        await cache.get(clauseCacheKey(clause, fieldSummary, changed)),
      ).toBeUndefined();
    }
  });
});
