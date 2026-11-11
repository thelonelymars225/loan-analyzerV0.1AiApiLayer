import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AdminUsersResponse,
  MeResponse,
  Problem,
  WageCheckResponse,
} from "@rater/contracts";
import {
  DATABASE_URL,
  ORIGIN,
  api,
  createTestContext,
  signUp,
  type TestContext,
  type TestUser,
} from "./helpers";
import { createLogger } from "../src/logger";

/**
 * API keys: a company's system calls without a browser. The key acts as the user who made
 * it, and nothing else about the API changes.
 */
describe.skipIf(!DATABASE_URL)("API keys", () => {
  let t: TestContext;
  let user: TestUser;
  let admin: TestUser;

  beforeAll(async () => {
    t = await createTestContext({ env: { ADMIN_EMAILS: " Admin@Example.com " } });
    admin = await signUp(t.app, "Admin", "admin@example.com");
    user = await signUp(t.app, "Payroll Robot");
    await api(t.app, admin.cookie, "POST", `/admin/users/${user.id}/api-access`);
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

  it("offers keys on the test page and keeps the secret out of logs", async () => {
    const page = await t.app.inject({ method: "GET", url: "/api/v1/wage-checks/test" });
    expect(page.body).toContain("/api/auth/api-key/");

    let logged = "";
    const logger = createLogger("info", { write: (line: string) => (logged += line) });
    logger.info({ req: { headers: { "x-api-key": "cr_secret" } } }, "request");
    expect(logged).toContain("[redacted]");
    expect(logged).not.toContain("cr_secret");
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

describe.skipIf(!DATABASE_URL)("API access, granted by an admin", () => {
  let t: TestContext;
  let admin: TestUser;

  beforeAll(async () => {
    t = await createTestContext({ env: { ADMIN_EMAILS: "admin@example.com" } });
    admin = await signUp(t.app, "Admin", "admin@example.com");
  });
  afterAll(async () => {
    await t?.close();
  });

  function createKey(cookie: string) {
    return t.app.inject({
      method: "POST",
      url: "/api/auth/api-key/create",
      headers: { origin: ORIGIN, "content-type": "application/json", cookie },
      payload: { name: "HRIS" },
    });
  }

  it("lets only granted users create keys, and revoking stops their keys", async () => {
    const user = await signUp(t.app, "New Customer");
    const refused = await createKey(user.cookie);
    expect(refused.statusCode).toBe(403);
    expect(Problem.parse(refused.json()).detail).toMatch(/does not have API access/);
    const me = MeResponse.parse((await api(t.app, user.cookie, "GET", "/me")).json());
    expect(me).toMatchObject({ apiAccess: false, isAdmin: false });

    const granted = await api(
      t.app,
      admin.cookie,
      "POST",
      `/admin/users/${user.id}/api-access`,
    );
    expect(granted.statusCode).toBe(204);
    const listed = AdminUsersResponse.parse(
      (await api(t.app, admin.cookie, "GET", "/admin/users")).json(),
    );
    expect(listed.users.find((u) => u.id === user.id)?.apiAccess).toBe(true);
    const { key } = (await createKey(user.cookie)).json<{ key: string }>();
    const withKey = { "x-api-key": key };
    expect((await api(t.app, "", "GET", "/me", undefined, withKey)).statusCode).toBe(200);

    const revoked = await api(
      t.app,
      admin.cookie,
      "DELETE",
      `/admin/users/${user.id}/api-access`,
    );
    expect(revoked.statusCode).toBe(204);
    expect((await api(t.app, "", "GET", "/me", undefined, withKey)).statusCode).toBe(401);
    expect((await createKey(user.cookie)).statusCode).toBe(403);
  });

  it("keeps the admin routes to admins signed in with the cookie", async () => {
    const me = MeResponse.parse((await api(t.app, admin.cookie, "GET", "/me")).json());
    expect(me.isAdmin).toBe(true);

    const user = await signUp(t.app, "Curious Customer");
    const listed = await api(t.app, user.cookie, "GET", "/admin/users");
    expect(listed.statusCode).toBe(403);
    const self = await api(
      t.app,
      user.cookie,
      "POST",
      `/admin/users/${user.id}/api-access`,
    );
    expect(self.statusCode).toBe(403);

    // The admin's own key does not carry admin rights.
    await api(t.app, admin.cookie, "POST", `/admin/users/${admin.id}/api-access`);
    const { key } = (await createKey(admin.cookie)).json<{ key: string }>();
    const viaKey = await api(t.app, "", "GET", "/admin/users", undefined, {
      "x-api-key": key,
    });
    expect(viaKey.statusCode).toBe(403);

    const missing = await api(
      t.app,
      admin.cookie,
      "POST",
      "/admin/users/nobody/api-access",
    );
    expect(missing.statusCode).toBe(404);
  });
});

describe.skipIf(!DATABASE_URL)("wage check limit", () => {
  let t: TestContext;

  beforeAll(async () => {
    t = await createTestContext({ env: { WAGE_CHECKS_PER_MINUTE: "2" } });
  });
  afterAll(async () => {
    await t?.close();
  });

  it("answers 429 with Retry-After once a user is over the per-minute limit", async () => {
    const { cookie } = await signUp(t.app, "Busy Robot");
    const check = () =>
      api(t.app, cookie, "POST", "/wage-checks/records", {
        qiwa: [{ employeeId: "1000000001", basic: 8000 }],
      });
    expect((await check()).statusCode).toBe(200);
    expect((await check()).statusCode).toBe(200);

    t.clock.now = new Date(t.clock.now.getTime() + 15_000);
    const refused = await check();
    expect(refused.statusCode).toBe(429);
    expect(refused.headers["retry-after"]).toBe("45");
    expect(Problem.parse(refused.json()).detail).toBe(
      "You can make 2 wage check requests per minute. Try again in 45 s.",
    );

    // Another account has its own allowance, and a minute later this one does again.
    const other = await signUp(t.app, "Other Robot");
    const fresh = await api(t.app, other.cookie, "POST", "/wage-checks/records", {
      qiwa: [],
    });
    expect(fresh.statusCode).toBe(200);
    t.clock.now = new Date(t.clock.now.getTime() + 45_000);
    expect((await check()).statusCode).toBe(200);
  });
});
