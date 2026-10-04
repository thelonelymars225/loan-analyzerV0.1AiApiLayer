import { and, asc, eq, gt, sql } from "drizzle-orm";
import type { InvitePreview, InviteResponse } from "@rater/contracts";
import { invitations, memberships, newId, orgs } from "@rater/db";
import type { Db, DbTransaction } from "@rater/db";
import { notFound } from "./errors";
import { parseRole, setSessionOrg } from "./orgs";
import type { RequestContext } from "./plugins/session";

/*
 * Invitations to company workspaces. No email is sent in v1: an owner or admin shares the
 * invitation's link (acceptPath), and only someone signed in with the invited address can
 * see or accept it. Better Auth creates them (POST /orgs/{id}/invites); everything else is
 * here, so its own invitation endpoints, which any member could use, stay closed.
 */

type InvitationRow = typeof invitations.$inferSelect;

/** Where the web app shows an invitation to accept. */
export function acceptPath(invitationId: string): string {
  return `/invite/${encodeURIComponent(invitationId)}`;
}

export function toInviteResponse(row: {
  id: string;
  email: string;
  role: string | null;
  status: string;
  expiresAt: Date;
}): InviteResponse {
  return {
    id: row.id,
    email: row.email,
    role: parseRole(row.role ?? "member"),
    status: row.status,
    expiresAt: row.expiresAt.toISOString(),
    acceptPath: acceptPath(row.id),
  };
}

/** The workspace's invitations that can still be accepted, oldest first. */
export async function listPendingInvites(
  db: Db,
  orgId: string,
  now: Date,
): Promise<InviteResponse[]> {
  const rows = await db
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.organizationId, orgId),
        eq(invitations.status, "pending"),
        gt(invitations.expiresAt, now),
      ),
    )
    .orderBy(asc(invitations.createdAt), asc(invitations.id));
  return rows.map(toInviteResponse);
}

/** Cancels a pending invitation of the workspace; 404 when there is none with that id. */
export async function cancelInvite(
  db: Db,
  orgId: string,
  inviteId: string,
): Promise<void> {
  const canceled = await db
    .update(invitations)
    .set({ status: "canceled" })
    .where(
      and(
        eq(invitations.id, inviteId),
        eq(invitations.organizationId, orgId),
        eq(invitations.status, "pending"),
      ),
    )
    .returning({ id: invitations.id });
  if (canceled.length === 0) throw notFound("No such invitation.");
}

/** What the invitee sees before accepting. 404 for anyone else (see findOwnInvite). */
export async function previewInvite(
  db: Db,
  ctx: RequestContext,
  inviteId: string,
  now: Date,
): Promise<InvitePreview> {
  const { invitation, orgName } = await findOwnInvite(db, ctx, inviteId, now);
  return {
    id: invitation.id,
    orgName,
    role: parseRole(invitation.role ?? "member"),
    email: invitation.email,
    status: invitation.status,
    expiresAt: invitation.expiresAt.toISOString(),
  };
}

/**
 * Joins the workspace with the invited role, marks the invitation accepted and makes the
 * workspace the session's active one, all in one transaction. Returns the workspace id.
 */
export async function acceptInvite(
  db: Db,
  ctx: RequestContext,
  inviteId: string,
  now: Date,
): Promise<string> {
  return db.transaction(async (tx) => {
    // Locked, so accepting twice at once joins once.
    const { invitation } = await findOwnInvite(tx, ctx, inviteId, now, { lock: true });
    const orgId = invitation.organizationId;
    await tx
      .insert(memberships)
      .values({
        id: newId("mem"),
        organizationId: orgId,
        userId: ctx.user.id,
        role: parseRole(invitation.role ?? "member"),
      })
      .onConflictDoNothing(); // already a member: keep the role they have
    await tx
      .update(invitations)
      .set({ status: "accepted" })
      .where(eq(invitations.id, invitation.id));
    await setSessionOrg(tx, ctx.sessionId, orgId);
    return orgId;
  });
}

/**
 * The invitation, when it is addressed to the caller's email (any letter case), still pending,
 * not expired and for a company workspace. Otherwise 404, the same answer as for an id that
 * does not exist, so an invitation link reveals nothing to anyone else.
 */
async function findOwnInvite(
  db: Db | DbTransaction,
  ctx: RequestContext,
  inviteId: string,
  now: Date,
  options: { lock?: boolean } = {},
): Promise<{ invitation: InvitationRow; orgName: string }> {
  const query = db
    .select({ invitation: invitations, orgName: orgs.name })
    .from(invitations)
    .innerJoin(orgs, eq(invitations.organizationId, orgs.id))
    .where(
      and(
        eq(invitations.id, inviteId),
        eq(sql`lower(${invitations.email})`, ctx.user.email.toLowerCase()),
        eq(invitations.status, "pending"),
        gt(invitations.expiresAt, now),
        eq(orgs.kind, "company"),
      ),
    );
  const [found] = options.lock
    ? await query.for("update", { of: invitations })
    : await query;
  if (!found) throw notFound("No such invitation.");
  return found;
}
