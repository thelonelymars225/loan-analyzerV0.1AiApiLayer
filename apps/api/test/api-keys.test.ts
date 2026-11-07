import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MeResponse, Problem, WageCheckResponse } from "@rater/contracts";
import {
  DATABASE_URL,
  ORIGIN,
  api,
  createTestContext,
  signUp,
  type TestContext,
  type TestUser,
} from "./helpers";

/**
 * API keys: a company's system calls without a browser. The key acts as the user who made
 * it, and nothing else about the API changes.
 */
describe.skipIf(!DATABASE_URL)("API keys", () => {
  let t: TestContext;
  let user: TestUser;

  beforeAll(async () => {
    t = await createTestContext();
    user = await signUp(t.app, "Payroll Robot");
  });
  afterAll(async () => {
    await t?.close();
  });

  /** The Better Auth API key endpoints, called the way a browser (with the cookie) would. */
  function authApi(cookie: string, path: string, payload: object = {}) {
    return t.app.inject({
      method: "POST",
      url: `/api/auth/api-key/${path}`,
      headers: { origin: ORIGIN, "content-type": "application/json", cookie },
      payload,
    });
  }

  it("lets a signed-in user create a key that then acts as them", async () => {
    const created = await authApi(user.cookie, "create", { name: "SAP payroll job" });
    expect(created.statusCode).toBe(200);
    const { id, key, start } = created.json<{ id: string; key: string; start: string }>();
    expect(key).toMatch(/^cr_[A-Za-z]{64}$/);
    expect(key.startsWith(start)).toBe(true);

    const me = await t.app.inject({
      method: "GET",
      url: "/api/v1/me",
      headers: { "x-api-key": key },
    });
    expect(me.statusCode).toBe(200);
    expect(MeResponse.parse(me.json()).user.id).toBe(user.id);

    // The key is listed without its secret, and can be revoked.
    const listed = await t.app.inject({
      method: "GET",
      url: "/api/auth/api-key/list",
      headers: { origin: ORIGIN, cookie: user.cookie },
    });
    const { apiKeys } = listed.json<{
      apiKeys: { id: string; name: string; key?: string }[];
    }>();
    expect(apiKeys.map((k) => [k.id, k.name, k.key])).toEqual([
      [id, "SAP payroll job", undefined],
    ]);

    const revoked = await authApi(user.cookie, "delete", { keyId: id });
    expect(revoked.statusCode).toBe(200);
    const after = await t.app.inject({
      method: "GET",
      url: "/api/v1/me",
      headers: { "x-api-key": key },
    });
    expect(after.statusCode).toBe(401);
    expect(Problem.parse(after.json()).detail).toMatch(/^The API key is not valid/);
  });

  it("runs a wage check with a key, as an HRIS would", async () => {
    const created = await authApi(user.cookie, "create", { name: "HRIS" });
    const { key } = created.json<{ key: string }>();
    const record = {
      employeeId: "1000000001",
      basic: 8000,
      housing: 2000,
      transport: 800,
      total: 10800,
    };
    const check = await t.app.inject({
      method: "POST",
      url: "/api/v1/wage-checks/records",
      headers: { "x-api-key": key, "content-type": "application/json" },
      payload: { qiwa: [record], payroll: [{ ...record, basic: 7500 }] },
    });
    expect(check.statusCode).toBe(200);
    expect(WageCheckResponse.parse(check.json()).summary).toEqual({
      employees: 1,
      flagged: 1,
    });
  });

  it("refuses a made-up key, and a key cannot create more keys", async () => {
    const bogus = `cr_${"x".repeat(64)}`;
    const me = await t.app.inject({
      method: "GET",
      url: "/api/v1/me",
      headers: { "x-api-key": bogus },
    });
    expect(me.statusCode).toBe(401);

    const { key } = (await authApi(user.cookie, "create", { name: "HRIS" })).json<{
      key: string;
    }>();
    const minted = await t.app.inject({
      method: "POST",
      url: "/api/auth/api-key/create",
      headers: { origin: ORIGIN, "content-type": "application/json", "x-api-key": key },
      payload: { name: "another" },
    });
    expect(minted.statusCode).toBe(401);
    expect(Problem.parse(minted.json()).detail).toMatch(
      /^Sign in with the session cookie/,
    );

    // Without a session at all, as before.
    const anonymous = await api(t.app, "", "GET", "/me");
    expect(anonymous.statusCode).toBe(401);
  });
});
