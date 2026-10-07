import { and, eq } from "drizzle-orm";
import type { ClauseLocation } from "@rater/contracts";
import { passageCrop } from "@rater/core";
import { clauseLocations } from "@rater/db";
import type { Db } from "@rater/db";
import { PdfToolError, renderPage, renderPageCrop } from "@rater/pdf";
import type { ObjectStorage } from "@rater/storage";
import { notFound } from "../errors";
import { ConcurrencyLimit } from "../limiter";
import type { RatingRow } from "../report";
import { readStoredPdf } from "./document";

/*
 * Images cut from the stored PDF when asked for: the passage behind a finding, and whole pages
 * for the contract viewer. Nothing is written anywhere: no cache, no thumbnail, so deleting
 * the PDF really is the end of it (the routes also send them with no-store).
 */

/** pdftoppm processes at once per API process; the rest wait their turn. */
const MAX_CONCURRENT_RENDERS = 4;
const renders = new ConcurrencyLimit(MAX_CONCURRENT_RENDERS);

/**
 * PNG of the passage for `clause` on `page`, exactly the `crop` the report gave for it.
 * 404 when the clause was not located on that page or the PDF is no longer stored.
 */
export async function renderPassage(
  deps: { db: Db; storage: ObjectStorage },
  rating: RatingRow,
  clause: string,
  page: number,
): Promise<Buffer> {
  const location = await findClauseLocation(deps.db, rating.id, clause, page);
  if (!location) throw notFound("That clause was not located on that page.");
  const { pdf } = await readStoredPdf(deps, rating);
  const crop = passageCrop(location);
  return renders.run(() => renderPageCrop(pdf, { page, ...crop }));
}

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

async function findClauseLocation(
  db: Db,
  ratingId: string,
  clause: string,
  page: number,
): Promise<ClauseLocation | null> {
  const [location] = await db
    .select(clauseLocationColumns)
    .from(clauseLocations)
    .where(
      and(
        eq(clauseLocations.ratingId, ratingId),
        eq(clauseLocations.clause, clause),
        eq(clauseLocations.page, page),
      ),
    );
  return location ?? null;
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
