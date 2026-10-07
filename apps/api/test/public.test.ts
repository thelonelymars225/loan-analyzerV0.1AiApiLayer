import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HealthResponse, Problem } from "@rater/contracts";
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
