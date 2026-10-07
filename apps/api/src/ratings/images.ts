import { clauseLocations } from "@rater/db";
import type { Db } from "@rater/db";
import { PdfToolError, renderPage } from "@rater/pdf";
import type { ObjectStorage } from "@rater/storage";
import { notFound } from "../errors";
import { ConcurrencyLimit } from "../limiter";
import type { RatingRow } from "../report";
import { readStoredPdf } from "./document";

/*
 * Images cut from the stored PDF when asked for: whole pages for the contract viewer. Nothing
 * is written anywhere: no cache, no thumbnail, so deleting the PDF really is the end of it (the
 * route also sends them with no-store).
 */

/** pdftoppm processes at once per API process; the rest wait their turn. */
const MAX_CONCURRENT_RENDERS = 4;
const renders = new ConcurrencyLimit(MAX_CONCURRENT_RENDERS);

/** PNG of one whole page. 404 for a page the document does not have or once the PDF is gone. */
export async function renderDocumentPage(
  deps: { db: Db; storage: ObjectStorage },
  rating: RatingRow,
  page: number,
): Promise<Buffer> {
  const { document, pdf } = await readStoredPdf(deps, rating);
  const noSuchPage = () => notFound(`The contract has no page ${page}.`);
  if (document.pages !== null && page > document.pages) throw noSuchPage();
  try {
    return await renders.run(() => renderPage(pdf, page));
  } catch (error) {
    // The page count is unknown for old uploads; pdftoppm then tells us the page is not there.
    if (error instanceof PdfToolError && error.message.includes("no image for page")) {
      throw noSuchPage();
    }
    throw error;
  }
}

/** The ClauseLocation fields of a clause_locations row (everything but the rating id). */
export const clauseLocationColumns = {
  clause: clauseLocations.clause,
  page: clauseLocations.page,
  pageWidth: clauseLocations.pageWidth,
  pageHeight: clauseLocations.pageHeight,
  xMin: clauseLocations.xMin,
  yMin: clauseLocations.yMin,
  xMax: clauseLocations.xMax,
  yMax: clauseLocations.yMax,
};
