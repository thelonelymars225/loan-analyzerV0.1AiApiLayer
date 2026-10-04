import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MeResponse, Problem } from "@rater/contracts";
import { sessions } from "@rater/db";
import {
  DATABASE_URL,
  api,
  createTestContext,
  signIn,
  signUp,
  type TestContext,
} from "./helpers";

describe.skipIf(!DATABASE_URL)("sign-up, sessions and /me", () => {
  let t: TestContext;

  beforeAll(async () => {
    t = await createTestContext();
  });
  afterAll(async () => {
    await t?.close();
  });

  it("gives a new user a personal workspace and makes it the session's active org", async () => {
    const user = await signUp(t.app, "Nour Al-Harbi");
    expect(user.cookie).toContain("better-auth.session_token=");

    const response = await api(t.app, user.cookie, "GET", "/me");
    expect(response.statusCode).toBe(200);
    const me = MeResponse.parse(response.json());
    expect(me.user).toEqual({ id: user.id, email: user.email, name: "Nour Al-Harbi" });
    expect(me.orgs).toEqual([
      {
        id: me.activeOrgId,
        name: "Nour Al-Harbi's workspace",
        kind: "personal",
        role: "owner",
        retentionDays: 30,
      },
    ]);

    const rows = await t.db.select().from(sessions);
    const session = rows.find((row) => row.userId === user.id);
    expect(session?.activeOrganizationId).toBe(me.activeOrgId);
  });

  it("starts later sessions in the same personal workspace and creates no second one", async () => {
    const user = await signUp(t.app, "Faisal Al-Qahtani");
    const first = MeResponse.parse((await api(t.app, user.cookie, "GET", "/me")).json());

    const cookie = await signIn(t.app, user.email);
    const second = MeResponse.parse((await api(t.app, cookie, "GET", "/me")).json());
    expect(second.activeOrgId).toBe(first.activeOrgId);
    expect(second.orgs).toHaveLength(1);
  });

  it("answers 401 problem+json without a session", async () => {
    const response = await t.app.inject({ method: "GET", url: "/api/v1/me" });
    expect(response.statusCode).toBe(401);
    expect(response.headers["content-type"]).toMatch(/^application\/problem\+json/);
    expect(Problem.parse(response.json())).toMatchObject({
      status: 401,
      code: "unauthorized",
    });
  });

  it("answers 401 for a forged session cookie", async () => {
    const response = await api(
      t.app,
      "better-auth.session_token=forged.value",
      "GET",
      "/me",
    );
    expect(response.statusCode).toBe(401);
  });
});
