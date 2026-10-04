import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { MeResponse, SetActiveOrgBody } from "@rater/contracts";
import type { Db } from "@rater/db";
import type { AppDeps } from "../deps";
import { notFound } from "../errors";
import { ensurePersonalOrg, findUserOrg, listUserOrgs, setSessionOrg } from "../orgs";
import type { RequestContext } from "../plugins/session";
import { deleteWorkspaceData } from "../ratings/store";

/** The signed-in user with their workspaces; `activeOrgId` is the session's active one. */
export async function loadMe(
  db: Db,
  ctx: RequestContext,
  activeOrgId: string,
): Promise<MeResponse> {
  return {
    user: ctx.user,
    activeOrgId,
    orgs: await listUserOrgs(db, ctx.user.id),
  };
}

export const meRoutes: FastifyPluginAsyncZod<AppDeps> = async (app, deps) => {
  const { db, storage } = deps;

  app.get(
    "/me",
    {
      schema: {
        summary: "The signed-in user, their workspaces and roles",
        response: { 200: MeResponse },
      },
    },
    async (request) => loadMe(db, request.ctx, request.ctx.orgId),
  );

  app.put(
    "/me/active-org",
    {
      // Switching is the one change whose x-org-id is expected to differ.
      config: { ignoresOrgHeader: true },
      schema: {
        summary: "Switch the session's active workspace (404 unless a member)",
        description:
          "The active workspace is stored in the session, so it changes in every tab.",
        body: SetActiveOrgBody,
        response: { 200: MeResponse },
      },
    },
    async (request) => {
      const { ctx } = request;
      const org = await findUserOrg(db, ctx.user.id, request.body.orgId);
      if (!org) throw notFound("No such workspace.");
      await setSessionOrg(db, ctx.sessionId, org.id);
      return loadMe(db, ctx, org.id);
    },
  );

  app.delete(
    "/me/data",
    {
      // Always the caller's personal workspace, whichever one the session has active.
      config: { ignoresOrgHeader: true },
      schema: {
        summary: "Delete every rating and PDF in your personal workspace",
        description:
          "Removes all ratings (with their findings), document rows and stored PDFs of the " +
          "caller's personal workspace, whatever the active workspace is. Company " +
          "workspaces are not touched. Each deleted rating is audited.",
      },
    },
    async (request, reply) => {
      const { ctx } = request;
      const personalOrgId = await ensurePersonalOrg(db, ctx.user.id);
      await deleteWorkspaceData({ db, storage }, ctx, personalOrgId);
      return reply.code(204).send();
    },
  );
};
