import { defineConfig } from "drizzle-kit";

/**
 * `pnpm --filter @rater/db generate` writes SQL migrations to ./migrations.
 * They are applied by src/migrate.ts (`pnpm db:migrate`), not by drizzle-kit.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/rater",
  },
  strict: true,
  verbose: true,
});
