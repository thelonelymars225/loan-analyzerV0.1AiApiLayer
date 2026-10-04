import { createHash } from "node:crypto";
import { and, asc, count, desc, eq, gt, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { OrgKind, RatingStatus, RatingSummary, View } from "@rater/contracts";
import { bandFor } from "@rater/core";
import { documents, newId, orgs, ratings } from "@rater/db";
import type { Db, DbTransaction } from "@rater/db";
import { ObjectNotFoundError } from "@rater/storage";
import type { ObjectStorage } from "@rater/storage";
import { recordAudit } from "../audit";
import { notFound, rateLimited } from "../errors";
import { seesAllRatings } from "../plugins/access";
import type { RequestContext } from "../plugins/session";
import type { RatingQueue } from "../queue";
import type { RatingRow } from "../report";
import { encodeCursor, type Cursor } from "./cursor";

const DAY_MS = 24 * 60 * 60 * 1000;
export const PAGE_SIZE = 20;

/**
 * Daily limit per user (across all their workspaces): ratings created in the last 24 hours.
 * Over the limit → 429 with Retry-After = seconds until the oldest of them is 24 hours old.
 */
export async function checkDailyLimit(
  db: Db,
  userId: string,
  limit: number,
  now: Date,
): Promise<void> {
  const since = new Date(now.getTime() - DAY_MS);
  const recent = and(eq(ratings.createdBy, userId), gt(ratings.createdAt, since));
  const [counted] = await db.select({ total: count() }).from(ratings).where(recent);
  if ((counted?.total ?? 0) < limit) return;

  const [oldest] = await db
    .select({ createdAt: ratings.createdAt })
    .from(ratings)
    .where(recent)
    .orderBy(asc(ratings.createdAt))
    .limit(1);
  const freesAt = (oldest?.createdAt.getTime() ?? now.getTime()) + DAY_MS;
  const retryAfterSeconds = Math.max(1, Math.ceil((freesAt - now.getTime()) / 1000));
  throw rateLimited(limit, retryAfterSeconds);
}

export interface NewRating {
  ctx: RequestContext;
  pdf: Buffer;
  pages: number;
  /** The view asked for at upload; otherwise it follows the workspace kind. */
  view: View | null;
}

/**
 * Stores the PDF, writes the document and rating rows (status "queued") and enqueues the job.
 * If anything fails, what was already written is removed again, so a failed upload leaves
 * nothing behind and does not count towards the daily limit.
 */
export async function createRating(
  deps: { db: Db; storage: ObjectStorage; queue: RatingQueue; now: () => Date },
  input: NewRating,
): Promise<string> {
  const { db, storage, queue } = deps;
  const { ctx, pdf } = input;
  const now = deps.now();
  const org = await loadOrg(db, ctx.orgId);

  const documentId = newId("doc");
  const ratingId = newId("rt");
  const storageKey = `orgs/${ctx.orgId}/documents/${documentId}.pdf`;
  await storage.put(storageKey, pdf, "application/pdf");

  try {
    await db.transaction(async (tx) => {
      await tx.insert(documents).values({
        id: documentId,
        orgId: ctx.orgId,
        uploadedBy: ctx.user.id,
        storageKey,
        sha256: createHash("sha256").update(pdf).digest("hex"),
        sizeBytes: pdf.length,
        pages: input.pages,
        // Retention: the org's setting at upload time. Changing it later affects new uploads.
        deleteAfter: new Date(now.getTime() + org.retentionDays * DAY_MS),
        createdAt: now,
      });
      await tx.insert(ratings).values({
        id: ratingId,
        orgId: ctx.orgId,
        documentId,
        createdBy: ctx.user.id,
        status: "queued",
        defaultView: input.view ?? defaultViewFor(org.kind),
        // Set here (millisecond precision) rather than by the database, so the list cursor,
        // which carries a JavaScript Date, compares exactly.
        createdAt: now,
      });
      await recordAudit(tx, {
        orgId: ctx.orgId,
        userId: ctx.user.id,
        action: "upload",
        targetId: ratingId,
        meta: { documentId, sizeBytes: pdf.length, pages: input.pages },
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
}

/** Personal workspaces rate from the employee's side, company workspaces from HR's. */
export function defaultViewFor(kind: OrgKind): View {
  return kind === "company" ? "hr" : "employee";
}

async function loadOrg(db: Db, orgId: string) {
  const [org] = await db
    .select({ kind: orgs.kind, retentionDays: orgs.retentionDays })
    .from(orgs)
    .where(eq(orgs.id, orgId));
  if (!org) throw notFound("No such workspace.");
  return org;
}

/** Who may see a rating: anyone in the org for owners/admins, the uploader for members. */
function visibleTo(ctx: RequestContext): SQL | undefined {
  const inOrg = eq(ratings.orgId, ctx.orgId);
  return seesAllRatings(ctx) ? inOrg : and(inOrg, eq(ratings.createdBy, ctx.user.id));
}

/** The rating, or 404 when it does not exist or the caller may not see it. */
export async function findVisibleRating(
  db: Db,
  ctx: RequestContext,
  ratingId: string,
): Promise<RatingRow> {
  const [rating] = await db
    .select()
    .from(ratings)
    .where(and(eq(ratings.id, ratingId), visibleTo(ctx)));
  if (!rating) throw notFound("No such rating.");
  return rating;
}

/** The rating's current status, or null once it has been deleted. */
export async function readRatingStatus(
  db: Db,
  ratingId: string,
): Promise<RatingStatus | null> {
  const [row] = await db
    .select({ status: ratings.status })
    .from(ratings)
    .where(eq(ratings.id, ratingId));
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
    .where(and(visibleTo(ctx), before))
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
      orgId: ctx.orgId,
      userId: ctx.user.id,
      action: "delete",
      targetId: rating.id,
      meta: { documentId: rating.documentId },
    });
  });
}

/** The uploaded PDF, or 404 once retention (or anything else) has removed it. */
export async function readStoredPdf(
  deps: { db: Db; storage: ObjectStorage },
  rating: RatingRow,
): Promise<{ documentId: string; pdf: Buffer }> {
  const gone = () =>
    notFound("The PDF is no longer stored (deleted after the retention period).");
  const document = rating.documentId
    ? await findDocument(deps.db, rating.documentId)
    : null;
  if (!document || document.deletedAt) throw gone();
  try {
    return { documentId: document.id, pdf: await deps.storage.get(document.storageKey) };
  } catch (error) {
    if (error instanceof ObjectNotFoundError) throw gone();
    throw error;
  }
}

async function findDocument(db: Db, documentId: string) {
  const [document] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, documentId));
  return document ?? null;
}

async function removeRatingRows(
  db: Db | DbTransaction,
  ratingId: string,
  documentId: string | null,
): Promise<void> {
  await db.delete(ratings).where(eq(ratings.id, ratingId));
  if (documentId) await db.delete(documents).where(eq(documents.id, documentId));
}
