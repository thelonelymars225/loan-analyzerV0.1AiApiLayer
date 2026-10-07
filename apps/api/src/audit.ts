import { auditEvents, newId } from "@rater/db";
import type { Db, DbTransaction } from "@rater/db";

/**
 * What the architecture doc asks us to audit: uploads, report views, downloads and deletes.
 * "view_document" is the PDF opened in the contract viewer (inline), as opposed to a download.
 * The passage images cut from it are not audited one by one: they are part of viewing the
 * report, which already is.
 */
export type AuditAction = "upload" | "view" | "view_document" | "download" | "delete";

export interface AuditEvent {
  orgId: string;
  userId: string;
  action: AuditAction;
  /** The rating the action was about. */
  targetId: string;
  /** Small, non-personal facts only (ids, sizes). Never file names or contract contents. */
  meta?: Record<string, string | number | boolean | null>;
  /**
   * When it happened; defaults to the database clock. Uploads pass the app's clock, which
   * the daily limit also counts with.
   */
  at?: Date;
}

export async function recordAudit(
  db: Db | DbTransaction,
  event: AuditEvent,
): Promise<void> {
  await db.insert(auditEvents).values({
    id: newId("aud"),
    orgId: event.orgId,
    userId: event.userId,
    action: event.action,
    targetId: event.targetId,
    meta: event.meta ?? null,
    at: event.at,
  });
}
