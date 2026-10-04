import type { ArticleRef, LawArticle } from "@rater/contracts";
import { cosineSimilarity, HashEmbedder, l2Normalise, type Embedder } from "./embedder";
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

/** How an article names itself in each language, so a clause that cites "Article 57" finds it. */
function headings(article: LawArticle): { en: string; ar: string } {
  switch (article.source) {
    case "labor_law":
      return { en: `Article ${article.article}`, ar: `المادة ${article.article}` };
    case "implementing_regulations":
      return {
        en: `Implementing Regulations Article ${article.article}`,
        ar: `اللائحة التنفيذية المادة ${article.article}`,
      };
    case "qiwa_template":
      return { en: `Contract clause ${article.article}`, ar: `البند ${article.article}` };
  }
}

/**
 * The vector an article is searched by. Arabic and English are embedded separately and
 * averaged, so a long English translation doesn't drown the Arabic text (or the reverse),
 * and a query in either language meets every bilingual article on equal terms.
 */
export function embedArticle(article: LawArticle, embedder: Embedder): number[] {
  const heading = headings(article);
  const parts = [
    article.textAr ? `${heading.ar}\n${article.textAr}` : null,
    article.textEnUnofficial ? `${heading.en}\n${article.textEnUnofficial}` : null,
  ].filter((part): part is string => part !== null);
  const sum = new Array<number>(embedder.dim).fill(0);
  for (const part of parts) {
    embedder.embed(part).forEach((x, i) => (sum[i] = sum[i]! + x));
  }
  return l2Normalise(sum);
}

/**
 * In-memory ArticleLookup over the bundled corpus: rule-first lookup by reference, with
 * vector search as the backstop. Used by tests, evals and the offline pipeline. The ingest
 * script stores the same vectors in law_articles, so a Postgres lookup ranks the same way.
 */
export class MemoryArticleLookup {
  private readonly articles: LawArticle[];
  private readonly embedder: Embedder;
  private readonly vectors: number[][];

  constructor(
    articles: LawArticle[] = loadCorpus(),
    embedder: Embedder = new HashEmbedder(),
  ) {
    this.articles = articles;
    this.embedder = embedder;
    this.vectors = articles.map((article) => embedArticle(article, embedder));
  }

  /** Articles matching any of the references, in corpus order, without duplicates. */
  async byRefs(refs: ArticleRef[]): Promise<LawArticle[]> {
    return this.articles.filter((article) =>
      refs.some((ref) => matchesRef(article, ref)),
    );
  }

  /** The k articles most similar to the text, best first. Unrelated articles are left out. */
  async search(text: string, k: number): Promise<LawArticle[]> {
    if (k <= 0) return [];
    const query = this.embedder.embed(text);
    return this.vectors
      .map((vector, index) => ({ index, score: cosineSimilarity(query, vector) }))
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, k)
      .map((hit) => this.articles[hit.index]!);
  }
}
