import { and, asc, count, cosineDistance, eq, inArray, isNotNull, lt } from "drizzle-orm";
import type { ArticleRef, LawArticle, LawSource } from "@rater/contracts";
import type { ArticleLookup } from "@rater/core";
import { lawArticles } from "@rater/db";
import type { Db } from "@rater/db";
import { HashEmbedder, LAW_VERSION, matchesRef, MemoryArticleLookup } from "@rater/law";
import type { Embedder } from "@rater/law";
import type { Logger } from "pino";

/**
 * ArticleLookup over the law_articles table (filled by `pnpm law:ingest`). It answers exactly
 * like MemoryArticleLookup: the same reference matching (matchesRef), the same corpus order,
 * and the same vectors, because the ingest stores embedArticle() of each article.
 */
export class PgArticleLookup implements ArticleLookup {
  constructor(
    private readonly db: Db,
    private readonly lawVersion: string = LAW_VERSION,
    private readonly embedder: Embedder = new HashEmbedder(),
  ) {}

  /** Articles matching any of the references, in corpus order, without duplicates. */
  async byRefs(refs: ArticleRef[]): Promise<LawArticle[]> {
    if (refs.length === 0) return [];
    const numbers = [...new Set(refs.map((ref) => ref.article))];
    const rows = await this.db
      .select()
      .from(lawArticles)
      .where(
        and(
          eq(lawArticles.lawVersion, this.lawVersion),
          inArray(lawArticles.article, numbers),
        ),
      );
    // Source and paragraph are matched in code, so the rules stay identical to the in-memory lookup.
    return rows
      .map(toLawArticle)
      .filter((article) => refs.some((ref) => matchesRef(article, ref)))
      .sort(compareCorpusOrder);
  }

  /** The k articles most similar to the text, best first. Unrelated articles are left out. */
  async search(text: string, k: number): Promise<LawArticle[]> {
    if (k <= 0) return [];
    const query = this.embedder.embed(text);
    // Text with no usable words embeds to the zero vector, which is similar to nothing.
    if (query.every((x) => x === 0)) return [];

    const distance = cosineDistance(lawArticles.embedding, query);
    const rows = await this.db
      .select()
      .from(lawArticles)
      .where(
        and(
          eq(lawArticles.lawVersion, this.lawVersion),
          isNotNull(lawArticles.embedding),
          // Distance 1 means cosine similarity 0: no shared features at all.
          lt(distance, 1),
        ),
      )
      .orderBy(distance, asc(lawArticles.id))
      .limit(k);
    return rows.map(toLawArticle);
  }
}

/**
 * The Postgres lookup when law_articles has rows for the law version, otherwise the bundled
 * corpus in memory (for example before the first `pnpm law:ingest`).
 */
export async function createArticleLookup(
  db: Db,
  logger: Logger,
  lawVersion: string = LAW_VERSION,
): Promise<ArticleLookup> {
  const [row] = await db
    .select({ rows: count() })
    .from(lawArticles)
    .where(eq(lawArticles.lawVersion, lawVersion));
  const rows = row?.rows ?? 0;
  if (rows === 0) {
    logger.warn(
      { lawVersion },
      "law_articles is empty for this law version; using the bundled corpus in memory (run pnpm law:ingest)",
    );
    return new MemoryArticleLookup();
  }
  logger.info({ lawVersion, rows }, "Law articles are looked up in Postgres");
  return new PgArticleLookup(db, lawVersion);
}

type LawArticleRow = typeof lawArticles.$inferSelect;

function toLawArticle(row: LawArticleRow): LawArticle {
  return {
    lawVersion: row.lawVersion,
    source: row.sourceDoc as LawSource,
    article: row.article,
    paragraph: row.paragraph,
    textAr: row.textAr,
    textEnUnofficial: row.textEnUnofficial,
    sourceUrl: row.sourceUrl,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
  };
}

/** The corpus lists the Labor Law first, then the regulations, then the Qiwa template. */
const SOURCE_ORDER: Record<LawSource, number> = {
  labor_law: 0,
  implementing_regulations: 1,
  qiwa_template: 2,
};

/** Numeric-aware, so "9" < "79 bis" < "80" and "74(3)" < "74(3 bis)", as in the corpus file. */
const numeric = new Intl.Collator("en", { numeric: true });

function compareCorpusOrder(a: LawArticle, b: LawArticle): number {
  return (
    SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source] ||
    numeric.compare(a.article, b.article) ||
    numeric.compare(a.paragraph ?? "", b.paragraph ?? "")
  );
}
