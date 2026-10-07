import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { MeResponse } from "@rater/contracts";
import type { AppDeps } from "../deps";
import { deleteUserData } from "../ratings/store";

export const meRoutes: FastifyPluginAsyncZod<AppDeps> = async (app, deps) => {
  const { db, storage } = deps;

  app.get(
    "/me",
    {
      schema: {
        summary: "The signed-in user",
        response: { 200: MeResponse },
      },
    },
    async (request) => ({ user: request.ctx.user }),
  );

  app.delete(
    "/me/data",
    {
      schema: {
        summary: "Delete every rating and PDF you uploaded",
        description:
          "Removes all of the caller's ratings (with their findings), document rows and " +
          "stored PDFs. Each deleted rating is audited.",
      },
    },
    async (request, reply) => {
      await deleteUserData({ db, storage }, request.ctx);
      return reply.code(204).send();
    },
  );
};
