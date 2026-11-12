import { readFileSync } from "node:fs";
import fastifySwagger from "@fastify/swagger";
import scalarApiReference from "@scalar/fastify-api-reference";
import type { FastifyInstance } from "fastify";
import { jsonSchemaTransform } from "fastify-type-provider-zod";
import { API_KEY_HEADER } from "../auth";

/** The guides above the reference (Getting started, Authentication, ...): Markdown. */
const GUIDE = readFileSync(new URL("./docs-guide.md", import.meta.url), "utf8");
/** The web app's colours, applied to the reference. */
const THEME = readFileSync(new URL("./docs-theme.css", import.meta.url), "utf8");

/** Sidebar groups, in order. Each route joins the group of its first path segment. */
const TAGS = [
  {
    name: "Ratings",
    description: "Upload a contract, follow its status, read the report.",
    segments: ["ratings"],
  },
  {
    name: "Wage checks",
    description: "Compare contracts, offer letters and payroll. Nothing is stored.",
    segments: ["wage-checks"],
  },
  {
    name: "Account",
    description: "The signed-in user and their data.",
    segments: ["me"],
  },
  { name: "Admin", description: "Grant and revoke API access.", segments: ["admin"] },
  {
    name: "Reference",
    description: "The rules table and the health check.",
    segments: ["rules", "healthz"],
  },
];

/**
 * OpenAPI generated from the routes' Zod schemas. Register before the routes so the spec
 * sees them. The spec is served at /api/v1/openapi.json (routes/docs.ts) and the
 * API reference (Scalar) at /api/docs.
 */
export async function registerDocs(app: FastifyInstance): Promise<void> {
  await app.register(fastifySwagger, {
    openapi: {
      openapi: "3.1.0",
      info: { title: "Contract Rater API", version: "0.1.0", description: GUIDE },
      components: {
        securitySchemes: {
          apiKey: { type: "apiKey", in: "header", name: API_KEY_HEADER },
          session: { type: "apiKey", in: "cookie", name: "better-auth.session_token" },
        },
      },
      security: [{ apiKey: [] }, { session: [] }],
      tags: TAGS.map(({ name, description }) => ({ name, description })),
    },
    transform: (input) => {
      const out = jsonSchemaTransform(input);
      const segment = input.url.split("/")[3] ?? ""; // /api/v1/<segment>/...
      const tag = TAGS.find((t) => t.segments.includes(segment));
      return tag ? { ...out, schema: { tags: [tag.name], ...out.schema } } : out;
    },
  });
  await app.register(scalarApiReference, {
    routePrefix: "/api/docs",
    configuration: {
      pageTitle: "Contract Rater API",
      hideModels: true,
      documentDownloadType: "none",
      showDeveloperTools: "never",
      agent: { disabled: true },
      customCss: THEME,
    },
  });
}
