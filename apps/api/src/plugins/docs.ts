import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import type { FastifyInstance } from "fastify";
import { jsonSchemaTransform } from "fastify-type-provider-zod";

/**
 * OpenAPI generated from the routes' Zod schemas. Register before the routes so the spec
 * sees them. The spec is served at /api/v1/openapi.json (routes/docs.ts) and the
 * Swagger UI at /api/docs.
 */
export async function registerDocs(app: FastifyInstance): Promise<void> {
  await app.register(fastifySwagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "Contract Rater API",
        version: "0.1.0",
        description:
          "Rates Saudi Qiwa employment contracts. Rating aid, not legal advice. " +
          "Sign in through Better Auth at /api/auth; the session cookie authenticates " +
          "every other call. Errors are application/problem+json with a stable `code`.",
      },
      components: {
        securitySchemes: {
          session: { type: "apiKey", in: "cookie", name: "better-auth.session_token" },
        },
      },
      security: [{ session: [] }],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(fastifySwaggerUi, { routePrefix: "/api/docs" });
}
