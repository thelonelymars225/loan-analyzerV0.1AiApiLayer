import { describe, expect, it } from "vitest";
import type { Finding } from "@rater/contracts";
import {
  bandFor,
  overallCap,
  overallFor,
  scoreFindings,
  subScores,
} from "../../src/score";

function finding(overrides: Partial<Finding>): Finding {
  return {
    ruleId: "X-01",
    clause: null,
    verdict: "likely_void",
    severity: "high",
    confidence: "high",
    categories: ["legal"],
    articles: [],
    impact: null,
    explanation: "e",
    employeeMsg: "m",
    hrMsg: "h",
    source: "clause",
    needsReview: false,
    ...overrides,
  };
}

describe("subScores", () => {
  it("starts every category at 100", () => {
    expect(subScores([])).toEqual({ legal: 100, market: 100, clarity: 100 });
  });

  it("takes 20 / 8 / 3 / 0 points off by severity", () => {
    const sub = subScores([
      finding({ severity: "high" }),
      finding({ severity: "medium", categories: ["market"] }),
      finding({ severity: "low", categories: ["clarity"] }),
      finding({ severity: "none", categories: ["clarity"] }),
    ]);
    expect(sub).toEqual({ legal: 80, market: 92, clarity: 97 });
  });

  it("charges a finding against every category it lists", () => {
    expect(
      subScores([finding({ verdict: "conflict", categories: ["legal", "clarity"] })]),
    ).toEqual({
      legal: 80,
      market: 100,
      clarity: 80,
    });
  });

  it("counts every problem verdict and no passing one", () => {
    const problems = (
      ["likely_void", "conflict", "worse_than_default", "unclear"] as const
    ).map((verdict) => finding({ verdict, severity: "low" }));
    expect(subScores(problems).legal).toBe(88);
    expect(subScores([finding({ verdict: "compliant", severity: "high" })]).legal).toBe(
      100,
    );
  });

  it("adds 2 to the first category for each better-than-law finding", () => {
    const better = finding({
      verdict: "better_than_law",
      severity: "none",
      categories: ["legal", "market"],
    });
    const sub = subScores([finding({ severity: "high" }), better, better]);
    expect(sub).toEqual({ legal: 84, market: 100, clarity: 100 });
  });

  it("never lets info findings change the score", () => {
    const info = finding({ source: "info", verdict: "unclear", severity: "high" });
    expect(subScores([info])).toEqual({ legal: 100, market: 100, clarity: 100 });
  });

  it("clamps to 0..100", () => {
    const many = Array.from({ length: 7 }, () => finding({ severity: "high" }));
    const better = Array.from({ length: 5 }, () =>
      finding({ verdict: "better_than_law", severity: "none", categories: ["market"] }),
    );
    expect(subScores([...many, ...better])).toEqual({
      legal: 0,
      market: 100,
      clarity: 100,
    });
  });
});

describe("overallFor", () => {
  it("weights legal / market / clarity 40/35/25 for employees and 60/10/30 for HR", () => {
    const sub = { legal: 61, market: 72, clarity: 57 };
    expect(overallFor(sub, "employee")).toEqual({ overall: 64, band: "Fair" });
    expect(overallFor(sub, "hr")).toEqual({ overall: 61, band: "Fair" });
  });
});

describe("bandFor", () => {
  it.each([
    [100, "Good"],
    [80, "Good"],
    [79, "Fair"],
    [60, "Fair"],
    [59, "Weak"],
    [40, "Weak"],
    [39, "Poor"],
    [0, "Poor"],
  ] as const)("puts %i in %s", (overall, band) => {
    expect(bandFor(overall)).toBe(band);
  });
});

describe("overall caps", () => {
  const voidHigh = finding({ verdict: "likely_void", severity: "high" });
  const conflictHigh = finding({
    verdict: "conflict",
    severity: "high",
    categories: ["market"],
  });
  const better = finding({
    verdict: "better_than_law",
    severity: "none",
    categories: ["legal"],
  });

  it("caps at 79 (Fair) with one or two high void or conflict findings, in both views", () => {
    // Uncapped: legal 80 + 2 = 82 → employee 93, HR 89.
    for (const view of ["employee", "hr"] as const) {
      expect(scoreFindings([voidHigh, better], view)).toMatchObject({
        overall: 79,
        band: "Fair",
        legal: 82,
      });
    }
    expect(overallCap([voidHigh, conflictHigh])).toBe(79);
  });

  it("caps at 59 (Weak) with three or more", () => {
    const three = [voidHigh, conflictHigh, finding({ categories: ["clarity"] })];
    expect(overallCap(three)).toBe(59);
    expect(scoreFindings(three, "employee")).toMatchObject({ overall: 59, band: "Weak" });
  });

  it("does not count lower severities, other verdicts or info findings", () => {
    expect(
      overallCap([
        finding({ severity: "medium" }),
        finding({ verdict: "unclear", severity: "high" }),
        finding({ verdict: "worse_than_default", severity: "high" }),
        finding({ source: "info" }),
      ]),
    ).toBe(100);
  });

  it("never raises a score that is already lower", () => {
    const many = Array.from({ length: 4 }, () => voidHigh);
    expect(scoreFindings(many, "hr").overall).toBe(
      overallFor(subScores(many), "hr").overall,
    );
  });
});

describe("scoreFindings", () => {
  it("returns sub-scores, overall, band, view and low market confidence", () => {
    expect(scoreFindings([finding({ severity: "medium" })], "hr")).toEqual({
      legal: 92,
      market: 100,
      clarity: 100,
      overall: 95,
      band: "Good",
      view: "hr",
      marketConfidence: "low",
    });
  });
});
