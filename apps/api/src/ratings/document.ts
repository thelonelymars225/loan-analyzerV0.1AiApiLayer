import { eq } from "drizzle-orm";
import type { ReportDocument } from "@rater/contracts";
import { documents } from "@rater/db";
import type { Db } from "@rater/db";
import { ObjectNotFoundError } from "@rater/storage";
import type { ObjectStorage } from "@rater/storage";
import { notFound } from "../errors";
import type { RatingRow } from "../report";

/*
 * The uploaded PDF behind a rating: its row, its bytes and what the report says about it.
 * The file lives in the bucket until retention (or the user) removes it; the row stays so the
 * report can still say when that happened.
 */

export type DocumentRow = typeof documents.$inferSelect;

export async function findDocument(
  db: Db,
  documentId: string,
): Promise<DocumentRow | null> {
  const [document] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, documentId));
  return document ?? null;
}

/** The rating's document row, or null for a rating that has none (or no longer has one). */
export function findRatingDocument(
  db: Db,
  rating: RatingRow,
): Promise<DocumentRow | null> {
  return rating.documentId ? findDocument(db, rating.documentId) : Promise.resolve(null);
}

/** What the report tells the web app about the PDF: page count and whether it can be shown. */
export function describeDocument(document: DocumentRow | null): ReportDocument {
  return {
    pages: document?.pages ?? null,
    available: document !== null && document.deletedAt === null,
    deletedAt: document?.deletedAt?.toISOString() ?? null,
  };
}

/** The uploaded PDF and its row, or 404 once retention (or anything else) has removed it. */
export async function readStoredPdf(
  deps: { db: Db; storage: ObjectStorage },
  rating: RatingRow,
): Promise<{ document: DocumentRow; pdf: Buffer }> {
  const gone = () =>
    notFound("The PDF is no longer stored (deleted after the retention period).");
  const document = await findRatingDocument(deps.db, rating);
  if (!document || document.deletedAt) throw gone();
  try {
    return { document, pdf: await deps.storage.get(document.storageKey) };
  } catch (error) {
    if (error instanceof ObjectNotFoundError) throw gone();
    throw error;
  }
}
