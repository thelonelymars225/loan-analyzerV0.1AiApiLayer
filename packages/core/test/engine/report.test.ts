import { describe, expect, it } from "vitest";
import { DISCLAIMER_AR, DISCLAIMER_EN, RatingReport } from "@rater/contracts";
import type { Deadline, Finding } from "@rater/contracts";
import { renderReport, sarAtStake, type RenderReportInput } from "../../src/report";
import { RULES, test1Fields } from "./fixtures";
import { rateTest1 } from "./test1";

async function test1Report(overrides: Partial<RenderReportInput> = {}) {
  const { findings, deadlines } = await rateTest1();
  return renderReport({
    id: "rt_test",
    status: "done",
    view: "employee",
    createdAt: "2026-10-03T10:00:00Z",
    finishedAt: "2026-10-03T10:01:00Z",
    error: null,
    findings,
    deadlines,
    fields: test1Fields(),
    versions: {
      law: "2025-11",
      ruleset: "0.1.0",
      prompt: "fake-prompt-v1",
      model: "fake-model-1",
    },
    rules: RULES,
    ...overrides,
  });
}

const ids = (list: { ruleId: string; clause: string | null }[]) =>
  list.map((f) => `${f.ruleId}@${f.clause}`);

describe("renderReport", () => {
  it("returns a valid RatingReport", async () => {
    const report = await test1Report();
    expect(RatingReport.safeParse(report).success).toBe(true);
    expect(report.disclaimer).toBe(DISCLAIMER_EN);
  });

  it("orders the employee view by SAR at stake, then severity", async () => {
    const report = await test1Report({ view: "employee" });
    expect(ids(report.findings)).toEqual([
      "COMP-ART77-01@15.4", // gap 157,778
      "EOS-BASE-01@15.6", // 8,750.00 after 5 years
      "TYPE-ART57-01@15.1",
      "TYPE-CONFLICT-01@15.1",
      "TRANSFER-KSA-01@15.3",
      "CONFIDENTIAL-01@15.2",
      "LEAVE-FORFEIT-01@15.5",
    ]);
  });

  it("orders the HR view by severity, then legal risk", async () => {
    const report = await test1Report({ view: "hr" });
    expect(ids(report.findings)).toEqual([
      "EOS-BASE-01@15.6", // likely void
      "TYPE-CONFLICT-01@15.1", // conflict
      "COMP-ART77-01@15.4", // worse than default
      "TYPE-ART57-01@15.1", // unclear
      "TRANSFER-KSA-01@15.3",
      "CONFIDENTIAL-01@15.2",
      "LEAVE-FORFEIT-01@15.5",
    ]);
  });

  it("scores each view with its own weights", async () => {
    expect((await test1Report({ view: "employee" })).score).toMatchObject({
      overall: 64,
      band: "Fair",
      marketConfidence: "low",
    });
    expect((await test1Report({ view: "hr" })).score).toMatchObject({
      overall: 61,
      legal: 61,
      market: 72,
      clarity: 57,
    });
  });

  it("splits findings into problems, what's good and info", async () => {
    const report = await test1Report();
    expect(ids(report.good)).toEqual([
      "PROB-MAX-01@6.1",
      "PROB-EXCL-01@6.1",
      "LEAVE-MIN-01@8.1",
      "HOURS-MAX-01@7",
      "OT-RATE-01@11.2",
      "MARKET-ALLOW-01@9.1.1",
    ]);
    expect(ids(report.info)).toEqual([
      "PROB-NOCOMP-01@6.2",
      "RENEW-CONVERT-01@5.1",
      "SETTLE-TIME-01@null",
    ]);
  });

  it("picks the view's message and action", async () => {
    const employee = (await test1Report({ view: "employee" })).findings.find(
      (f) => f.ruleId === "EOS-BASE-01",
    );
    const hr = (await test1Report({ view: "hr" })).findings.find(
      (f) => f.ruleId === "EOS-BASE-01",
    );
    expect(employee).toMatchObject({
      title: "End-of-service award on the actual wage",
      message: "Likely void: end-of-service uses your actual wage.",
      action: "Ask for the award on your actual wage.",
      impactSar: { "1y": 1750, "5y": 8750, "10y": 26250 },
      impactKind: "eos_gap",
    });
    expect(hr).toMatchObject({
      message: "Likely void. Base the award on the actual wage.",
      action: "The award is calculated on the last actual wage.",
    });
  });

  it("gives good and info findings no action", async () => {
    const report = await test1Report();
    expect([...report.good, ...report.info].every((f) => f.action === null)).toBe(true);
    expect(report.good.find((f) => f.ruleId === "LEAVE-MIN-01")?.message).toBe(
      "You get 22 days of annual leave a year.",
    );
  });

  it("renders deadlines with the view's message, earliest first", async () => {
    const deadlines: Deadline[] = [
      {
        ruleId: "RENEW-DEADLINE-01",
        date: "2026-12-11",
        kind: "renewal_notice",
        employeeMsg: "Notice by {deadline}.",
        hrMsg: "HR: due {deadline}.",
      },
      {
        ruleId: "PROB-NOCOMP-01",
        date: "2026-11-01",
        kind: "probation_end",
        employeeMsg: "Probation ends {deadline}.",
        hrMsg: "x",
      },
    ];
    const report = await test1Report({ view: "hr", deadlines });
    expect(report.deadlines).toEqual([
      {
        ruleId: "PROB-NOCOMP-01",
        kind: "probation_end",
        date: "2026-11-01",
        message: "x",
      },
      {
        ruleId: "RENEW-DEADLINE-01",
        kind: "renewal_notice",
        date: "2026-12-11",
        message: "HR: due 2026-12-11.",
      },
    ]);
  });

  it("fills placeholders left in stored messages from the deadlines and the fields", async () => {
    const stored: Finding = {
      ruleId: "LEAVE-MIN-01",
      clause: "8.1",
      verdict: "likely_void",
      severity: "high",
      confidence: "high",
      categories: ["legal"],
      articles: [],
      impact: null,
      explanation: "e",
      employeeMsg: "You get {value} days; act by {deadline}. {unknown} stays.",
      hrMsg: "Below {limit} days.",
      askFor: "Ask for {limit} days.",
      source: "field_rule",
      needsReview: false,
    };
    const deadline: Deadline = {
      ruleId: "RENEW-DEADLINE-01",
      date: "2026-12-11",
      kind: "renewal_notice",
      employeeMsg: "e",
      hrMsg: "h",
    };
    const base = {
      findings: [stored],
      deadlines: [deadline],
      fields: test1Fields({ annualLeaveDays: 15 }),
    };
    const employee = await test1Report({ ...base, view: "employee" });
    expect(employee.findings[0]?.message).toBe(
      "You get 15 days; act by 2026-12-11. {unknown} stays.",
    );
    expect(employee.findings[0]?.action).toBe("Ask for 21 days.");
    const hr = await test1Report({ ...base, view: "hr" });
    expect(hr.findings[0]?.message).toBe("Below 21 days.");
  });

  it("shows no score until the rating is done, and uses the Arabic disclaimer on request", async () => {
    const failed = await test1Report({
      status: "failed",
      error: { code: "unsupported_document", message: "Not Qiwa" },
    });
    expect(failed.score).toBeNull();
    expect(failed.error?.code).toBe("unsupported_document");
    expect((await test1Report({ status: "needs_review" })).score).not.toBeNull();
    expect((await test1Report({ locale: "ar" })).disclaimer).toBe(DISCLAIMER_AR);
  });

  it("titles a REVIEW-00 finding and keeps its review flag", async () => {
    const review: Finding = {
      ruleId: "REVIEW-00",
      clause: "15.3",
      verdict: "unclear",
      severity: "low",
      confidence: "low",
      categories: ["clarity"],
      articles: [],
      impact: null,
      explanation: "failed twice",
      employeeMsg: "We couldn't analyse this clause.",
      hrMsg: "Review it manually.",
      source: "clause",
      needsReview: true,
    };
    const report = await test1Report({ findings: [review] });
    expect(report.findings[0]).toMatchObject({
      title: "Needs a manual review",
      needsReview: true,
    });
  });
});

describe("sarAtStake", () => {
  it("uses each kind's headline figure", () => {
    expect(sarAtStake({ kind: "eos_gap", sar: { "1y": 1, "5y": 5, "10y": 10 } })).toBe(5);
    expect(
      sarAtStake({ kind: "art77_gap", sar: { contract: 2, default: 12, gap: 10 } }),
    ).toBe(10);
    expect(sarAtStake({ kind: "leave_value", sar: { perYear: 3 } })).toBe(3);
    expect(sarAtStake(null)).toBe(0);
  });
});
