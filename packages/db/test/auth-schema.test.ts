import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { authTables } from "../src/auth-schema";

/**
 * The fields better-auth 1.7.7 reads and writes (core, no plugins).
 * If a Better Auth upgrade adds fields, update this list and the tables together.
 */
const BETTER_AUTH_FIELDS = {
  // apiAccess is ours, declared to Better Auth as an additional field.
  user: [
    "id",
    "name",
    "email",
    "emailVerified",
    "image",
    "createdAt",
    "updatedAt",
    "apiAccess",
  ],
  session: [
    "id",
    "expiresAt",
    "token",
    "createdAt",
    "updatedAt",
    "ipAddress",
    "userAgent",
    "userId",
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
  // @better-auth/api-key 1.7.7
  apikey: [
    "id",
    "configId",
    "name",
    "start",
    "prefix",
    "key",
    "referenceId",
    "refillInterval",
    "refillAmount",
    "lastRefillAt",
    "enabled",
    "rateLimitEnabled",
    "rateLimitTimeWindow",
    "rateLimitMax",
    "requestCount",
    "remaining",
    "lastRequest",
    "expiresAt",
    "createdAt",
    "updatedAt",
    "permissions",
    "metadata",
  ],
} as const;

const SQL_TABLE_NAMES = {
  user: "users",
  session: "sessions",
  account: "accounts",
  verification: "verifications",
  apikey: "api_keys",
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
});
