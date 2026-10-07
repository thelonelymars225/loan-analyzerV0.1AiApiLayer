import { createHash } from "node:crypto";
import { and, asc, count, desc, eq, gt, inArray, sql } from "drizzle-orm";
import {
  DEFAULT_RETENTION_DAYS,
  type RatingStatus,
  type RatingSummary,
  type View,
} from "@rater/contracts";
import { bandFor } from "@rater/core";
import { auditEvents, documents, newId, ratings } from "@rater/db";
import type { Db, DbTransaction } from "@rater/db";
import type { ObjectStorage } from "@rater/storage";
import { recordAudit } from "../audit";
import { notFound, rateLimited } from "../errors";
import type { RequestContext } from "../plugins/session";
import type { RatingQueue } from "../queue";
import type { RatingRow } from "../report";
import { encodeCursor, type Cursor } from "./cursor";
import { findDocument } from "./document";

const DAY_MS = 24 * 60 * 60 * 1000;
export const PAGE_SIZE = 20;
/** Postgres advisory lock namespace for counting and recording a user's uploads. */
const DAILY_LIMIT_LOCK = 4_120_772;

/**
 * Daily limit per user: uploads accepted in the last 24 hours,
 * counted from the "upload" audit events. Deleting a rating keeps its audit event, so it
 * gives no quota back; an upload that failed has its event removed (undoUpload).
 * Over the limit → 429 with Retry-After = seconds until the oldest of them is 24 hours old.
 */
export async function checkDailyLimit(
  db: Db | DbTransaction,
  userId: string,
  limit: number,
  now: Date,
): Promise<void> {
  const since = new Date(now.getTime() - DAY_MS);
  const recent = and(
    eq(auditEvents.userId, userId),
    eq(auditEvents.action, "upload"),
    gt(auditEvents.at, since),
  );
  const [counted] = await db.select({ total: count() }).from(auditEvents).where(recent);
  if ((counted?.total ?? 0) < limit) return;

  const [oldest] = await db
    .select({ at: auditEvents.at })
    .from(auditEvents)
    .where(recent)
    .orderBy(asc(auditEvents.at))
    .limit(1);
  const freesAt = (oldest?.at.getTime() ?? now.getTime()) + DAY_MS;
  const retryAfterSeconds = Math.max(1, Math.ceil((freesAt - now.getTime()) / 1000));
  throw rateLimited(limit, retryAfterSeconds);
}

export interface NewRating {
  ctx: RequestContext;
  pdf: Buffer;
  pages: number;
  /** The view asked for at upload; otherwise the employee's. */
  view: View | null;
  /** The user's daily upload limit (RATE_LIMIT_PER_DAY). */
  dailyLimit: number;
}

/**
 * Stores the PDF, writes the document and rating rows (status "queued") and enqueues the job.
 * If anything fails, what was already written is removed again, so a failed upload leaves
 * nothing behind and does not count towards the daily limit.
 *
 * The daily limit is checked again inside the transaction that records the upload, under a
 * per-user lock: concurrent uploads from one user take turns, and each one counts the
 * uploads committed before it, so no more than the limit can get through together.
 */
export async function createRating(
  deps: { db: Db; storage: ObjectStorage; queue: RatingQueue; now: () => Date },
  input: NewRating,
): Promise<string> {
  const { db, storage, queue } = deps;
  const { ctx, pdf } = input;
  const now = deps.now();
  const userId = ctx.user.id;

  const documentId = newId("doc");
  const ratingId = newId("rt");
  const storageKey = `users/${userId}/documents/${documentId}.pdf`;
  await storage.put(storageKey, pdf, "application/pdf");

  try {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(${DAILY_LIMIT_LOCK}, hashtext(${userId}))`,
      );
      await checkDailyLimit(tx, userId, input.dailyLimit, now);
      await tx.insert(documents).values({
        id: documentId,
        userId,
        storageKey,
        sha256: createHash("sha256").update(pdf).digest("hex"),
        sizeBytes: pdf.length,
        pages: input.pages,
        deleteAfter: new Date(now.getTime() + DEFAULT_RETENTION_DAYS * DAY_MS),
        createdAt: now,
      });
      await tx.insert(ratings).values({
        id: ratingId,
        userId,
        documentId,
        status: "queued",
        defaultView: input.view ?? "employee",
        // Set here (millisecond precision) rather than by the database, so the list cursor,
        // which carries a JavaScript Date, compares exactly.
        createdAt: now,
      });
      await recordAudit(tx, {
        userId,
        action: "upload",
        targetId: ratingId,
        meta: { documentId, sizeBytes: pdf.length, pages: input.pages },
        at: now, // the daily limit counts with the same clock
      });
    });
    await queue.send(ratingId);
  } catch (error) {
    // Best effort, and the original error is the one to report. If the file cannot be
    // deleted, the rows stay as well and the retention sweep removes the file later.
    await undoUpload(deps, { storageKey, ratingId, documentId }).catch(() => undefined);
    throw error;
  }
  return ratingId;
}

async function undoUpload(
  deps: { db: Db; storage: ObjectStorage },
  upload: { storageKey: string; ratingId: string; documentId: string },
): Promise<void> {
  await deps.storage.delete(upload.storageKey);
  await removeRatingRows(deps.db, upload.ratingId, upload.documentId);
  // The upload never happened as far as the daily limit is concerned.
  await deps.db
    .delete(auditEvents)
    .where(
      and(eq(auditEvents.action, "upload"), eq(auditEvents.targetId, upload.ratingId)),
    );
}

/** The rating, or 404 when it does not exist or the caller did not upload it. */
export async function findVisibleRating(
  db: Db,
  ctx: RequestContext,
  ratingId: string,
): Promise<RatingRow> {
  const [rating] = await db
    .select()
    .from(ratings)
    .where(and(eq(ratings.id, ratingId), eq(ratings.userId, ctx.user.id)));
  if (!rating) throw notFound("No such rating.");
  return rating;
}

/** The rating's current status, or null once it is deleted. The event stream polls this. */
export async function readVisibleStatus(
  db: Db,
  ctx: RequestContext,
  ratingId: string,
): Promise<RatingStatus | null> {
  const [row] = await db
    .select({ status: ratings.status })
    .from(ratings)
    .where(and(eq(ratings.id, ratingId), eq(ratings.userId, ctx.user.id)));
  return row?.status ?? null;
}

/** One page of the caller's ratings, newest first. */
export async function listRatings(
  db: Db,
  ctx: RequestContext,
  cursor: Cursor | null,
): Promise<{ items: RatingSummary[]; nextCursor: string | null }> {
  const before = cursor
    ? sql`(${ratings.createdAt}, ${ratings.id}) < (${cursor.createdAt.toISOString()}::timestamptz, ${cursor.id})`
    : undefined;
  const rows = await db
    .select()
    .from(ratings)
    .where(and(eq(ratings.userId, ctx.user.id), before))
    .orderBy(desc(ratings.createdAt), desc(ratings.id))
    .limit(PAGE_SIZE + 1);

  const page = rows.slice(0, PAGE_SIZE);
  const last = page.at(-1);
  const hasMore = rows.length > PAGE_SIZE;
  return {
    items: page.map(toSummary),
    nextCursor: hasMore && last ? encodeCursor(last) : null,
  };
}

function toSummary(rating: RatingRow): RatingSummary {
  return {
    id: rating.id,
    status: rating.status,
    defaultView: rating.defaultView,
    scoreOverall: rating.scoreOverall,
    band: rating.scoreOverall === null ? null : bandFor(rating.scoreOverall),
    createdAt: rating.createdAt.toISOString(),
    finishedAt: rating.finishedAt?.toISOString() ?? null,
  };
}

/**
 * Deletes the stored PDF first and then the rows (findings, fields and clauses go with the
 * rating by cascade). In that order a failure never leaves a file without a row pointing at
 * it; the user can simply retry.
 */
export async function deleteRating(
  deps: { db: Db; storage: ObjectStorage },
  ctx: RequestContext,
  rating: RatingRow,
): Promise<void> {
  const { db, storage } = deps;
  const document = rating.documentId ? await findDocument(db, rating.documentId) : null;
  if (document) await storage.delete(document.storageKey);

  await db.transaction(async (tx) => {
    await removeRatingRows(tx, rating.id, rating.documentId);
    await recordAudit(tx, {
      userId: ctx.user.id,
      action: "delete",
      targetId: rating.id,
      meta: { documentId: rating.documentId },
    });
  });
}

/**
 * Deletes every rating (with its findings, fields and clauses), document row and stored PDF
 * of the caller, and audits each deleted rating. Same order as deleteRating: files first,
 * then rows. Only the documents listed at the start lose their files and rows, so an upload
 * finishing meanwhile never ends up as a file without a row. Returns the ratings deleted.
 */
export async function deleteUserData(
  deps: { db: Db; storage: ObjectStorage },
  ctx: RequestContext,
): Promise<number> {
  const { db, storage } = deps;
  const userId = ctx.user.id;
  const [ratingRows, documentRows] = await Promise.all([
    db
      .select({ id: ratings.id, documentId: ratings.documentId })
      .from(ratings)
      .where(eq(ratings.userId, userId)),
    db
      .select({ id: documents.id, storageKey: documents.storageKey })
      .from(documents)
      .where(eq(documents.userId, userId)),
  ]);
  for (const document of documentRows) await storage.delete(document.storageKey);

  await db.transaction(async (tx) => {
    if (ratingRows.length > 0) {
      const ids = ratingRows.map((rating) => rating.id);
      await tx.delete(ratings).where(inArray(ratings.id, ids));
    }
    if (documentRows.length > 0) {
      const ids = documentRows.map((document) => document.id);
      await tx.delete(documents).where(inArray(documents.id, ids));
    }
    for (const rating of ratingRows) {
      await recordAudit(tx, {
        userId,
        action: "delete",
        targetId: rating.id,
        meta: { documentId: rating.documentId, allData: true },
      });
    }
  });
  return ratingRows.length;
}

async function removeRatingRows(
  db: Db | DbTransaction,
  ratingId: string,
  documentId: string | null,
): Promise<void> {
  await db.delete(ratings).where(eq(ratings.id, ratingId));
  if (documentId) await db.delete(documents).where(eq(documents.id, documentId));
}
