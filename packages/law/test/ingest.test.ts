import { randomBytes } from "node:crypto";
import { cosineDistance, eq } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, lawArticles, migrate } from "@rater/db";
import type { Db } from "@rater/db";
import { HashEmbedder, LAW_VERSION, loadCorpus } from "../src";
import { ingestCorpus } from "../src/ingest";

/**
 * Migrates a throwaway database (rater_law_test_<random>) on the server in DATABASE_URL and
 * loads the corpus into it. Never the DATABASE_URL database itself: ingestCorpus deletes law
 * rows that are not in this checkout's corpus, which would rewrite a developer's dev data.
 * Skipped without DATABASE_URL.
 */
const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)("ingestCorpus against Postgres", () => {
  const databaseName = `rater_law_test_${randomBytes(4).toString("hex")}`;
  let admin: pg.Client;
  let db: Db;
  let pool: pg.Pool;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await admin.query(`create database "${databaseName}"`);
    const url = new URL(DATABASE_URL as string);
    url.pathname = `/${databaseName}`;
    const testUrl = url.toString();
    await migrate(testUrl);
    ({ db, pool } = createDb(testUrl, { max: 2 }));
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await admin.query(`drop database if exists "${databaseName}" with (force)`);
    await admin.end();
  }, 60_000);

  it("upserts the corpus idempotently and supports vector search", async () => {
    const first = await ingestCorpus(db);
    const second = await ingestCorpus(db);
    expect(first).toEqual({ upserted: loadCorpus().length, removed: 0 });
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
  });

  it("removes rows of the law version that are no longer in the corpus", async () => {
    const current = loadCorpus().filter((article) => article.lawVersion === LAW_VERSION);
    const kept = current[0];
    if (!kept || current.length < 2) throw new Error("the corpus needs two articles");

    // The first test loaded the whole corpus. Ingesting one article must remove the others.
    const result = await ingestCorpus(db, [kept]);
    const rows = await db
      .select({ id: lawArticles.id })
      .from(lawArticles)
      .where(eq(lawArticles.lawVersion, LAW_VERSION));
    expect(rows).toHaveLength(1);
    expect(result).toEqual({ upserted: 1, removed: current.length - 1 });
  });
});
