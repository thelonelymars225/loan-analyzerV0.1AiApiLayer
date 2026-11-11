import { apiKey } from "@better-auth/api-key";
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
 * - API keys, for a company's system calling without a browser: a signed-in user with API
 *   access (granted by an admin, see routes/admin.ts) creates one (shown once, stored hashed)
 *   and the system sends it in the x-api-key header. The key acts as that user: getSession
 *   answers with them, so every route works unchanged.
 * - Over HTTP only sign-up, sign-in, sign-out, the session and the API key endpoints are
 *   reachable (see the allow-list in plugins/auth-routes.ts).
 */
export const API_KEY_HEADER = "x-api-key";
/** Keys start with this, so one is recognisable in a log or a config file. */
export const API_KEY_PREFIX = "cr_";

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
    // input: false, so sign-up cannot grant it; only the admin routes write it.
    user: {
      additionalFields: {
        apiAccess: {
          type: "boolean",
          required: false,
          defaultValue: false,
          input: false,
        },
      },
    },
    plugins: [
      apiKey({
        apiKeyHeaders: API_KEY_HEADER,
        defaultPrefix: API_KEY_PREFIX,
        enableSessionForAPIKeys: true,
        requireName: true,
        // The plugin's own per-key cap defaults to 10 calls a day, far below a payroll run.
        rateLimit: { enabled: false },
      }),
    ],
    telemetry: { enabled: false },
  });
}

export type Auth = ReturnType<typeof createAuth>;
