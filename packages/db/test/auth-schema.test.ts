import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { authTables } from "../src/auth-schema";

/**
 * The fields better-auth 1.7.7 reads and writes (core + organization plugin, without
 * teams), plus our organization additionalFields `kind` and `retentionDays`.
 * If a Better Auth upgrade adds fields, update this list and the tables together.
 */
const BETTER_AUTH_FIELDS = {
  user: ["id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt"],
  session: [
    "id",
    "expiresAt",
    "token",
    "createdAt",
    "updatedAt",
    "ipAddress",
    "userAgent",
    "userId",
    "activeOrganizationId",
  ],
  account: [
    "id",
    "accountId",
    "providerId",
    "userId",
    "accessToken",
    "refreshToken",
    "idToken",
    "accessTokenExpiresAt",
    "refreshTokenExpiresAt",
    "scope",
    "password",
    "createdAt",
    "updatedAt",
  ],
  verification: ["id", "identifier", "value", "expiresAt", "createdAt", "updatedAt"],
  organization: [
    "id",
    "name",
    "slug",
    "logo",
    "createdAt",
    "metadata",
    "kind",
    "retentionDays",
  ],
  member: ["id", "organizationId", "userId", "role", "createdAt"],
  invitation: [
    "id",
    "organizationId",
    "email",
    "role",
    "status",
    "expiresAt",
    "createdAt",
    "inviterId",
  ],
} as const;

const SQL_TABLE_NAMES = {
  user: "users",
  session: "sessions",
  account: "accounts",
  verification: "verifications",
  organization: "orgs",
  member: "memberships",
  invitation: "invitations",
};

const models = Object.keys(BETTER_AUTH_FIELDS) as (keyof typeof BETTER_AUTH_FIELDS)[];

describe("authTables", () => {
  it("has one table per Better Auth model", () => {
    expect(Object.keys(authTables).sort()).toEqual([...models].sort());
  });

  it.each(models)("%s uses the agreed SQL table name", (model) => {
    expect(getTableName(authTables[model])).toBe(SQL_TABLE_NAMES[model]);
  });

  it.each(models)("%s has exactly the Better Auth fields as properties", (model) => {
    const columns = Object.keys(getTableColumns(authTables[model]));
    expect(columns.sort()).toEqual([...BETTER_AUTH_FIELDS[model]].sort());
  });

  it("gives organizations a kind and retention period by default", () => {
    const { kind, retentionDays } = getTableColumns(authTables.organization);
    expect(kind.name).toBe("kind");
    expect(kind.default).toBe("personal");
    expect(kind.notNull).toBe(true);
    expect(retentionDays.name).toBe("retention_days");
    expect(retentionDays.default).toBe(30);
    expect(retentionDays.notNull).toBe(true);
  });
});
