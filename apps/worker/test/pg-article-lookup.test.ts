import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatCitation } from "@rater/core";
import { lawArticles } from "@rater/db";
import { loadRules, MemoryArticleLookup } from "@rater/law";
import { createArticleLookup, PgArticleLookup } from "../src/pg-article-lookup";
import { createTestDatabase, DATABASE_URL, ingestCorpus } from "./helpers/test-db";
import type { TestDatabase } from "./helpers/test-db";

const logger = pino({ level: "silent" });

describe.skipIf(!DATABASE_URL)("PgArticleLookup", () => {
  let testDb: TestDatabase;
  let lookup: PgArticleLookup;
  const memory = new MemoryArticleLookup();

  beforeAll(async () => {
    testDb = await createTestDatabase();
    await ingestCorpus(testDb.db);
    lookup = new PgArticleLookup(testDb.db);
  }, 60_000);

  afterAll(async () => {
    await testDb?.drop();
  }, 60_000);

  it("finds articles by reference, in corpus order, without duplicates", async () => {
    const found = await lookup.byRefs([
      { source: "labor_law", article: "84" },
      { source: "labor_law", article: "2" },
      { source: "labor_law", article: "84" },
    ]);
    expect(found.map(formatCitation)).toEqual(["Art. 2", "Art. 84"]);
  });

  it("matches paragraphs like the in-memory lookup", async () => {
    const one = await lookup.byRefs([
      { source: "labor_law", article: "83", paragraph: "1" },
    ]);
    expect(one.map(formatCitation)).toEqual(["Art. 83(1)"]);
    const all = await lookup.byRefs([{ source: "labor_law", article: "83" }]);
    expect(all.map(formatCitation)).toEqual(["Art. 83(1)", "Art. 83(2)", "Art. 83(3)"]);
    // Same article number, other source: not a match.
    expect(
      await lookup.byRefs([{ source: "implementing_regulations", article: "84" }]),
    ).toEqual([]);
  });

  it("returns exactly what MemoryArticleLookup returns for every rule's references", async () => {
    for (const rule of loadRules().rules) {
      expect(await lookup.byRefs(rule.articleRefs), rule.id).toEqual(
        await memory.byRefs(rule.articleRefs),
      );
    }
    const everyRef = loadRules().rules.flatMap((rule) => rule.articleRefs);
    expect(await lookup.byRefs(everyRef)).toEqual(await memory.byRefs(everyRef));
  });

  it("ranks articles by similarity like the in-memory lookup", async () => {
    const queries = [
      "The end-of-service award shall be calculated on the basis of the basic salary only.",
      "The employer may transfer the employee to any of its branches anywhere in the Kingdom.",
      "Overtime shall be compensated at 25% of the basic hourly wage.",
      "تحسب مكافأة نهاية الخدمة على أساس الأجر الأساسي فقط",
    ];
    for (const query of queries) {
      const fromPostgres = (await lookup.search(query, 3)).map(formatCitation);
      const fromMemory = (await memory.search(query, 3)).map(formatCitation);
      expect(fromPostgres, query).toEqual(fromMemory);
      expect(fromPostgres).toHaveLength(3);
    }
    const [best] = await lookup.search(queries[0]!, 1);
    expect(best?.article).toBe("84");
  });

  it("finds nothing for text without words, or for k = 0", async () => {
    expect(await lookup.search("... !!! —", 3)).toEqual([]);
    expect(await memory.search("... !!! —", 3)).toEqual([]);
    expect(await lookup.search("end-of-service award", 0)).toEqual([]);
  });

  it("is chosen by createArticleLookup when law_articles has rows", async () => {
    expect(await createArticleLookup(testDb.db, logger)).toBeInstanceOf(PgArticleLookup);
  });

  it("falls back to the in-memory corpus when law_articles is empty", async () => {
    expect(await createArticleLookup(testDb.db, logger, "1999-01")).toBeInstanceOf(
      MemoryArticleLookup,
    );
    await testDb.db.delete(lawArticles);
    expect(await createArticleLookup(testDb.db, logger)).toBeInstanceOf(
      MemoryArticleLookup,
    );
  });
});
