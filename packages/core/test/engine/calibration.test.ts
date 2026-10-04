import { describe, expect, it } from "vitest";
import { isProblemVerdict } from "../../src/engine/verdicts";
import { runFieldRules } from "../../src/rules";
import { scoreFindings } from "../../src/score";
import { analyseSection15, MemoryClauseCache } from "../../src/section15";
import {
  clause,
  FakeArticleLookup,
  FakeLlmClient,
  RULES,
  TODAY,
  test1Fields,
} from "./fixtures";
import { rateTest1 } from "./test1";

describe("calibration: test #1", () => {
  it("produces the expected problem findings", async () => {
    const { findings } = await rateTest1();
    const problems = findings
      .filter((f) => isProblemVerdict(f.verdict))
      .map((f) => [f.ruleId, f.clause, f.verdict, f.severity]);
    expect(problems).toEqual([
      ["TYPE-ART57-01", "15.1", "unclear", "high"],
      ["CONFIDENTIAL-01", "15.2", "unclear", "low"],
      ["TRANSFER-KSA-01", "15.3", "worse_than_default", "medium"],
      ["COMP-ART77-01", "15.4", "worse_than_default", "high"], // escalated from medium
      ["LEAVE-FORFEIT-01", "15.5", "unclear", "low"],
      ["EOS-BASE-01", "15.6", "likely_void", "high"],
      ["TYPE-CONFLICT-01", "15.1", "conflict", "high"],
    ]);
  });

  it("has the expected positives, compliant fields and no false positives", async () => {
    const { findings } = await rateTest1();
    const verdictOf = (id: string) => findings.find((f) => f.ruleId === id)?.verdict;
    expect(verdictOf("LEAVE-MIN-01")).toBe("better_than_law");
    expect(verdictOf("HOURS-MAX-01")).toBe("better_than_law");
    expect(verdictOf("PROB-MAX-01")).toBe("compliant");
    expect(verdictOf("OT-RATE-01")).toBe("compliant");
    expect(verdictOf("MARKET-ALLOW-01")).toBe("compliant");
    expect(findings.some((f) => f.ruleId === "NONCOMPETE-01")).toBe(false);
    expect(findings.some((f) => f.clause === "15.7")).toBe(false);
  });

  it("computes the end-of-service and Art. 77 impact", async () => {
    const { findings } = await rateTest1();
    expect(findings.find((f) => f.ruleId === "EOS-BASE-01")?.impact?.sar).toEqual({
      "1y": 1750,
      "5y": 8750,
      "10y": 26250,
    });
    expect(findings.find((f) => f.ruleId === "COMP-ART77-01")?.impact?.sar).toEqual({
      contract: 20000,
      default: 162000,
      gap: 142000,
    });
  });

  it("puts the renewal deadline 30 days before the end date", async () => {
    const { deadlines } = await rateTest1();
    expect(deadlines.find((d) => d.ruleId === "RENEW-DEADLINE-01")?.date).toBe(
      "2026-12-11",
    );
  });

  it("scores employee ≈ 64 and HR ≈ 61", async () => {
    const { findings } = await rateTest1();
    const employee = scoreFindings(findings, "employee");
    const hr = scoreFindings(findings, "hr");
    expect(employee.overall).toBeGreaterThanOrEqual(59);
    expect(employee.overall).toBeLessThanOrEqual(69);
    expect(hr.overall).toBeGreaterThanOrEqual(56);
    expect(hr.overall).toBeLessThanOrEqual(66);
    // The formula lands exactly on the targets today; keep it that way unless retuned on purpose.
    expect(employee).toMatchObject({
      legal: 61,
      market: 72,
      clarity: 57,
      overall: 64,
      band: "Fair",
    });
    expect(hr).toMatchObject({ overall: 61, band: "Fair" });
  });
});

describe("calibration: clean contract", () => {
  it("scores 85 or more in both views", async () => {
    const fields = test1Fields({
      contractType: "indefinite",
      endDate: null,
      termMonths: null,
      autoRenew: null,
      renewalNoticeDays: null,
      probationDays: 90,
      annualLeaveDays: 21,
      workDaysPerWeek: 6,
      dailyHours: 8,
      weeklyHours: 48,
      wage: { basic: 8000, housing: 2000, transport: 800, other: 0, total: 10800 },
    });
    const llm = new FakeLlmClient(); // no clause matches any rule
    const section15 = await analyseSection15({
      clauses: [
        clause(
          "15.1",
          "The employee shall comply with the company dress code and internal policies.",
        ),
        clause(
          "15.2",
          "This contract supersedes all prior agreements between the parties.",
        ),
      ],
      fields,
      rules: RULES,
      llm,
      articles: new FakeArticleLookup(),
      cache: new MemoryClauseCache(),
      versions: { law: "2025-11", ruleset: "0.1.0" },
    });
    const findings = [
      ...runFieldRules(fields, RULES, { today: TODAY }).findings,
      ...section15.findings,
    ];
    expect(findings.filter((f) => isProblemVerdict(f.verdict))).toEqual([]);
    expect(scoreFindings(findings, "employee").overall).toBeGreaterThanOrEqual(85);
    expect(scoreFindings(findings, "hr").overall).toBeGreaterThanOrEqual(85);
  });
});
