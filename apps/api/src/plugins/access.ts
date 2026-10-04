import type { OrgRole } from "@rater/contracts";
import { forbidden, notFound } from "../errors";
import type { RequestContext } from "./session";

/*
 * Role checks live here and nowhere else (architecture doc: "Role checks sit in one
 * middleware"). Roles inside an org:
 *   owner:  members, retention settings, all ratings
 *   admin:  members, all ratings
 *   member: own uploads only (rating sharing is not built yet)
 */

/** Throws 403 unless the caller has one of `roles` in the active org. */
export function requireRole(ctx: RequestContext, ...roles: OrgRole[]): void {
  if (!roles.includes(ctx.role)) {
    throw forbidden(`This needs the ${roles.join(" or ")} role in this workspace.`);
  }
}

/**
 * Owners manage everyone. Admins manage admins and members, but cannot change or remove an
 * owner or make anyone an owner. `newRole` is null for a removal.
 */
export function requireCanManageMember(
  ctx: RequestContext,
  targetRole: OrgRole,
  newRole: OrgRole | null,
): void {
  if (ctx.role === "owner") return;
  if (targetRole === "owner")
    throw forbidden("Only an owner can change or remove an owner.");
  if (newRole === "owner") throw forbidden("Only an owner can make someone an owner.");
}

/** Owners and admins see (and may delete) every rating in the org; members only their own. */
export function seesAllRatings(ctx: RequestContext): boolean {
  return ctx.role === "owner" || ctx.role === "admin";
}

/**
 * Org routes act on the session's active org only; `{id}` must name it. Any other org is
 * answered with 404 so ids of other workspaces are not confirmed.
 */
export function requireActiveOrg(ctx: RequestContext, orgId: string): void {
  if (orgId !== ctx.orgId) throw notFound("No such workspace.");
}
