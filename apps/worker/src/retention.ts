import { and, asc, eq, isNull, lt } from "drizzle-orm";
import { auditEvents, documents, newId } from "@rater/db";
import type { Db } from "@rater/db";
import type { ObjectStorage } from "@rater/storage";
import type { Logger } from "pino";
import { errorForLog } from "./logger";

export interface RetentionDeps {
  db: Db;
  storage: ObjectStorage;
  logger: Logger;
  /** Defaults to the current time. */
  now?: Date;
}

export interface SweepResult {
  /** Documents whose PDF was removed by this sweep. */
  deleted: number;
  /** Documents whose PDF could not be removed; the next sweep tries again. */
  failed: number;
}

/** Documents handled per sweep. The sweep runs hourly, so any backlog clears within a few runs. */
const SWEEP_BATCH = 500;

/**
 * Deletes the PDFs of documents past their delete_after time. For each one: remove the file
 * from storage, then set deleted_at and write an "auto_delete" audit event in one transaction.
 * The document row stays (the rating still points at it); only the file goes.
 *
 * Idempotent and safe to run twice at once: storage deletes of a missing file succeed, and the
 * `deleted_at is null` condition lets only one sweep record each deletion.
 */
export async function sweepExpiredDocuments(deps: RetentionDeps): Promise<SweepResult> {
  const now = deps.now ?? new Date();
  const expired = await deps.db
    .select({
      id: documents.id,
      orgId: documents.orgId,
      storageKey: documents.storageKey,
    })
    .from(documents)
    .where(and(lt(documents.deleteAfter, now), isNull(documents.deletedAt)))
    .orderBy(asc(documents.deleteAfter))
    .limit(SWEEP_BATCH);

  const result: SweepResult = { deleted: 0, failed: 0 };
  for (const document of expired) {
    try {
      await deps.storage.delete(document.storageKey);
      if (await recordDeletion(deps.db, document, now)) result.deleted += 1;
    } catch (error) {
      result.failed += 1;
      deps.logger.error(
        { err: errorForLog(error), documentId: document.id },
        "Could not delete an expired document",
      );
    }
  }

  deps.logger.info(
    { ...result, batchFull: expired.length === SWEEP_BATCH },
    "Retention sweep finished",
  );
  return result;
}

/** Marks the document deleted and audits it. False when another sweep got there first. */
async function recordDeletion(
  db: Db,
  document: { id: string; orgId: string },
  now: Date,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(documents)
      .set({ deletedAt: now })
      .where(and(eq(documents.id, document.id), isNull(documents.deletedAt)))
      .returning({ id: documents.id });
    if (updated.length === 0) return false;

    await tx.insert(auditEvents).values({
      id: newId("ae"),
      orgId: document.orgId,
      // No user: the system deleted it under the org's retention setting.
      userId: null,
      action: "auto_delete",
      targetId: document.id,
      meta: { reason: "retention" },
      at: now,
    });
    return true;
  });
}
