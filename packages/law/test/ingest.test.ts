import { describe, expect, it } from "vitest";
import { cosineDistance, eq, sql } from "drizzle-orm";
import { HashEmbedder, LAW_VERSION, loadCorpus } from "../src";

const databaseUrl = process.env.DATABASE_URL;

// Needs Postgres with pgvector and the law_articles migration applied (pnpm db:migrate).
describe.skipIf(!databaseUrl)("ingestCorpus against Postgres", () => {
  it("upserts the corpus idempotently and supports vector search", async (ctx) => {
    // Imported lazily so the rest of the suite runs without a database package build.
    const { createDb, lawArticles } = await import("@rater/db");
    const { ingestCorpus } = await import("../src/ingest");
    const { db, pool } = createDb(databaseUrl!);
    try {
      const table = await db.execute<{ name: string | null }>(
        sql`select to_regclass('public.law_articles')::text as name`,
      );
      if (!table.rows[0]?.name)
        ctx.skip("law_articles does not exist; run pnpm db:migrate");

      const first = await ingestCorpus(db);
      const second = await ingestCorpus(db);
      expect(first.upserted).toBe(loadCorpus().length);
      expect(second).toEqual({ upserted: first.upserted, removed: 0 });

      const rows = await db
        .select({ id: lawArticles.id })
        .from(lawArticles)
        .where(eq(lawArticles.lawVersion, LAW_VERSION));
      expect(rows).toHaveLength(loadCorpus().length);

      const query = new HashEmbedder().embed(
        "The end-of-service award shall be calculated on the basis of the basic salary only.",
      );
      const nearest = await db
        .select({ article: lawArticles.article })
        .from(lawArticles)
        .where(eq(lawArticles.lawVersion, LAW_VERSION))
        .orderBy(cosineDistance(lawArticles.embedding, query))
        .limit(1);
      expect(nearest[0]?.article).toBe("84");
    } finally {
      await pool.end();
    }
  });
});
