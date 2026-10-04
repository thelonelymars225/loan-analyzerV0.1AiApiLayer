import type { FastifyPluginAsync } from "fastify";

/** The OpenAPI document (built by @fastify/swagger from the Zod schemas). */
export const docsRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/openapi.json",
    { config: { public: true }, schema: { hide: true } },
    async () => app.swagger(),
  );
};
