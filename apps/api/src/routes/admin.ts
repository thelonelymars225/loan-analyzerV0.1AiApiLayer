import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { AdminUsersResponse } from "@rater/contracts";
import { apiKeys, users } from "@rater/db";
import type { AppDeps } from "../deps";
import { forbidden, notFound } from "../errors";

const UserParams = z.object({ id: z.string().min(1).max(64) });

/**
 * The admin (ADMIN_EMAILS, signed in with a cookie) decides who may use the API: granting
 * lets a user create API keys; revoking also deletes their keys, so they stop working at once.
 */
export const adminRoutes: FastifyPluginAsyncZod<AppDeps> = async (app, deps) => {
  const { db } = deps;

  app.addHook("onRequest", async (request) => {
    if (!request.ctx.isAdmin) throw forbidden("Only an admin can manage API access.");
  });

  app.get(
    "/admin/users",
    {
      schema: {
        summary: "List users",
        description: "Every user and whether they may use the API. Admins only.",
        response: { 200: AdminUsersResponse },
      },
    },
    async () => {
      const rows = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          apiAccess: users.apiAccess,
          createdAt: users.createdAt,
        })
        .from(users)
        .orderBy(desc(users.createdAt));
      return {
        users: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
      };
    },
  );

  app.post(
    "/admin/users/:id/api-access",
    {
      schema: {
        summary: "Grant API access",
        description: "Lets the user create API keys. Admins only.",
        params: UserParams,
      },
    },
    async (request, reply) => {
      await setApiAccess(request.params.id, true);
      request.log.info({ targetUserId: request.params.id }, "api access granted");
      return reply.code(204).send();
    },
  );

  app.delete(
    "/admin/users/:id/api-access",
    {
      schema: {
        summary: "Revoke API access",
        description: "Deletes the user's API keys. Admins only.",
        params: UserParams,
      },
    },
    async (request, reply) => {
      await setApiAccess(request.params.id, false);
      request.log.info({ targetUserId: request.params.id }, "api access revoked");
      return reply.code(204).send();
    },
  );

  async function setApiAccess(userId: string, apiAccess: boolean) {
    await db.transaction(async (tx) => {
      const updated = await tx
        .update(users)
        .set({ apiAccess })
        .where(eq(users.id, userId))
        .returning({ id: users.id });
      if (updated.length === 0) throw notFound("No such user.");
      if (!apiAccess) await tx.delete(apiKeys).where(eq(apiKeys.referenceId, userId));
    });
  }
};
