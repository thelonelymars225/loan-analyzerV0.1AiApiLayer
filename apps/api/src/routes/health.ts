import { sql } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { HealthResponse } from "@rater/contracts";
import type { AppDeps } from "../deps";

/** A check that hangs counts as failed after this long. */
const CHECK_TIMEOUT_MS = 2_000;

export const healthRoutes: FastifyPluginAsyncZod<AppDeps> = async (app, deps) => {
  app.get(
    "/healthz",
    {
      config: { public: true },
      // Probes hit this every few seconds; their request logs would drown everything else.
      logLevel: "warn",
      schema: {
        response: { 200: HealthResponse, 503: HealthResponse },
      },
    },
    async (_request, reply) => {
      const [db, queue] = await Promise.all([
        passes(async () => {
          await deps.db.execute(sql`select 1`);
          return true;
        }),
        passes(() => deps.queue.healthy()),
      ]);
      const ok = db && queue;
      return reply.code(ok ? 200 : 503).send({ ok, db, queue });
    },
  );
};

/** Runs a check; false when it throws, returns false or takes longer than the timeout. */
async function passes(check: () => Promise<boolean>): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), CHECK_TIMEOUT_MS);
  });
  try {
    return await Promise.race([check().catch(() => false), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
