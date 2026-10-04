import { describe, expect, it } from "vitest";
import type { Verdict } from "@rater/contracts";
import { applyImpact } from "../../src/impact";
import type { AnalysedFinding } from "../../src/types";
import { test1Fields } from "./fixtures";

function finding(overrides: Partial<AnalysedFinding>): AnalysedFinding {
  return {
    ruleId: "X-01",
    clause: "15.1",
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

const eos = (overrides: Partial<AnalysedFinding> = {}) =>
  finding({
    ruleId: "EOS-BASE-01",
    impactKind: "eos_gap",
    impactParams: { eosBase: "basic" },
    ...overrides,
  });

const art77 = (overrides: Partial<AnalysedFinding> = {}) =>
  finding({
    ruleId: "COMP-ART77-01",
    verdict: "worse_than_default",
    severity: "medium",
    categories: ["market"],
    impactKind: "art77_gap",
    impactParams: { compensationMonths: 2, compensationBase: "basic" },
    ...overrides,
  });

describe("applyImpact: end-of-service gap", () => {
  it("matches test #1: total 13500, basic 10000", () => {
    const [result] = applyImpact([eos()], test1Fields());
    expect(result?.impact?.kind).toBe("eos_gap");
    expect(result?.impact?.sar).toEqual({ "1y": 1750, "5y": 8750, "10y": 26250 });
  });

  it("returns plain findings without the analyser's working fields", () => {
    const [result] = applyImpact([eos()], test1Fields());
    expect(result).not.toHaveProperty("impactParams");
    expect(result).not.toHaveProperty("impactKind");
  });

  it("has no impact when the clause uses the actual wage, the wage is unknown or there are no allowances", () => {
    expect(
      applyImpact([eos({ impactParams: { eosBase: "actual" } })], test1Fields())[0]
        ?.impact,
    ).toBeNull();
    expect(applyImpact([eos()], test1Fields({ wage: null }))[0]?.impact).toBeNull();
    const basicOnly = test1Fields({
      wage: { basic: 9000, housing: 0, transport: 0, other: 0, total: 9000 },
    });
    expect(applyImpact([eos()], basicOnly)[0]?.impact).toBeNull();
  });

  it.each<Verdict>(["compliant", "better_than_law"])(
    "gives a %s finding no impact",
    (verdict) => {
      expect(
        applyImpact([eos({ verdict, severity: "none" })], test1Fields())[0]?.impact,
      ).toBeNull();
    },
  );
});

describe("applyImpact: Art. 77 compensation gap", () => {
  it("compares two months' basic with the wages for a 12-month term and escalates to high", () => {
    const [result] = applyImpact([art77()], test1Fields());
    expect(result?.impact?.sar).toEqual({
      contract: 20000,
      default: 162000,
      gap: 142000,
    });
    expect(result?.severity).toBe("high");
  });

  it("keeps the analyser's severity when the gap is under six months of total wage", () => {
    const shortTerm = test1Fields({ termMonths: 6 });
    const [result] = applyImpact(
      [art77({ impactParams: { compensationMonths: 3, compensationBase: "actual" } })],
      shortTerm,
    );
    // default 6 × 13500 = 81000, contract 3 × 13500 = 40500, gap 40500 < 81000
    expect(result?.impact?.sar).toEqual({ contract: 40500, default: 81000, gap: 40500 });
    expect(result?.severity).toBe("medium");
  });

  it("measures an unstated base on the total wage (the law's 'wage' is the actual wage)", () => {
    const [result] = applyImpact(
      [art77({ impactParams: { compensationMonths: 2 } })],
      test1Fields(),
    );
    expect(result?.impact?.sar.contract).toBe(27000);
  });

  it("shows the two-month floor as the default when there is no fixed term", () => {
    const indefinite = test1Fields({
      contractType: "indefinite",
      termMonths: null,
      endDate: null,
    });
    const [result] = applyImpact([art77()], indefinite);
    expect(result?.impact?.sar).toEqual({ contract: 20000, default: 27000, gap: 7000 });
    expect(result?.severity).toBe("medium");
  });

  it("has no impact without the number of months", () => {
    expect(
      applyImpact([art77({ impactParams: {} })], test1Fields())[0]?.impact,
    ).toBeNull();
  });
});

describe("applyImpact: leave value", () => {
  const leave = finding({
    ruleId: "LEAVE-MIN-01",
    impactKind: "leave_value",
    clause: "8.1",
    source: "field_rule",
  });

  it("values the days below 21 at the daily wage (total / 30)", () => {
    const [result] = applyImpact([leave], test1Fields({ annualLeaveDays: 15 }));
    expect(result?.impact).toMatchObject({ kind: "leave_value", sar: { perYear: 2700 } });
  });

  it("has no impact when the contract's leave meets the minimum", () => {
    expect(
      applyImpact([leave], test1Fields({ annualLeaveDays: 21 }))[0]?.impact,
    ).toBeNull();
  });
});

it("leaves findings without an impact formula untouched", () => {
  const plain = finding({
    ruleId: "TRANSFER-KSA-01",
    verdict: "worse_than_default",
    severity: "medium",
  });
  const { impactParams: _p, impactKind: _k, ...expected } = plain;
  expect(applyImpact([plain], test1Fields())).toEqual([expected]);
});
