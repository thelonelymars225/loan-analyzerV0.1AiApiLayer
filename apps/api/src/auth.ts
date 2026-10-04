import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { DEFAULT_RETENTION_DAYS } from "@rater/contracts";
import { authTables } from "@rater/db";
import type { Db } from "@rater/db";
import { trustedOrigins, type Config } from "./config";
import { ensurePersonalOrg } from "./orgs";

/** Better Auth's routes are served by the API under this path (see plugins/auth-routes.ts). */
export const AUTH_BASE_PATH = "/api/auth";

/**
 * Accounts, sessions and orgs (Better Auth, self-hosted, in our own Postgres).
 *
 * - Email + password sign-up. Every new user gets a personal workspace (an org of one,
 *   kind "personal") and every new session starts in it, so the API always has an org.
 * - Company workspaces are created by POST /api/v1/orgs (which sets kind "company"), not by
 *   Better Auth's own create endpoint, and org deletion is off: `kind` and `retentionDays`
 *   are ours to set, so they are not accepted as input on Better Auth's endpoints either.
 * - Over HTTP only sign-up, sign-in, sign-out and the session are reachable (see the
 *   allow-list in plugins/auth-routes.ts). Every workspace operation (switching, invites,
 *   members) goes through /api/v1, which applies our role rules; the organization plugin is
 *   only called from the server.
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
    plugins: [
      organization({
        allowUserToCreateOrganization: false,
        disableOrganizationDeletion: true,
        schema: {
          organization: {
            additionalFields: {
              kind: {
                type: "string",
                required: false,
                defaultValue: "personal",
                input: false,
              },
              retentionDays: {
                type: "number",
                required: false,
                defaultValue: DEFAULT_RETENTION_DAYS,
                input: false,
              },
            },
          },
        },
      }),
    ],
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await ensurePersonalOrg(db, user.id);
          },
        },
      },
      session: {
        create: {
          // Sign-up creates the session before the user hook above runs (Better Auth defers
          // "after" hooks to the end of the sign-up), so this hook creates the personal
          // workspace itself when needed. ensurePersonalOrg is idempotent.
          before: async (session) => {
            if (session.activeOrganizationId) return;
            const orgId = await ensurePersonalOrg(db, session.userId);
            return { data: { ...session, activeOrganizationId: orgId } };
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
