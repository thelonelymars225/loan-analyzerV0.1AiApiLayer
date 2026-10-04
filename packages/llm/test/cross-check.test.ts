import { describe, expect, it } from "vitest";
import { CrossCheckResult } from "@rater/contracts";
import { crossCheckOffline, HeuristicLlmClient } from "../src/heuristic";
import { recordedContractType } from "../src/heuristic/cross-check";
import {
  CLAUSE_CANDIDATES,
  CROSS_CANDIDATES,
  crossRequest,
  FIXED_TERM_SUMMARY,
  INDEFINITE_SUMMARY,
} from "./fixtures";

const UNLIMITED_PROJECT =
  "This contract is for an unlimited period and ends upon completion of the project in accordance with Article 57 of the Labor Law.";

function conflicts(
  clauses: { number: string; en?: string; ar?: string }[],
  summary: string,
) {
  return CrossCheckResult.parse(crossCheckOffline(crossRequest(clauses, summary)))
    .conflicts;
}

describe("offline cross-check (TYPE-CONFLICT-01)", () => {
  it("flags an unlimited, project-tied clause on a fixed-term contract", () => {
    const found = conflicts(
      [
        { number: "15.1", en: UNLIMITED_PROJECT },
        {
          number: "15.2",
          en: "This contract supersedes all prior agreements between the parties.",
        },
      ],
      FIXED_TERM_SUMMARY,
    );
    expect(found).toEqual([
      expect.objectContaining({
        ruleId: "TYPE-CONFLICT-01",
        clause: "15.1",
        templateClause: "1",
        severity: "high",
        confidence: "high",
        articles: CROSS_CANDIDATES[0]?.articles,
      }),
    ]);
    expect(found[0]?.explanation).toMatch(/fixed-term/);
  });

  it.each([
    "The term of this agreement is open-ended.",
    "This employment contract is of indefinite duration.",
    "The contract shall continue until terminated by either party.",
  ])("flags an indefinite statement on a fixed-term contract: %s", (text) => {
    expect(conflicts([{ number: "15.4", en: text }], FIXED_TERM_SUMMARY)).toHaveLength(1);
  });

  it("points a project end on a fixed-term contract at the end date in clause 5.1", () => {
    const found = conflicts(
      [{ number: "15.2", en: "The employment ends when the project is completed." }],
      FIXED_TERM_SUMMARY,
    );
    expect(found[0]).toMatchObject({ clause: "15.2", templateClause: "5.1" });
  });

  it.each([
    "This contract is valid for one year.",
    "This contract is for a fixed term of two (2) years.",
    UNLIMITED_PROJECT,
  ])("flags a fixed term or project end on an indefinite contract: %s", (text) => {
    expect(conflicts([{ number: "15.1", en: text }], INDEFINITE_SUMMARY)).toHaveLength(1);
  });

  it.each([
    [
      "a fixed term that matches the template",
      "This contract is valid for one year.",
      FIXED_TERM_SUMMARY,
    ],
    [
      "a non-compete period",
      "After the contract ends, the employee shall not work for any competitor for three years.",
      INDEFINITE_SUMMARY,
    ],
    [
      "an open-ended confidentiality duty",
      "Confidentiality obligations continue for an unlimited period after the contract ends.",
      FIXED_TERM_SUMMARY,
    ],
    [
      "a compensation clause",
      "If either party terminates this contract before its expiry without a valid reason, it shall pay compensation equal to two months of basic wage.",
      INDEFINITE_SUMMARY,
    ],
    [
      "an indefinite statement on an indefinite contract",
      "This contract is for an unlimited period.",
      INDEFINITE_SUMMARY,
    ],
  ])("ignores %s", (_name, text, summary) => {
    expect(conflicts([{ number: "15.1", en: text }], summary)).toEqual([]);
  });

  it.each([
    "Site allowance of SAR 500 applies for the duration of the project.",
    "The housing allowance shall continue until the end of the employee's assignment.",
    "The employee may be assigned to project-based tasks.",
  ])("ignores an allowance or a task tied to a project: %s", (text) => {
    for (const summary of [FIXED_TERM_SUMMARY, INDEFINITE_SUMMARY]) {
      expect(conflicts([{ number: "15.1", en: text }], summary)).toEqual([]);
    }
  });

  it("ignores an Arabic allowance that lasts until the project ends", () => {
    const allowance = { number: "15.1", ar: "يستمر بدل السكن حتى انتهاء المشروع." };
    expect(conflicts([allowance], FIXED_TERM_SUMMARY)).toEqual([]);
  });

  it("still flags a project end when the sentence names pay after the contract", () => {
    const text =
      "This contract shall remain in force until the completion of the project, and the employee shall receive a project allowance of SAR 500.";
    expect(conflicts([{ number: "15.1", en: text }], FIXED_TERM_SUMMARY)).toEqual([
      expect.objectContaining({ ruleId: "TYPE-CONFLICT-01", templateClause: "5.1" }),
    ]);
  });

  it("reports nothing when the contract type is unknown", () => {
    const summary = "Contract type: not found. Probation: 90 days.";
    expect(conflicts([{ number: "15.1", en: UNLIMITED_PROJECT }], summary)).toEqual([]);
  });

  it("reports nothing when TYPE-CONFLICT-01 is not a candidate", () => {
    const request = crossRequest(
      [{ number: "15.1", en: UNLIMITED_PROJECT }],
      FIXED_TERM_SUMMARY,
      CLAUSE_CANDIDATES,
    );
    expect(crossCheckOffline(request)).toEqual({ conflicts: [] });
  });

  it("reads an Arabic-only clause with medium confidence", () => {
    const found = conflicts(
      [{ number: "15.1", ar: "هذا العقد لمدة غير محددة وينتهي بانتهاء المشروع." }],
      FIXED_TERM_SUMMARY,
    );
    expect(found).toEqual([
      expect.objectContaining({ clause: "15.1", confidence: "medium" }),
    ]);
  });

  it("works through the client with zero usage", async () => {
    const reply = await new HeuristicLlmClient().crossCheck(
      crossRequest([{ number: "15.1", en: UNLIMITED_PROJECT }], FIXED_TERM_SUMMARY),
    );
    expect(CrossCheckResult.parse(reply.json).conflicts).toHaveLength(1);
    expect(reply.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });
});

describe("recordedContractType", () => {
  it.each([
    ["Contract type: fixed-term. End date: 2026-12-31.", "fixed_term"],
    ["Contract type: indefinite (open-ended). End date: not found.", "indefinite"],
    ["Contract type: for a specific work. End date: not found.", "specific_work"],
    ["Contract type: not found.", null],
    ["Probation: 90 days.", null],
  ])("%s", (summary, expected) => {
    expect(recordedContractType(summary)).toBe(expected);
  });
});
