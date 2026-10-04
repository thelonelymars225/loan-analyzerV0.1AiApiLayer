import { and, asc, eq, sql } from "drizzle-orm";
import type { OrgKind, OrgRole, OrgSummary } from "@rater/contracts";
import { memberships, newId, orgs, users } from "@rater/db";
import type { Db, DbTransaction } from "@rater/db";

/**
 * Workspaces ("orgs") and memberships. Better Auth owns these tables; the API writes them
 * directly with Drizzle so that the org `kind` is always set by us, never by a client.
 */

type Executor = Db | DbTransaction;

/** Highest role first. Better Auth may store several roles comma separated. */
const ROLE_ORDER: readonly OrgRole[] = ["owner", "admin", "member"];

/** The strongest role in a stored role string; unknown roles count as "member". */
export function parseRole(stored: string): OrgRole {
  const roles = stored.split(",").map((role) => role.trim());
  return ROLE_ORDER.find((role) => roles.includes(role)) ?? "member";
}

/** Every workspace the user belongs to, oldest membership first. */
export async function listUserOrgs(db: Executor, userId: string): Promise<OrgSummary[]> {
  const rows = await db
    .select({
      id: orgs.id,
      name: orgs.name,
      kind: orgs.kind,
      retentionDays: orgs.retentionDays,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(orgs, eq(memberships.organizationId, orgs.id))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(memberships.createdAt), asc(orgs.id));
  return rows.map((row) => ({ ...row, role: parseRole(row.role) }));
}

/** One workspace as the given member sees it, or null if they are not a member. */
export async function findUserOrg(
  db: Executor,
  userId: string,
  orgId: string,
): Promise<OrgSummary | null> {
  const all = await listUserOrgs(db, userId);
  return all.find((org) => org.id === orgId) ?? null;
}

/** Creates a workspace with `ownerId` as its only member (role owner). Returns its id. */
export async function insertOrgWithOwner(
  db: Executor,
  input: { name: string; kind: OrgKind; ownerId: string },
): Promise<string> {
  const id = newId("org");
  await db.insert(orgs).values({
    id,
    name: input.name,
    // Slugs must be unique; the tail of the id makes them so without a lookup.
    slug: `${slugify(input.name)}-${id.slice(-8)}`,
    kind: input.kind,
  });
  await db.insert(memberships).values({
    id: newId("mem"),
    organizationId: id,
    userId: input.ownerId,
    role: "owner",
  });
  return id;
}

/** Any fixed number; namespaces the per-user advisory lock below. */
const PERSONAL_ORG_LOCK = 4_120_771;

/**
 * Returns the user's personal workspace, creating it ("<name>'s workspace") if it does not
 * exist yet. Safe to call more than once and concurrently: a per-user advisory lock makes
 * the second caller wait and then find the first caller's org.
 */
export async function ensurePersonalOrg(db: Db, userId: string): Promise<string> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(${PERSONAL_ORG_LOCK}, hashtext(${userId}))`,
    );
    const [existing] = await tx
      .select({ id: orgs.id })
      .from(memberships)
      .innerJoin(orgs, eq(memberships.organizationId, orgs.id))
      .where(and(eq(memberships.userId, userId), eq(orgs.kind, "personal")))
      .limit(1);
    if (existing) return existing.id;

    const [user] = await tx
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, userId));
    if (!user) throw new Error(`Cannot create a personal workspace: no user ${userId}`);
    return insertOrgWithOwner(tx, {
      name: personalOrgName(user.name),
      kind: "personal",
      ownerId: userId,
    });
  });
}

export function personalOrgName(userName: string): string {
  const name = userName.trim() || "My";
  return `${name}'s workspace`;
}

/** "Example Trading Co." → "example-trading-co". Non-Latin names fall back to "workspace". */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return slug || "workspace";
}
