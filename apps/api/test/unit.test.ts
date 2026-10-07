import { describe, expect, it } from "vitest";
import type { OrgSummary } from "@rater/contracts";
import { loadConfig, trustedOrigins } from "../src/config";
import { ApiError, rateLimited } from "../src/errors";
import { acceptPath, toInviteResponse } from "../src/invites";
import { ConcurrencyLimit, ConnectionSlots } from "../src/limiter";
import { parseRole, personalOrgName, slugify } from "../src/orgs";
import { isAllowed } from "../src/plugins/auth-routes";
import { toProblem } from "../src/plugins/errors";
import { pickActiveOrg } from "../src/plugins/session";
import { decodeCursor, encodeCursor } from "../src/ratings/cursor";
import { defaultViewFor } from "../src/ratings/store";
import { checkQiwaPdf, looksLikePdf } from "../src/ratings/upload";
import { fixture } from "./helpers";
import { preferredLocale } from "../src/report";

describe("loadConfig", () => {
  it("fills in defaults and treats empty values as unset", () => {
    const config = loadConfig({ DATABASE_URL: "postgres://localhost/rater", PORT: "" });
    expect(config).toMatchObject({
      PORT: 3000,
      HOST: "0.0.0.0",
      WEB_ORIGIN: "http://localhost:5173",
      RATE_LIMIT_PER_DAY: 20,
      MAX_UPLOAD_BYTES: 10 * 1024 * 1024,
      DB_MIGRATE_ON_START: true,
    });
  });

  it("reads DB_MIGRATE_ON_START like the worker does", () => {
    const read = (value: string) =>
      loadConfig({
        DATABASE_URL: "postgres://localhost/rater",
        DB_MIGRATE_ON_START: value,
      }).DB_MIGRATE_ON_START;
    expect(read("false")).toBe(false);
    expect(read("0")).toBe(false);
    expect(read("true")).toBe(true);
    expect(() => read("maybe")).toThrow(/DB_MIGRATE_ON_START/);
  });

  it("trusts Vite's dev and preview origins outside production only", () => {
    const dev = loadConfig({ DATABASE_URL: "postgres://localhost/rater" });
    expect(trustedOrigins(dev)).toEqual([
      "http://localhost:5173",
      "http://localhost:4173",
    ]);

    const production = loadConfig({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://localhost/rater",
      BETTER_AUTH_SECRET: "a-production-secret-of-at-least-32-chars",
      WEB_ORIGIN: "https://rater.example.com",
    });
    expect(trustedOrigins(production)).toEqual(["https://rater.example.com"]);
  });

  it("lists every problem at once", () => {
    expect(() => loadConfig({ PORT: "abc" })).toThrow(/DATABASE_URL[\s\S]*PORT/);
  });

  it("requires an auth secret in production", () => {
    expect(() =>
      loadConfig({ NODE_ENV: "production", DATABASE_URL: "postgres://localhost/rater" }),
    ).toThrow(/BETTER_AUTH_SECRET/);
  });
});

describe("list cursor", () => {
  it("round-trips (createdAt, id)", () => {
    const cursor = { createdAt: new Date("2026-10-04T08:00:00.123Z"), id: "rt_01abc" };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it.each(["", "garbage", Buffer.from("not-a-date|rt_1").toString("base64url")])(
    "rejects %j with a validation error",
    (value) => {
      expect(() => decodeCursor(value)).toThrow(ApiError);
    },
  );
});

describe("toProblem", () => {
  it("keeps an ApiError's status, code and headers", () => {
    const { problem, headers } = toProblem(rateLimited(20, 3600));
    expect(problem).toMatchObject({
      status: 429,
      code: "rate_limited",
      title: "Too many requests",
    });
    expect(headers).toEqual({ "retry-after": "3600" });
  });

  it("hides the message of unexpected errors", () => {
    const { problem } = toProblem(new Error("connection to 10.0.0.5 refused"));
    expect(problem).toEqual({
      type: "urn:contract-rater:error:internal",
      title: "Internal server error",
      status: 500,
      code: "internal",
      detail: "Something went wrong.",
    });
  });

  it("maps Fastify's own client errors by status", () => {
    const badJson = Object.assign(new Error("Unexpected token"), { statusCode: 400 });
    expect(toProblem(badJson).problem.code).toBe("validation_error");
    const tooBig = Object.assign(new Error("too large"), {
      code: "FST_REQ_FILE_TOO_LARGE",
    });
    expect(toProblem(tooBig).problem).toMatchObject({
      status: 413,
      code: "file_too_large",
    });
  });
});

describe("workspaces", () => {
  it("reads the strongest of several stored roles", () => {
    expect(parseRole("member")).toBe("member");
    expect(parseRole("admin, member")).toBe("admin");
    expect(parseRole("member,owner")).toBe("owner");
    expect(parseRole("auditor")).toBe("member");
  });

  it("names and slugs workspaces", () => {
    expect(personalOrgName("Nour Al-Harbi")).toBe("Nour Al-Harbi's workspace");
    expect(slugify("Example Trading Co.")).toBe("example-trading-co");
    expect(slugify("شركة المثال")).toBe("workspace");
  });

  it("falls back from a stale active org to the personal workspace", () => {
    const orgs: OrgSummary[] = [
      {
        id: "org_company",
        name: "Example Trading Co.",
        kind: "company",
        role: "admin",
        retentionDays: 30,
      },
      {
        id: "org_personal",
        name: "Nour's workspace",
        kind: "personal",
        role: "owner",
        retentionDays: 30,
      },
    ];
    expect(pickActiveOrg(orgs, "org_company")?.id).toBe("org_company");
    expect(pickActiveOrg(orgs, "org_gone")?.id).toBe("org_personal");
    expect(pickActiveOrg(orgs, null)?.id).toBe("org_personal");
    expect(pickActiveOrg([], null)).toBeUndefined();
  });

  it("rates personal uploads for the employee and company uploads for HR", () => {
    expect(defaultViewFor("personal")).toBe("employee");
    expect(defaultViewFor("company")).toBe("hr");
  });
});

describe("uploads and reports", () => {
  it("recognises PDF files by their header", () => {
    expect(looksLikePdf(Buffer.from("%PDF-1.7\n..."))).toBe(true);
    expect(looksLikePdf(Buffer.from("\n\n%PDF-1.4"))).toBe(true);
    expect(looksLikePdf(Buffer.from("PK\u0003\u0004 a zip file"))).toBe(false);
    expect(looksLikePdf(Buffer.alloc(0))).toBe(false);
  });

  it("accepts a Qiwa contract and counts every page", async () => {
    const pdf = await fixture("fixed-term-bad-s15.pdf");
    await expect(checkQiwaPdf(pdf)).resolves.toEqual({ pages: 10 });
  });

  it("answers 422 for a damaged PDF or one that is not a Qiwa contract", async () => {
    const damaged = Buffer.concat([
      Buffer.from("%PDF-1.7\n"),
      Buffer.alloc(256 * 1024, 7),
    ]);
    await expect(checkQiwaPdf(damaged)).rejects.toMatchObject({
      status: 422,
      code: "unsupported_document",
      message: "The PDF could not be read.",
    });
    await expect(checkQiwaPdf(await fixture("not-qiwa.pdf"))).rejects.toMatchObject({
      status: 422,
    });
  });

  it("picks Arabic only when it is the first language asked for", () => {
    expect(preferredLocale("ar")).toBe("ar");
    expect(preferredLocale("ar-SA,en;q=0.5")).toBe("ar");
    expect(preferredLocale("en,ar;q=0.5")).toBe("en");
    expect(preferredLocale(undefined)).toBe("en");
  });
});

describe("Better Auth allow-list", () => {
  const allowed = (path: string) =>
    isAllowed(new Request(`http://localhost:3000/api/auth${path}`, { method: "POST" }));

  it("lets sign-up, sign-in, sign-out and the session through", () => {
    for (const path of [
      "/sign-up/email",
      "/sign-in/email",
      "/sign-out",
      "/get-session",
    ]) {
      expect(allowed(path), path).toBe(true);
    }
    expect(allowed("/get-session?disableCookieCache=true")).toBe(true);
  });

  it("closes every organization endpoint and anything else", () => {
    for (const path of [
      "/organization/list-invitations",
      "/organization/accept-invitation",
      "/organization/set-active",
      "/organization/invite-member",
      "/organization/update",
      "/sign-in/email/../../organization/list-invitations",
      "//organization/list-invitations",
      "/organization%2Flist-invitations",
      "/update-user",
      "/delete-user",
    ]) {
      expect(allowed(path), path).toBe(false);
    }
  });
});

describe("invitations", () => {
  it("links to the web app's accept page", () => {
    expect(acceptPath("inv_01abc")).toBe("/invite/inv_01abc");
    expect(
      toInviteResponse({
        id: "inv_01abc",
        email: "huda@example.com",
        role: "admin",
        status: "pending",
        expiresAt: new Date("2026-10-06T08:00:00Z"),
      }),
    ).toEqual({
      id: "inv_01abc",
      email: "huda@example.com",
      role: "admin",
      status: "pending",
      expiresAt: "2026-10-06T08:00:00.000Z",
      acceptPath: "/invite/inv_01abc",
    });
  });
});

describe("limits", () => {
  it("runs at most `size` tasks at once and the rest in turn", async () => {
    const limit = new ConcurrencyLimit(2);
    let running = 0;
    let most = 0;
    const task = async (value: number) => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return value;
    };
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((n) => limit.run(() => task(n))),
    );
    expect(results).toEqual([1, 2, 3, 4, 5]);
    expect(most).toBe(2);
  });

  it("frees a slot when a task fails", async () => {
    const limit = new ConcurrencyLimit(1);
    await expect(limit.run(() => Promise.reject(new Error("bad pdf")))).rejects.toThrow();
    await expect(limit.run(async () => "next")).resolves.toBe("next");
  });

  it("caps open connections per user and in total", () => {
    const slots = new ConnectionSlots({ perUser: 2, total: 3 });
    expect(slots.tryTake("user_a")).toBe(true);
    expect(slots.tryTake("user_a")).toBe(true);
    expect(slots.tryTake("user_a")).toBe(false); // per-user cap
    expect(slots.tryTake("user_b")).toBe(true);
    expect(slots.tryTake("user_c")).toBe(false); // total cap
    expect(slots.open).toBe(3);

    slots.release("user_a");
    expect(slots.tryTake("user_c")).toBe(true);
    slots.release("user_nobody"); // nothing to give back
    expect(slots.open).toBe(3);
  });
});
