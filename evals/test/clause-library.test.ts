import { describe, expect, it } from "vitest";
import { ClauseAnalysis, CrossCheckResult } from "@rater/contracts";
import type { ContractFields, ContractType, Rule } from "@rater/contracts";
import { clauseCandidates, summariseFields } from "@rater/core";
import { loadRules } from "@rater/law";
import { analyseClauseOffline, crossCheckOffline, type CandidateRule } from "@rater/llm";
import {
  loadClauseLibrary,
  variantsOf,
  type ClauseText,
  type LibraryClause,
} from "../lib/clause-library";

/*
 * Every clause in evals/clause-library.json, and every paraphrase, must get its expected answer
 * from the offline analyser: from the English text, and from the Arabic text alone (the path
 * used when a PDF has no English text layer for Section 15).
 */

const library = loadClauseLibrary();
const rules = loadRules().rules;

function candidate(rule: Rule): CandidateRule {
  return {
    id: rule.id,
    title: rule.title,
    detect: rule.detect ?? rule.title,
    articles: rule.articles,
  };
}

const CLAUSE_CANDIDATES = clauseCandidates(rules).map(candidate);
const CROSS_CANDIDATES = rules.filter((rule) => rule.kind === "cross").map(candidate);

/** Sections 1-14 of an ordinary contract of the given type, with 90 days' probation. */
function fieldSummary(contractType: ContractType): string {
  const fixed = contractType === "fixed_term";
  const fields: ContractFields = {
    contractType,
    contractTypeRaw: null,
    executionDate: "2026-01-01",
    commencementDate: "2026-01-01",
    endDate: fixed ? "2026-12-31" : null,
    termMonths: fixed ? 12 : null,
    autoRenew: fixed ? true : null,
    renewalNoticeDays: fixed ? 30 : null,
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
  return summariseFields(fields);
}

function analyse(text: { en?: string; ar?: string }) {
  const reply = analyseClauseOffline({
    clause: { number: "15.1", textEn: text.en ?? "", textAr: text.ar ?? null },
    fieldSummary: fieldSummary("fixed_term"),
    candidateRules: CLAUSE_CANDIDATES,
    articles: [],
  });
  return ClauseAnalysis.parse(reply).matches;
}

function expectedAnswer(clause: LibraryClause) {
  if (clause.expected === null) return [];
  const { ruleId, verdict, severity, impactParams } = clause.expected;
  return [{ ruleId, verdict, severity, impactParams }];
}

const texts = library.clauses.flatMap((clause) =>
  variantsOf(clause).map((text: ClauseText, index) => ({
    name: `${clause.key} #${index}`,
    clause,
    text,
  })),
);

describe("clause library", () => {
  it("has every row of the spec's Section 15 table", () => {
    expect(library.clauses.map((clause) => clause.key)).toEqual(
      expect.arrayContaining([
        "eos_basic",
        "eos_actual",
        "comp_two_months_basic",
        "comp_three_months_actual",
        "transfer_anywhere",
        "leave_no_carry",
        "leave_forfeit",
        "ot_25",
        "ot_lieu",
        "noncompete_3y",
        "noncompete_ok",
        "confidential_unlimited",
        "unlimited_project",
        "probation_270",
        "leave_15",
        "supersedes",
        "dress_code",
        "ambiguous_extra_hours",
      ]),
    );
  });

  it("only names rules that exist", () => {
    const ids = new Set(rules.map((rule) => rule.id));
    for (const clause of library.clauses) {
      if (clause.expected) expect(ids).toContain(clause.expected.ruleId);
      if (clause.crossCheck) expect(ids).toContain(clause.crossCheck.ruleId);
    }
  });

  it("has a 'not allowed to share' confidentiality paraphrase", () => {
    const confidential = library.clauses.find((c) => c.key === "confidential_unlimited");
    expect(confidential?.paraphrases.map((p) => p.en).join(" ")).toMatch(
      /not allowed to share/,
    );
  });

  it("has no text twice", () => {
    const english = texts.map(({ text }) => text.en);
    expect(new Set(english).size).toBe(english.length);
  });
});

describe("offline analyser on the clause library: English", () => {
  it.each(texts)("$name", ({ clause, text }) => {
    const matches = analyse({ en: text.en });
    expect(
      matches.map(({ ruleId, verdict, severity, impactParams }) => ({
        ruleId,
        verdict,
        severity,
        impactParams,
      })),
    ).toEqual(expectedAnswer(clause));
  });
});

describe("offline analyser on the clause library: Arabic only", () => {
  it.each(texts)("$name", ({ clause, text }) => {
    const matches = analyse({ ar: text.ar });
    expect(
      matches.map(({ ruleId, verdict, severity }) => ({ ruleId, verdict, severity })),
    ).toEqual(
      expectedAnswer(clause).map(({ ruleId, verdict, severity }) => ({
        ruleId,
        verdict,
        severity,
      })),
    );
  });
});

describe("offline cross-check on the clause library", () => {
  const crossRows = texts.filter(({ clause }) => clause.crossCheck);

  it("has at least one clause that contradicts the contract type", () => {
    expect(crossRows.length).toBeGreaterThan(0);
  });

  it.each(crossRows)("$name", ({ clause, text }) => {
    const conflict = clause.crossCheck!;
    const reply = crossCheckOffline({
      fieldSummary: fieldSummary(conflict.contractType),
      clauses: [{ number: "15.1", textEn: text.en, textAr: null }],
      candidateRules: CROSS_CANDIDATES,
      articles: [],
    });
    const conflicts = CrossCheckResult.parse(reply).conflicts;
    expect(conflicts.map(({ ruleId, severity }) => ({ ruleId, severity }))).toEqual([
      { ruleId: conflict.ruleId, severity: conflict.severity },
    ]);
  });

  it("finds no type conflict in the other clauses", () => {
    const others = texts.filter(({ clause }) => !clause.crossCheck);
    const reply = crossCheckOffline({
      fieldSummary: fieldSummary("fixed_term"),
      clauses: others.map(({ text }, index) => ({
        number: `15.${index + 1}`,
        textEn: text.en,
        textAr: null,
      })),
      candidateRules: CROSS_CANDIDATES,
      articles: [],
    });
    expect(CrossCheckResult.parse(reply).conflicts).toEqual([]);
  });
});
