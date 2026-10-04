import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { MeResponse } from "@rater/contracts";
import type { AppDeps } from "../deps";
import { listUserOrgs } from "../orgs";

export const meRoutes: FastifyPluginAsyncZod<AppDeps> = async (app, deps) => {
  app.get(
    "/me",
    {
      schema: {
        summary: "The signed-in user, their workspaces and roles",
        response: { 200: MeResponse },
      },
    },
    async (request) => {
      const { ctx } = request;
      return {
        user: ctx.user,
        activeOrgId: ctx.orgId,
        orgs: await listUserOrgs(deps.db, ctx.user.id),
      };
    },
  );
};
