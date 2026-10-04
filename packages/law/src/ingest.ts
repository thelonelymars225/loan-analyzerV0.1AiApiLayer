/**
 * Loads the law corpus into Postgres: embeds every article and upserts it into law_articles.
 * Rows of the same law version that are no longer in the corpus are removed, so the table
 * always mirrors corpus/articles.json.
 *
 * Usage: DATABASE_URL=postgres://... pnpm law:ingest
 */
import { pathToFileURL } from "node:url";
import { and, eq, notInArray, sql } from "drizzle-orm";
import { createDb, lawArticles } from "@rater/db";
import type { LawArticle } from "@rater/contracts";
import { HashEmbedder, type Embedder } from "./embedder";
import { loadCorpus } from "./load";
import { toLawArticleRow } from "./rows";
import { LAW_VERSION } from "./versions";

type Db = ReturnType<typeof createDb>["db"];

export async function ingestCorpus(
  db: Db,
  articles: LawArticle[] = loadCorpus(),
  embedder: Embedder = new HashEmbedder(),
): Promise<{ upserted: number; removed: number }> {
  const rows = articles.map((article) => toLawArticleRow(article, embedder));
  const versions = new Set(rows.map((row) => row.lawVersion));

  return db.transaction(async (tx) => {
    for (const row of rows) {
      const { id: _id, ...changes } = row;
      await tx.insert(lawArticles).values(row).onConflictDoUpdate({
        target: lawArticles.id,
        set: changes,
      });
    }

    let removed = 0;
    for (const version of versions) {
      const keep = rows.filter((row) => row.lawVersion === version).map((row) => row.id);
      const deleted = await tx
        .delete(lawArticles)
        .where(and(eq(lawArticles.lawVersion, version), notInArray(lawArticles.id, keep)))
        .returning({ id: lawArticles.id });
      removed += deleted.length;
    }
    return { upserted: rows.length, removed };
  });
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set.");
    process.exitCode = 1;
    return;
  }
  const { db, pool } = createDb(connectionString);
  try {
    const { upserted, removed } = await ingestCorpus(db);
    const [count] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(lawArticles)
      .where(eq(lawArticles.lawVersion, LAW_VERSION));
    console.log(
      `law_articles: upserted ${upserted}, removed ${removed}, ${count?.n ?? 0} rows for law version ${LAW_VERSION}.`,
    );
  } finally {
    await pool.end();
  }
}

// Run only when executed directly (tsx src/ingest.ts), not when imported by tests.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
