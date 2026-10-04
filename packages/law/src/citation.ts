import type { LawArticle } from "@rater/contracts";

/**
 * How an article is cited to readers and to the analyser. packages/core keeps an identical
 * copy (core stays dependency-free), so change both together.
 *   labor_law                → "Art. 84", or "Art. 83(1)" for a paragraph
 *   implementing_regulations → "Exec. Reg. Art. 20"
 *   qiwa_template            → "Contract cl. 14.5"
 */
export function formatCitation(
  article: Pick<LawArticle, "source" | "article" | "paragraph">,
): string {
  switch (article.source) {
    case "labor_law":
      return article.paragraph
        ? `Art. ${article.article}(${article.paragraph})`
        : `Art. ${article.article}`;
    case "implementing_regulations":
      return `Exec. Reg. Art. ${article.article}`;
    case "qiwa_template":
      return `Contract cl. ${article.article}`;
  }
}
