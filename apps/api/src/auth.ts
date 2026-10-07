import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { authTables } from "@rater/db";
import type { Db } from "@rater/db";
import { trustedOrigins, type Config } from "./config";

/** Better Auth's routes are served by the API under this path (see plugins/auth-routes.ts). */
export const AUTH_BASE_PATH = "/api/auth";

/**
 * Accounts and sessions (Better Auth, self-hosted, in our own Postgres).
 *
 * - Email + password sign-up. Each user sees and manages only their own ratings.
 * - Over HTTP only sign-up, sign-in, sign-out and the session are reachable (see the
 *   allow-list in plugins/auth-routes.ts).
 */
export function createAuth(options: { config: Config; db: Db }) {
  const { config, db } = options;
  return betterAuth({
    appName: "Contract Rater",
    baseURL: config.BETTER_AUTH_URL,
    basePath: AUTH_BASE_PATH,
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: trustedOrigins(config),
    database: drizzleAdapter(db, { provider: "pg", schema: authTables }),
    emailAndPassword: { enabled: true },
    telemetry: { enabled: false },
  });
}

export type Auth = ReturnType<typeof createAuth>;
