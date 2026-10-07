import { sql } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { HealthResponse } from "@rater/contracts";
import type { AppDeps } from "../deps";

export const healthRoutes: FastifyPluginAsyncZod<AppDeps> = async (app, deps) => {
  app.get(
    "/healthz",
    {
      config: { public: true },
      // Probes hit this every few seconds; their request logs would drown everything else.
      logLevel: "warn",
      schema: {
        summary: "Liveness, database and queue check (503 when one fails)",
        security: [],
        response: { 200: HealthResponse, 503: HealthResponse },
      },
    },
    async (_request, reply) => {
      // A hanging check is left to the prober's own timeout (Compose: 5 s).
      const db = await deps.db.execute(sql`select 1`).then(
        () => true,
        () => false,
      );
      const queue = await deps.queue.healthy();
      const ok = db && queue;
      return reply.code(ok ? 200 : 503).send({ ok, db, queue });
    },
  );
};
