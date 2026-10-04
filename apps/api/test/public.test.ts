import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HealthResponse, Problem, RulesResponse } from "@rater/contracts";
import { LAW_VERSION, RULESET_VERSION } from "@rater/law";
import {
  DATABASE_URL,
  createTestContext,
  fixture,
  signUp,
  upload,
  type TestContext,
} from "./helpers";

describe.skipIf(!DATABASE_URL)("public routes", () => {
  let t: TestContext;

  beforeAll(async () => {
    t = await createTestContext();
  });
  afterAll(async () => {
    await t?.close();
  });

  it("reports health of the database and the queue", async () => {
    const healthy = await t.app.inject({ method: "GET", url: "/api/v1/healthz" });
    expect(healthy.statusCode).toBe(200);
    expect(HealthResponse.parse(healthy.json())).toEqual({
      ok: true,
      db: true,
      queue: true,
    });

    t.queue.isHealthy = false;
    const unhealthy = await t.app.inject({ method: "GET", url: "/api/v1/healthz" });
    t.queue.isHealthy = true;
    expect(unhealthy.statusCode).toBe(503);
    expect(unhealthy.json()).toEqual({ ok: false, db: true, queue: false });
  });

  it("serves the rules table with its versions", async () => {
    const response = await t.app.inject({ method: "GET", url: "/api/v1/rules" });
    expect(response.statusCode).toBe(200);
    const rules = RulesResponse.parse(response.json());
    expect(rules.rulesetVersion).toBe(RULESET_VERSION);
    expect(rules.lawVersion).toBe(LAW_VERSION);
    expect(rules.rules.map((rule) => rule.id)).toContain("EOS-BASE-01");
  });

  it("publishes an OpenAPI document generated from the schemas, and Swagger UI", async () => {
    const response = await t.app.inject({ method: "GET", url: "/api/v1/openapi.json" });
    expect(response.statusCode).toBe(200);
    const spec = response.json<{ openapi: string; paths: Record<string, object> }>();
    expect(spec.openapi).toBe("3.1.0");
    expect(Object.keys(spec.paths)).toEqual(
      expect.arrayContaining([
        "/api/v1/ratings",
        "/api/v1/ratings/{id}",
        "/api/v1/ratings/{id}/events",
        "/api/v1/ratings/{id}/document",
        "/api/v1/me",
        "/api/v1/me/active-org",
        "/api/v1/me/data",
        "/api/v1/invites/{id}",
        "/api/v1/invites/{id}/accept",
        "/api/v1/orgs",
        "/api/v1/orgs/{id}",
        "/api/v1/orgs/{id}/members",
        "/api/v1/orgs/{id}/invites",
        "/api/v1/orgs/{id}/invites/{inviteId}",
        "/api/v1/orgs/{id}/members/{userId}",
        "/api/v1/rules",
        "/api/v1/healthz",
      ]),
    );
    expect(Object.keys(spec.paths).some((path) => path.startsWith("/api/auth"))).toBe(
      false,
    );

    const ui = await t.app.inject({ method: "GET", url: "/api/docs/" });
    expect(ui.statusCode).toBe(200);
    expect(ui.headers["content-type"]).toMatch(/^text\/html/);
  });

  it("lets the web app send PUT and x-org-id across origins", async () => {
    const response = await t.app.inject({
      method: "OPTIONS",
      url: "/api/v1/me/active-org",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "PUT",
        "access-control-request-headers": "content-type,x-org-id",
      },
    });
    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-methods"]).toContain("PUT");
    expect(response.headers["access-control-allow-headers"]).toContain("x-org-id");
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("answers unknown routes with a problem+json not_found", async () => {
    const response = await t.app.inject({ method: "GET", url: "/api/nothing-here" });
    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toMatch(/^application\/problem\+json/);
    expect(Problem.parse(response.json())).toEqual({
      type: "urn:contract-rater:error:not_found",
      title: "Not found",
      status: 404,
      code: "not_found",
      detail: "No route for GET /api/nothing-here.",
    });
  });
});

describe.skipIf(!DATABASE_URL)("shutdown", () => {
  it("ends open event streams so the server can close", async () => {
    const t = await createTestContext();
    try {
      const user = await signUp(t.app);
      const uploaded = await upload(
        t.app,
        user.cookie,
        await fixture("indefinite-clean.pdf"),
      );
      const { id } = uploaded.json<{ id: string }>();
      const address = await t.app.listen({ port: 0, host: "127.0.0.1" });

      // The rating stays queued (no worker), so the stream would run for minutes.
      const stream = await fetch(`${address}/api/v1/ratings/${id}/events`, {
        headers: { cookie: user.cookie },
      });
      const started = Date.now();
      await t.app.close();
      expect(Date.now() - started).toBeLessThan(2_000);
      expect(await stream.text()).toContain('"status":"queued"');
    } finally {
      await t.close();
    }
  });
});
