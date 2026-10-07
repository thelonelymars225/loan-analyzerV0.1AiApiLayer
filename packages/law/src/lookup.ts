import type { ArticleRef, LawArticle } from "@rater/contracts";
import { loadCorpus } from "./load";

/**
 * Does a corpus article answer a reference?
 * - source and article number must match exactly;
 * - a reference without a paragraph matches every chunk of the article;
 * - a whole-article chunk (paragraph null) matches any paragraph of it;
 * - otherwise the chunk's paragraph must start with the referenced one, at a digit boundary:
 *   "1" matches "1" and "1(a)" but not "10".
 */
export function matchesRef(article: LawArticle, ref: ArticleRef): boolean {
  if (article.source !== ref.source || article.article !== ref.article) return false;
  if (ref.paragraph === undefined || article.paragraph === null) return true;
  if (!article.paragraph.startsWith(ref.paragraph)) return false;
  const next = article.paragraph.charAt(ref.paragraph.length);
  return !/\d/.test(next);
}

/**
 * ArticleLookup over the bundled corpus, held in memory: rule-first lookup by reference.
 * Used by the worker, tests and evals.
 */
export class MemoryArticleLookup {
  private readonly articles: LawArticle[];

  constructor(articles: LawArticle[] = loadCorpus()) {
    this.articles = articles;
  }

  /** Articles matching any of the references, in corpus order, without duplicates. */
  async byRefs(refs: ArticleRef[]): Promise<LawArticle[]> {
    return this.articles.filter((article) =>
      refs.some((ref) => matchesRef(article, ref)),
    );
  }
}
