import { eq } from "drizzle-orm";
import { fromNodeHeaders } from "better-auth/node";
import { isAPIError } from "better-auth/api";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  CreateOrgBody,
  InviteBody,
  InviteResponse,
  ListInvitesResponse,
  ListMembersResponse,
  MemberResponse,
  OrgSummary,
  UpdateMemberBody,
  UpdateOrgBody,
} from "@rater/contracts";
import { orgs } from "@rater/db";
import type { AppDeps } from "../deps";
import { conflict, notFound } from "../errors";
import { cancelInvite, listPendingInvites, toInviteResponse } from "../invites";
import { changeMemberRole, listMembers, removeMember } from "../members";
import { findUserOrg, insertOrgWithOwner } from "../orgs";
import { requireActiveOrg, requireRole } from "../plugins/access";

const OrgParams = z.object({ id: z.string().min(1).max(64) });
const MemberParams = OrgParams.extend({ userId: z.string().min(1).max(64) });
const InviteParams = OrgParams.extend({ inviteId: z.string().min(1).max(64) });

/** Better Auth answers these with 400; for the API they are conflicts with existing state. */
const ALREADY_THERE = new Set([
  "USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION",
  "USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION",
]);

/**
 * Workspaces. Org routes act on the session's active org: `{id}` must be that org.
 * Switching the active org is PUT /me/active-org.
 */
export const orgRoutes: FastifyPluginAsyncZod<AppDeps> = async (app, deps) => {
  const { db, auth, now } = deps;

  app.post(
    "/orgs",
    {
      schema: {
        summary: "Create a company workspace (the caller becomes its owner)",
        body: CreateOrgBody,
        response: { 201: OrgSummary },
      },
    },
    async (request, reply) => {
      const { ctx } = request;
      const id = await db.transaction((tx) =>
        insertOrgWithOwner(tx, {
          name: request.body.name,
          kind: "company",
          ownerId: ctx.user.id,
        }),
      );
      return reply.code(201).send(await loadOrgSummary(ctx.user.id, id));
    },
  );

  app.patch(
    "/orgs/:id",
    {
      schema: {
        summary: "Change workspace settings (owner)",
        description:
          "A new retentionDays applies to PDFs uploaded from now on; files already stored " +
          "keep the deletion date they were given at upload.",
        params: OrgParams,
        body: UpdateOrgBody,
        response: { 200: OrgSummary },
      },
    },
    async (request) => {
      const { ctx } = request;
      requireActiveOrg(ctx, request.params.id);
      requireRole(ctx, "owner");
      const { name, retentionDays } = request.body;
      if (name !== undefined || retentionDays !== undefined) {
        await db.update(orgs).set({ name, retentionDays }).where(eq(orgs.id, ctx.orgId));
      }
      return loadOrgSummary(ctx.user.id, ctx.orgId);
    },
  );

  app.get(
    "/orgs/:id/members",
    {
      schema: {
        summary: "List the workspace's members",
        params: OrgParams,
        response: { 200: ListMembersResponse },
      },
    },
    async (request) => {
      requireActiveOrg(request.ctx, request.params.id);
      return { items: await listMembers(db, request.ctx.orgId) };
    },
  );

  app.get(
    "/orgs/:id/invites",
    {
      schema: {
        summary: "List the workspace's pending invitations (owner or admin)",
        params: OrgParams,
        response: { 200: ListInvitesResponse },
      },
    },
    async (request) => {
      const { ctx } = request;
      requireActiveOrg(ctx, request.params.id);
      requireRole(ctx, "owner", "admin");
      return { items: await listPendingInvites(db, ctx.orgId, now()) };
    },
  );

  app.post(
    "/orgs/:id/invites",
    {
      schema: {
        summary: "Invite someone by email (owner or admin, company workspaces only)",
        description:
          "No email is sent in v1: share `acceptPath` (a page of the web app) with the " +
          "invitee. They sign in or sign up with the invited address and accept there " +
          "(GET /invites/{id}, POST /invites/{id}/accept).",
        params: OrgParams,
        body: InviteBody,
        response: { 201: InviteResponse },
      },
    },
    async (request, reply) => {
      const { ctx } = request;
      requireActiveOrg(ctx, request.params.id);
      requireRole(ctx, "owner", "admin");
      const org = await loadOrgSummary(ctx.user.id, ctx.orgId);
      if (org.kind !== "company") {
        throw conflict(
          "Personal workspaces have one member. Create a company workspace.",
        );
      }

      try {
        const invitation = await auth.api.createInvitation({
          headers: fromNodeHeaders(request.headers),
          body: {
            email: request.body.email,
            role: request.body.role,
            organizationId: ctx.orgId,
          },
        });
        return reply.code(201).send(toInviteResponse(invitation));
      } catch (error) {
        if (isAPIError(error) && ALREADY_THERE.has(error.body?.code ?? "")) {
          throw conflict(error.body?.message ?? "Already a member or invited.");
        }
        throw error;
      }
    },
  );

  app.delete(
    "/orgs/:id/invites/:inviteId",
    {
      schema: {
        summary: "Cancel a pending invitation (owner or admin)",
        params: InviteParams,
      },
    },
    async (request, reply) => {
      const { ctx } = request;
      requireActiveOrg(ctx, request.params.id);
      requireRole(ctx, "owner", "admin");
      await cancelInvite(db, ctx.orgId, request.params.inviteId);
      return reply.code(204).send();
    },
  );

  app.patch(
    "/orgs/:id/members/:userId",
    {
      schema: {
        summary: "Change a member's role (owner or admin)",
        params: MemberParams,
        body: UpdateMemberBody,
        response: { 200: MemberResponse },
      },
    },
    async (request) => {
      const { ctx } = request;
      requireActiveOrg(ctx, request.params.id);
      requireRole(ctx, "owner", "admin");
      return changeMemberRole(db, ctx, request.params.userId, request.body.role);
    },
  );

  app.delete(
    "/orgs/:id/members/:userId",
    {
      schema: {
        summary: "Remove a member (owner or admin)",
        params: MemberParams,
      },
    },
    async (request, reply) => {
      const { ctx } = request;
      requireActiveOrg(ctx, request.params.id);
      requireRole(ctx, "owner", "admin");
      await removeMember(db, ctx, request.params.userId);
      return reply.code(204).send();
    },
  );

  async function loadOrgSummary(userId: string, orgId: string): Promise<OrgSummary> {
    const org = await findUserOrg(db, userId, orgId);
    if (!org) throw notFound("No such workspace.");
    return org;
  }
};
