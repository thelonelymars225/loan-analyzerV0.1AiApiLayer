import { and, asc, eq } from "drizzle-orm";
import type { MemberResponse, OrgRole } from "@rater/contracts";
import { memberships, orgs, users } from "@rater/db";
import type { Db, DbTransaction } from "@rater/db";
import { conflict, notFound } from "./errors";
import { parseRole } from "./orgs";
import { requireCanManageMember } from "./plugins/access";
import type { RequestContext } from "./plugins/session";

/*
 * Member management for the active org. Callers have already checked that the actor is an
 * owner or admin (requireRole); who may change whom is checked by requireCanManageMember.
 * Here: the last owner can be neither demoted nor removed (409 conflict).
 */

export async function listMembers(db: Db, orgId: string): Promise<MemberResponse[]> {
  const rows = await db
    .select({
      userId: users.id,
      email: users.email,
      name: users.name,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(eq(memberships.organizationId, orgId))
    .orderBy(asc(memberships.createdAt), asc(users.id));
  return rows.map((row) => ({ ...row, role: parseRole(row.role) }));
}

export async function changeMemberRole(
  db: Db,
  actor: RequestContext,
  targetUserId: string,
  role: OrgRole,
): Promise<MemberResponse> {
  await db.transaction(async (tx) => {
    const members = await lockMembers(tx, actor.orgId);
    const target = findMember(members, targetUserId);
    requireCanManageMember(actor, target.role, role);
    if (target.role === "owner" && role !== "owner") {
      requireAnotherOwner(members, "demote");
    }
    await tx
      .update(memberships)
      .set({ role })
      .where(
        and(
          eq(memberships.organizationId, actor.orgId),
          eq(memberships.userId, targetUserId),
        ),
      );
  });
  const member = (await listMembers(db, actor.orgId)).find(
    (m) => m.userId === targetUserId,
  );
  if (!member) throw notFound("No such member.");
  return member;
}

export async function removeMember(
  db: Db,
  actor: RequestContext,
  targetUserId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const members = await lockMembers(tx, actor.orgId);
    const target = findMember(members, targetUserId);
    requireCanManageMember(actor, target.role, null);
    if (target.role === "owner") requireAnotherOwner(members, "remove");
    await tx
      .delete(memberships)
      .where(
        and(
          eq(memberships.organizationId, actor.orgId),
          eq(memberships.userId, targetUserId),
        ),
      );
  });
}

interface LockedMember {
  userId: string;
  role: OrgRole;
}

/**
 * Reads the org's members after locking the org row, so two concurrent changes (say, two
 * owners demoting each other) run one after the other and cannot leave the org ownerless.
 */
async function lockMembers(tx: DbTransaction, orgId: string): Promise<LockedMember[]> {
  await tx.select({ id: orgs.id }).from(orgs).where(eq(orgs.id, orgId)).for("update");
  const rows = await tx
    .select({ userId: memberships.userId, role: memberships.role })
    .from(memberships)
    .where(eq(memberships.organizationId, orgId));
  return rows.map((row) => ({ userId: row.userId, role: parseRole(row.role) }));
}

function findMember(members: LockedMember[], userId: string): LockedMember {
  const member = members.find((m) => m.userId === userId);
  if (!member) throw notFound("No such member.");
  return member;
}

function requireAnotherOwner(members: LockedMember[], action: "demote" | "remove") {
  const owners = members.filter((m) => m.role === "owner").length;
  if (owners <= 1) {
    throw conflict(`Cannot ${action} the last owner. Make someone else an owner first.`);
  }
}
