import { describe, expect, it } from "vitest";
import type { ContractFields } from "@rater/contracts";
import {
  caseVerdict,
  checkStability,
  compareCase,
  compareDeadlines,
  compareFields,
  compareFindings,
  compareScores,
  findingKey,
  isProblem,
  summarise,
  type FindingOutcome,
  type RunOutcome,
} from "../lib/compare";
import { Expected, type ExpectedFinding, type ExpectedInput } from "../lib/expected";

function finding(
  ruleId: string,
  clause: string | null,
  verdict: FindingOutcome["verdict"],
  severity: FindingOutcome["severity"],
  source: FindingOutcome["source"] = "clause",
): FindingOutcome {
  return { ruleId, clause, verdict, severity, source };
}

function want(
  ruleId: string,
  clause: string | null,
  verdict: ExpectedFinding["verdict"],
  severity: ExpectedFinding["severity"],
): ExpectedFinding {
  return { ruleId, clause, verdict, severity };
}

const FIELDS: ContractFields = {
  contractType: "fixed_term",
  contractTypeRaw: "Fixed-term Contract",
  executionDate: "2026-01-01",
  commencementDate: "2026-01-01",
  endDate: "2026-12-31",
  termMonths: 12,
  autoRenew: true,
  renewalNoticeDays: 30,
  probationDays: 90,
  probationExcludedDays: [],
  workDaysPerWeek: 5,
  dailyHours: 8,
  weeklyHours: 40,
  restDaysPerWeek: 2,
  annualLeaveDays: 21,
  wage: { basic: 10000, housing: 2500, transport: 1000, other: 0, total: 13500 },
  overtimePremiumPct: 50,
  nationality: "saudi",
  occupation: null,
  workLocation: null,
};

function expected(input: Partial<ExpectedInput> = {}): Expected {
  return Expected.parse({
    id: "case",
    description: "test",
    today: "2026-10-04",
    status: "done",
    ...input,
  });
}

function run(input: Partial<RunOutcome> = {}): RunOutcome {
  return {
    status: "done",
    fields: FIELDS,
    findings: [],
    deadlines: [],
    scores: { employee: 80, hr: 75 },
    ...input,
  };
}

describe("isProblem", () => {
  it("counts every verdict except compliant and better than law, and never info", () => {
    expect(isProblem(finding("A", "15.1", "unclear", "low"))).toBe(true);
    expect(isProblem(finding("A", "15.1", "conflict", "high"))).toBe(true);
    expect(isProblem(finding("A", "15.1", "compliant", "none"))).toBe(false);
    expect(isProblem(finding("A", "8.1", "better_than_law", "none", "field_rule"))).toBe(
      false,
    );
    expect(isProblem(finding("A", null, "unclear", "low", "info"))).toBe(false);
  });
});

describe("compareFindings", () => {
  it("pairs expected and actual findings one to one", () => {
    const result = compareFindings(
      [
        want("OT-RATE-01", "15.1", "likely_void", "high"),
        want("OT-RATE-01", "15.1", "likely_void", "high"),
      ],
      [finding("OT-RATE-01", "15.1", "likely_void", "high")],
    );
    expect(result.matched).toHaveLength(1);
    expect(result.missing).toHaveLength(1);
    expect(result.unexpected).toEqual([]);
  });

  it("reports a wrong severity as missing, with the finding it got instead", () => {
    const got = finding("TRANSFER-KSA-01", "15.3", "worse_than_default", "low");
    const result = compareFindings(
      [want("TRANSFER-KSA-01", "15.3", "worse_than_default", "medium")],
      [got],
    );
    expect(result.missing).toEqual([
      {
        expected: want("TRANSFER-KSA-01", "15.3", "worse_than_default", "medium"),
        closest: got,
      },
    ]);
    expect(result.unexpected).toEqual([got]);
  });

  it("ignores unlisted compliant and info findings but not unlisted problems", () => {
    const result = compareFindings(
      [],
      [
        finding("PROB-MAX-01", "6.1", "compliant", "none", "field_rule"),
        finding("SETTLE-TIME-01", null, "compliant", "none", "info"),
        finding("NONCOMPETE-01", "15.2", "likely_void", "high"),
      ],
    );
    expect(result.unexpected.map(findingKey)).toEqual([
      "NONCOMPETE-01@15.2 likely_void/high",
    ]);
  });

  it("never matches REVIEW-00, even when a case lists it", () => {
    const review = finding("REVIEW-00", "15.1", "unclear", "low");
    const result = compareFindings(
      [want("REVIEW-00", "15.1", "unclear", "low")],
      [review],
    );
    expect(result.matched).toEqual([]);
    expect(result.unexpected).toEqual([review]);
  });

  it("matches findings without a clause (info rules)", () => {
    const result = compareFindings(
      [want("SETTLE-TIME-01", null, "compliant", "none")],
      [finding("SETTLE-TIME-01", null, "compliant", "none", "info")],
    );
    expect(result.matched).toHaveLength(1);
  });
});

describe("compareFields", () => {
  it("compares listed fields exactly, the wage deeply", () => {
    expect(
      compareFields(
        { annualLeaveDays: 21, wage: FIELDS.wage, endDate: "2026-12-31" },
        FIELDS,
      ),
    ).toEqual({ checked: 3, mismatches: [] });
    expect(
      compareFields({ wage: { ...FIELDS.wage!, total: 14000 } }, FIELDS).mismatches,
    ).toEqual([
      { field: "wage", expected: { ...FIELDS.wage!, total: 14000 }, actual: FIELDS.wage },
    ]);
  });

  it("treats an expected null as 'not found' and a missing extraction as all null", () => {
    expect(
      compareFields({ endDate: null }, { ...FIELDS, endDate: null }).mismatches,
    ).toEqual([]);
    expect(compareFields({ annualLeaveDays: 21 }, null).mismatches).toEqual([
      { field: "annualLeaveDays", expected: 21, actual: null },
    ]);
  });
});

describe("compareDeadlines", () => {
  it("is not checked when the case gives no deadlines", () => {
    expect(compareDeadlines(undefined, [{ ruleId: "X", date: "2026-01-01" }])).toEqual({
      checked: false,
      missing: [],
      unexpected: [],
    });
  });

  it("must match exactly when given", () => {
    const result = compareDeadlines(
      [{ ruleId: "RENEW-DEADLINE-01", date: "2026-10-16" }],
      [
        { ruleId: "RENEW-DEADLINE-01", date: "2026-10-17" },
        { ruleId: "PROB-NOCOMP-01", date: "2026-11-01" },
      ],
    );
    expect(result.missing).toEqual([{ ruleId: "RENEW-DEADLINE-01", date: "2026-10-16" }]);
    expect(result.unexpected).toHaveLength(2);
  });
});

describe("compareScores", () => {
  it("checks each view against its inclusive range", () => {
    const checks = compareScores(
      { employee: [59, 69], hr: [56, 66] },
      { employee: 69, hr: 55 },
    );
    expect(checks.map((check) => [check.view, check.ok])).toEqual([
      ["employee", true],
      ["hr", false],
    ]);
  });

  it("fails when there is no score, and checks nothing when none is expected", () => {
    expect(
      compareScores({ employee: [0, 100], hr: [0, 100] }, null).every((c) => !c.ok),
    ).toBe(true);
    expect(compareScores(undefined, { employee: 50, hr: 50 })).toEqual([]);
  });
});

describe("compareCase", () => {
  const eos = finding("EOS-BASE-01", "15.6", "likely_void", "high");
  const transfer = finding("TRANSFER-KSA-01", "15.3", "worse_than_default", "medium");

  it("counts high-severity recall, precision and mustNot violations", () => {
    const comparison = compareCase(
      expected({
        findings: [
          want("EOS-BASE-01", "15.6", "likely_void", "high"),
          want("TYPE-CONFLICT-01", "15.1", "conflict", "high"),
          want("LEAVE-MIN-01", "8.1", "better_than_law", "none"),
        ],
        mustNot: ["TRANSFER-KSA-01", "PROB-MAX-01"],
      }),
      run({
        findings: [
          eos,
          transfer,
          finding("LEAVE-MIN-01", "8.1", "better_than_law", "none", "field_rule"),
          finding("PROB-MAX-01", "6.1", "compliant", "none", "field_rule"),
        ],
      }),
    );
    expect(comparison.highRecall).toEqual({ expected: 2, found: 1 });
    expect(comparison.precision).toEqual({ produced: 2, correct: 1 });
    // PROB-MAX-01 is listed in mustNot but only came out compliant: not a violation.
    expect(comparison.mustNotViolations).toEqual([transfer]);
  });

  it("does not count an expected high-severity compliant finding towards recall", () => {
    const comparison = compareCase(
      expected({ findings: [want("NONCOMPETE-01", "15.2", "compliant", "high")] }),
      run(),
    );
    expect(comparison.highRecall.expected).toBe(0);
  });

  it("flags a wrong status", () => {
    const comparison = compareCase(expected({ status: "rejected" }), run());
    expect(comparison.status).toEqual({
      expected: "rejected",
      actual: "done",
      ok: false,
    });
  });
});

describe("checkStability", () => {
  const a = finding("A", "15.1", "unclear", "low");
  const b = finding("B", "15.2", "likely_void", "high");

  it("is stable when every run has the same findings, in any order", () => {
    expect(
      checkStability([
        [a, b],
        [b, a],
        [a, b],
      ]),
    ).toEqual({
      runs: 3,
      stable: true,
      differences: [],
    });
  });

  it("names what a later run added and lost", () => {
    const bLow = { ...b, severity: "low" as const };
    const result = checkStability([
      [a, b],
      [a, b],
      [a, bLow],
    ]);
    expect(result.stable).toBe(false);
    expect(result.differences).toEqual([
      {
        run: 3,
        added: ["B@15.2 likely_void/low"],
        removed: ["B@15.2 likely_void/high"],
      },
    ]);
  });

  it("counts duplicate findings", () => {
    expect(checkStability([[a, a], [a]]).stable).toBe(false);
  });

  it("is stable with a single run", () => {
    expect(checkStability([[a]]).stable).toBe(true);
  });
});

describe("caseVerdict and summarise", () => {
  const eos = finding("EOS-BASE-01", "15.6", "likely_void", "high");

  /** A case result built from one expected file and one run repeated `runs` times. */
  function result(exp: Expected, outcome: RunOutcome, runs = 2) {
    const comparison = compareCase(exp, outcome);
    const stability = checkStability(
      Array.from({ length: runs }, () => outcome.findings),
    );
    return { comparison, stability, verdict: caseVerdict(comparison, stability) };
  }

  const passing = () =>
    result(
      expected({
        fields: { annualLeaveDays: 21 },
        findings: [want("EOS-BASE-01", "15.6", "likely_void", "high")],
        score: { employee: [70, 90], hr: [70, 90] },
      }),
      run({ findings: [eos] }),
    );

  /** A case whose only problem finding is not expected: a false positive. */
  const falsePositive = () =>
    result(
      expected(),
      run({
        findings: [finding("TRANSFER-KSA-01", "15.3", "worse_than_default", "medium")],
      }),
    );

  it("passes a case that matches on every check", () => {
    expect(passing().verdict.pass).toBe(true);
  });

  it("fails a case on a score outside its range", () => {
    const { verdict } = result(
      expected({ score: { employee: [90, 100], hr: [0, 100] } }),
      run(),
    );
    expect(verdict.score).toBe(false);
    expect(verdict.pass).toBe(false);
  });

  it("fails a case whose runs differ", () => {
    const comparison = compareCase(expected(), run({ findings: [eos] }));
    const verdict = caseVerdict(comparison, checkStability([[eos], []]));
    expect(verdict.stable).toBe(false);
    expect(verdict.pass).toBe(false);
  });

  it("adds up the bars over all cases", () => {
    const summary = summarise([passing(), falsePositive()]);
    expect(summary.precision.of).toEqual([1, 2]);
    expect(summary.highRecall.of).toEqual([1, 1]);
    expect(summary.fieldAccuracy.of).toEqual([1, 1]);
    expect(summary.bars.find((bar) => bar.name.startsWith("Precision"))?.ok).toBe(false);
    expect(summary.pass).toBe(false);
    // A false positive alone does not fail its case: precision is judged over all cases.
    expect(summary.casesPassed).toBe(2);
  });

  it("passes the precision bar at exactly 90%", () => {
    const nineCorrect = Array.from({ length: 9 }, passing);
    const summary = summarise([...nineCorrect, falsePositive()]);
    expect(summary.precision.value).toBeCloseTo(0.9);
    expect(summary.pass).toBe(true);
  });

  it("treats nothing to measure as a full score", () => {
    const summary = summarise([]);
    expect(summary.highRecall.value).toBe(1);
    expect(summary.precision.value).toBe(1);
    expect(summary.pass).toBe(true);
  });
});
