import { and, eq } from "drizzle-orm";
import type {
  Clause,
  ClauseLocation,
  ContractFieldName,
  Finding,
} from "@rater/contracts";
import { REVIEW_RULE_ID } from "@rater/core";
import type { ExtractionResult, PipelineResult } from "@rater/core";
import {
  clauseLocations,
  clauses,
  contractFields,
  documents,
  findings,
  newId,
  ratings,
} from "@rater/db";
import type { Db } from "@rater/db";

/*
 * Every database read and write of a rating job. The job itself (rate-job.ts) only decides
 * what to write and when.
 */

export type RatingRow = typeof ratings.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;

/**
 * error_code of a failed rating. "timeout" is set by the hourly sweep (stuck-ratings.ts) when a
 * rating's job stopped without finishing.
 */
export type RatingErrorCode =
  "unsupported_document" | "document_missing" | "internal" | "timeout";

/** A pipeline result that rated the contract (not rejected). */
export type RatedResult = Omit<
  PipelineResult,
  "status" | "rejectReason" | "extraction"
> & {
  status: "done" | "needs_review";
  extraction: ExtractionResult;
};

export async function findRating(
  db: Db,
  ratingId: string,
): Promise<RatingRow | undefined> {
  const [rating] = await db.select().from(ratings).where(eq(ratings.id, ratingId));
  return rating;
}

/** The rating's document, looked up within the rating's owner. */
export async function findDocument(
  db: Db,
  rating: Pick<RatingRow, "userId" | "documentId">,
): Promise<DocumentRow | undefined> {
  if (!rating.documentId) return undefined;
  const [document] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, rating.documentId), eq(documents.userId, rating.userId)));
  return document;
}

/** A new attempt starts: status extracting, and anything a previous attempt left is cleared. */
export async function markExtracting(db: Db, ratingId: string): Promise<void> {
  await db
    .update(ratings)
    .set({
      status: "extracting",
      lastStep: null,
      startedAt: new Date(),
      finishedAt: null,
      errorCode: null,
      error: null,
    })
    .where(eq(ratings.id, ratingId));
}

/** The PDF was read and is a Qiwa contract; the pipeline runs next. */
export async function markAnalysing(db: Db, ratingId: string): Promise<void> {
  await db
    .update(ratings)
    .set({ status: "analysing", lastStep: "detect" })
    .where(eq(ratings.id, ratingId));
}

/** `message` is shown to the user, so it never contains contract text. */
export async function markFailed(
  db: Db,
  ratingId: string,
  code: RatingErrorCode,
  message: string,
): Promise<void> {
  await db
    .update(ratings)
    .set({ status: "failed", errorCode: code, error: message, finishedAt: new Date() })
    .where(eq(ratings.id, ratingId));
}

/**
 * Replaces the rating's fields, clauses, clause locations and findings with this result and
 * finishes the rating, all in one transaction. Replacing (delete, then insert) makes a retried or repeated job
 * idempotent; the row lock makes two attempts of the same job save one after the other.
 * Returns false when the rating was deleted while the job ran (nothing is written then).
 */
export async function saveResult(
  db: Db,
  rating: Pick<RatingRow, "id" | "defaultView">,
  result: RatedResult,
): Promise<boolean> {
  const ratingId = rating.id;
  const score = result.scores[rating.defaultView];

  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ id: ratings.id })
      .from(ratings)
      .where(eq(ratings.id, ratingId))
      .for("update");
    if (!locked) return false;

    await tx.delete(contractFields).where(eq(contractFields.ratingId, ratingId));
    await tx.delete(clauses).where(eq(clauses.ratingId, ratingId));
    await tx.delete(clauseLocations).where(eq(clauseLocations.ratingId, ratingId));
    await tx.delete(findings).where(eq(findings.ratingId, ratingId));

    const fieldRows = contractFieldRows(ratingId, result.extraction);
    const clauseRows = clauseRowsFor(ratingId, result.extraction.clauses);
    const locationRows = clauseLocationRows(ratingId, result.extraction.clauseLocations);
    const findingRows = findingRowsFor(ratingId, result.findings);
    if (fieldRows.length > 0) await tx.insert(contractFields).values(fieldRows);
    if (clauseRows.length > 0) await tx.insert(clauses).values(clauseRows);
    if (locationRows.length > 0) await tx.insert(clauseLocations).values(locationRows);
    if (findingRows.length > 0) await tx.insert(findings).values(findingRows);

    await tx
      .update(ratings)
      .set({
        status: result.status,
        lastStep: "save",
        lawVersion: result.versions.law,
        rulesetVersion: result.versions.ruleset,
        promptVersion: result.versions.prompt,
        model: result.versions.model,
        // The default view's score; the other view is computed from the sub-scores.
        scoreOverall: score.overall,
        scoreLegal: score.legal,
        scoreMarket: score.market,
        scoreClarity: score.clarity,
        deadlines: result.deadlines,
        // Always set, so a retried job that ends done clears what an earlier attempt stored.
        reviewReasons: reviewReasonsFor(result),
        usage: result.usage,
        errorCode: null,
        error: null,
        finishedAt: new Date(),
      })
      .where(eq(ratings.id, ratingId));
    return true;
  });
}

/** The reason shown when a REVIEW-00 finding exists: the analyser failed on a clause twice. */
export const UNANALYSED_CLAUSE_REASON =
  "One or more Section 15 clauses could not be analysed automatically; check them by hand.";

/**
 * Why a needs_review rating needs a human look, in plain English: the extraction issues (a
 * missing field, wage parts that don't add up), plus one line when a Section 15 clause could
 * not be analysed. Empty for a done rating. The messages can quote values from the user's
 * contract, such as a wage total, so they go into their report and never into a log.
 */
export function reviewReasonsFor(result: {
  status: RatedResult["status"];
  extraction: Pick<ExtractionResult, "issues">;
  findings: Pick<Finding, "ruleId">[];
}): string[] {
  if (result.status === "done") return [];
  const reasons = result.extraction.issues.map((issue) => issue.message);
  if (result.findings.some((finding) => finding.ruleId === REVIEW_RULE_ID)) {
    reasons.push(UNANALYSED_CLAUSE_REASON);
  }
  // The same sentence twice tells the reader nothing more.
  return [...new Set(reasons)];
}

/**
 * One row per contract field, including fields that were not found (value null), so the
 * API can rebuild the whole ContractFields object. A field without recorded provenance gets
 * no page and "low" confidence.
 */
export function contractFieldRows(
  ratingId: string,
  extraction: Pick<ExtractionResult, "fields" | "provenance">,
): (typeof contractFields.$inferInsert)[] {
  const names = Object.keys(extraction.fields) as ContractFieldName[];
  return names.map((field) => {
    const provenance = extraction.provenance[field];
    return {
      ratingId,
      field,
      value: extraction.fields[field],
      page: provenance?.page ?? null,
      confidence: provenance?.confidence ?? "low",
    };
  });
}

/** Clauses arrive redacted from the pipeline (English text and Arabic OCR alike). */
export function clauseRowsFor(
  ratingId: string,
  items: Clause[],
): (typeof clauses.$inferInsert)[] {
  return items.map((clause) => ({
    id: newId("cl"),
    ratingId,
    section: clause.section,
    number: clause.number,
    textEn: clause.textEn,
    textAr: clause.textAr,
    textHash: clause.textHash,
  }));
}

/** One row per clause per page. The boxes carry no text, so there is nothing to redact. */
export function clauseLocationRows(
  ratingId: string,
  locations: ClauseLocation[],
): (typeof clauseLocations.$inferInsert)[] {
  return locations.map((location) => ({ ratingId, ...location }));
}

/** `position` keeps the pipeline's order, so reports list findings the same way every time. */
export function findingRowsFor(
  ratingId: string,
  items: Finding[],
): (typeof findings.$inferInsert)[] {
  return items.map((finding, position) => ({
    id: newId("fd"),
    ratingId,
    ruleId: finding.ruleId,
    clauseRef: finding.clause,
    relatedClause: finding.relatedClause ?? null,
    verdict: finding.verdict,
    severity: finding.severity,
    confidence: finding.confidence,
    categories: finding.categories,
    articles: finding.articles,
    impact: finding.impact,
    explanation: finding.explanation,
    employeeMsg: finding.employeeMsg,
    hrMsg: finding.hrMsg,
    askFor: finding.askFor ?? null,
    suggestedWording: finding.suggestedWording ?? null,
    source: finding.source,
    needsReview: finding.needsReview,
    position,
  }));
}
