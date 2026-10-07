import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { InvitePreview, MeResponse } from "@rater/contracts";
import type { AppDeps } from "../deps";
import { acceptInvite, previewInvite } from "../invites";
import { loadMe } from "./me";

const InviteParams = z.object({ id: z.string().min(1).max(64) });

/**
 * The invitee's side of an invitation (the link from acceptPath). Both routes answer 404
 * unless the signed-in user's email is the invited one and the invitation is still open.
 */
export const inviteRoutes: FastifyPluginAsyncZod<AppDeps> = async (app, deps) => {
  const { db, now } = deps;

  app.get(
    "/invites/:id",
    {
      schema: {
        params: InviteParams,
        response: { 200: InvitePreview },
      },
    },
    async (request) => previewInvite(db, request.ctx, request.params.id, now()),
  );

  app.post(
    "/invites/:id/accept",
    {
      // Joining switches the workspace, so the tab's x-org-id is expected to differ.
      config: { ignoresOrgHeader: true },
      schema: {
        params: InviteParams,
        response: { 200: MeResponse },
      },
    },
    async (request) => {
      const { ctx } = request;
      const orgId = await acceptInvite(db, ctx, request.params.id, now());
      return loadMe(db, ctx, orgId);
    },
  );
};
