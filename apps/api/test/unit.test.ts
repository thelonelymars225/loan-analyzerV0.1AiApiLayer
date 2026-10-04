import { describe, expect, it } from "vitest";
import type { OrgSummary } from "@rater/contracts";
import { loadConfig } from "../src/config";
import { ApiError, rateLimited } from "../src/errors";
import { parseRole, personalOrgName, slugify } from "../src/orgs";
import { toProblem } from "../src/plugins/errors";
import { pickActiveOrg } from "../src/plugins/session";
import { decodeCursor, encodeCursor } from "../src/ratings/cursor";
import { defaultViewFor } from "../src/ratings/store";
import { looksLikePdf } from "../src/ratings/upload";
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
      MIGRATE_ON_START: true,
    });
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

  it("picks Arabic only when it is the first language asked for", () => {
    expect(preferredLocale("ar")).toBe("ar");
    expect(preferredLocale("ar-SA,en;q=0.5")).toBe("ar");
    expect(preferredLocale("en,ar;q=0.5")).toBe("en");
    expect(preferredLocale(undefined)).toBe("en");
  });
});
