import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MeResponse, Problem } from "@rater/contracts";
import {
  DATABASE_URL,
  ORIGIN,
  api,
  createTestContext,
  sessionCookie,
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

  it("signs a new user up and answers /me with them", async () => {
    const user = await signUp(t.app, "Nour Al-Harbi");
    expect(user.cookie).toContain("better-auth.session_token=");

    const response = await api(t.app, user.cookie, "GET", "/me");
    expect(response.statusCode).toBe(200);
    const me = MeResponse.parse(response.json());
    expect(me.user).toEqual({ id: user.id, email: user.email, name: "Nour Al-Harbi" });
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

  it("serves the session and sign-out, and nothing else of Better Auth", async () => {
    const user = await signUp(t.app, "Huda Al-Shehri");
    const session = await t.app.inject({
      method: "GET",
      url: "/api/auth/get-session",
      headers: { origin: ORIGIN, cookie: user.cookie },
    });
    expect(session.statusCode).toBe(200);
    expect(session.json<{ user: { id: string } }>().user.id).toBe(user.id);

    for (const url of ["/api/auth/list-sessions", "/api/auth/update-user"]) {
      const response = await t.app.inject({
        method: "POST",
        url,
        headers: {
          origin: ORIGIN,
          cookie: user.cookie,
          "content-type": "application/json",
        },
        payload: {},
      });
      expect(response.statusCode, url).toBe(404);
      expect(response.headers["content-type"]).toMatch(/^application\/problem\+json/);
    }

    const signOut = await t.app.inject({
      method: "POST",
      url: "/api/auth/sign-out",
      headers: {
        origin: ORIGIN,
        cookie: user.cookie,
        "content-type": "application/json",
      },
      payload: {},
    });
    expect(signOut.statusCode).toBe(200);
    expect((await api(t.app, user.cookie, "GET", "/me")).statusCode).toBe(401);
  });

  it("trusts the Vite preview origin outside production", async () => {
    // Better Auth skips its own origin check under a test runner, so this checks CORS,
    // which uses the same trustedOrigins() list (see unit.test.ts).
    const user = await signUp(t.app, "Faisal Al-Qahtani");
    const signInFrom = (origin: string) =>
      t.app.inject({
        method: "POST",
        url: "/api/auth/sign-in/email",
        headers: { origin, "content-type": "application/json" },
        payload: { email: user.email, password: "correct-horse-battery-staple" },
      });

    const preview = await signInFrom("http://localhost:4173");
    expect(preview.statusCode).toBe(200);
    expect(sessionCookie(preview)).toContain("better-auth.session_token=");
    expect(preview.headers["access-control-allow-origin"]).toBe("http://localhost:4173");

    const untrusted = await signInFrom("http://localhost:9999");
    expect(untrusted.headers["access-control-allow-origin"]).toBeUndefined();
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
