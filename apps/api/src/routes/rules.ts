import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { RulesResponse } from "@rater/contracts";
import { loadRules } from "@rater/law";

/** The rules table is public, read-only reference data (no customer data). */
export const ruleRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/rules",
    {
      config: { public: true },
      schema: {
        summary: "The current rules table with its ruleset and law versions",
        security: [],
        response: { 200: RulesResponse },
      },
    },
    async () => loadRules(),
  );
};
