import { describe, expect, it } from "vitest";
import {
  caseVerdict,
  checkStability,
  compareCase,
  type RunOutcome,
} from "../lib/compare";
import { Expected } from "../lib/expected";
import { caseDiff, formatCase, resultForFile } from "../lib/report";
import type { CaseResult } from "../lib/run-case";

/** A case whose fields, deadlines and findings all differ from what was expected. */
function failingResult(isPrivate: boolean): CaseResult {
  const expected = Expected.parse({
    id: "case-x",
    description: "test",
    today: "2026-10-04",
    status: "done",
    fields: { annualLeaveDays: 22, endDate: "2026-08-31" },
    findings: [
      { ruleId: "EOS-BASE-01", clause: "15.6", verdict: "likely_void", severity: "high" },
    ],
    mustNot: ["NONCOMPETE-01"],
    deadlines: [{ ruleId: "RENEW-DEADLINE-01", date: "2026-08-01" }],
    score: { employee: [60, 70], hr: [58, 68] },
  });
  const run: RunOutcome = {
    status: "done",
    fields: null,
    findings: [
      {
        ruleId: "NONCOMPETE-01",
        clause: "15.2",
        verdict: "likely_void",
        severity: "high",
        source: "clause",
      },
    ],
    deadlines: [{ ruleId: "RENEW-DEADLINE-01", date: "2026-08-02" }],
    scores: { employee: 80, hr: 60 },
  };
  const comparison = compareCase(expected, run);
  const stability = checkStability([run.findings, []]);
  return {
    id: "case-x",
    description: "test",
    isPrivate,
    comparison,
    stability,
    verdict: caseVerdict(comparison, stability),
    durationMs: 1200,
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}

describe("caseDiff", () => {
  it("lists every difference of a synthetic case with its values", () => {
    const lines = caseDiff(failingResult(false));
    // Fields come in ContractFields order.
    expect(lines).toEqual([
      'field endDate: expected "2026-08-31", got null',
      "field annualLeaveDays: expected 22, got null",
      "missing HIGH: EOS-BASE-01@15.6 likely_void/high",
      "unexpected: NONCOMPETE-01@15.2 likely_void/high",
      "mustNot violated: NONCOMPETE-01@15.2 likely_void/high",
      "deadline missing: RENEW-DEADLINE-01 2026-08-01",
      "deadline unexpected: RENEW-DEADLINE-01 2026-08-02",
      "score employee: 80 is outside [60, 70]",
      "unstable: run 2 added [] removed [NONCOMPETE-01@15.2 likely_void/high]",
    ]);
  });

  it("never shows field values or dates of a private case", () => {
    const text = caseDiff(failingResult(true)).join("\n");
    expect(text).toContain("field annualLeaveDays");
    expect(text).toContain("RENEW-DEADLINE-01");
    expect(text).not.toMatch(/2026-08-(?:0[12]|31)/);
    expect(text).not.toContain("22");
  });

  it("is empty for a case that matches", () => {
    const expected = Expected.parse({
      id: "ok",
      description: "",
      today: "2026-10-04",
      status: "rejected",
    });
    const run: RunOutcome = {
      status: "rejected",
      fields: null,
      findings: [],
      deadlines: [],
      scores: null,
    };
    const comparison = compareCase(expected, run);
    const stability = checkStability([[], []]);
    const result: CaseResult = {
      ...failingResult(false),
      comparison,
      stability,
      verdict: caseVerdict(comparison, stability),
    };
    expect(caseDiff(result)).toEqual([]);
    expect(formatCase(result)[0]).toMatch(/^PASS {2}case-x/);
  });
});

describe("resultForFile", () => {
  it("keeps a synthetic case as it is", () => {
    const result = failingResult(false);
    expect(resultForFile(result)).toBe(result);
  });

  it("removes field values and dates of a private case", () => {
    const saved = JSON.stringify(resultForFile(failingResult(true)));
    expect(saved).not.toMatch(/2026-08-(?:0[12]|31)/);
    expect(saved).not.toMatch(/"expected":22/);
    expect(saved).toContain("annualLeaveDays");
    expect(saved).toContain("EOS-BASE-01");
  });
});
