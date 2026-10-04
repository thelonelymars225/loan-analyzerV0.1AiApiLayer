import type { LawArticle } from "@rater/contracts";
import type { Embedder } from "./embedder";
import { embedArticle } from "./lookup";

/** One law_articles row, as the ingest script writes it. */
export interface LawArticleRow {
  id: string;
  lawVersion: string;
  sourceDoc: LawArticle["source"];
  article: string;
  paragraph: string | null;
  textAr: string | null;
  textEnUnofficial: string | null;
  sourceUrl: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  embedding: number[];
}

/**
 * Stable row ID, so re-running the ingest updates rows in place instead of duplicating them.
 * Example: law_2025-11_labor_law_83_1, law_2025-11_labor_law_79-bis.
 */
export function lawArticleRowId(article: LawArticle): string {
  const parts = [article.lawVersion, article.source, article.article];
  if (article.paragraph) parts.push(article.paragraph);
  return `law_${parts.join("_").replace(/\s+/g, "-")}`;
}

export function toLawArticleRow(article: LawArticle, embedder: Embedder): LawArticleRow {
  return {
    id: lawArticleRowId(article),
    lawVersion: article.lawVersion,
    sourceDoc: article.source,
    article: article.article,
    paragraph: article.paragraph,
    textAr: article.textAr,
    textEnUnofficial: article.textEnUnofficial,
    sourceUrl: article.sourceUrl,
    effectiveFrom: article.effectiveFrom,
    effectiveTo: article.effectiveTo,
    embedding: embedArticle(article, embedder),
  };
}
