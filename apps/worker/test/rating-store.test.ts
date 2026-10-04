import { describe, expect, it } from "vitest";
import { REVIEW_RULE_ID } from "@rater/core";
import { reviewReasonsFor, UNANALYSED_CLAUSE_REASON } from "../src/rating-store";

const WAGE_ISSUE = {
  field: "wage",
  message: "Wage parts add up to 9450.00 but the total wage is 10000.00.",
};

describe("reviewReasonsFor", () => {
  it("lists the extraction issues of a needs_review rating", () => {
    expect(
      reviewReasonsFor({
        status: "needs_review",
        extraction: { issues: [WAGE_ISSUE] },
        findings: [{ ruleId: "LEAVE-MIN-01" }],
      }),
    ).toEqual([WAGE_ISSUE.message]);
  });

  it("adds one line when any clause could not be analysed, after the issues", () => {
    expect(
      reviewReasonsFor({
        status: "needs_review",
        extraction: { issues: [WAGE_ISSUE, WAGE_ISSUE] },
        findings: [{ ruleId: REVIEW_RULE_ID }, { ruleId: REVIEW_RULE_ID }],
      }),
    ).toEqual([WAGE_ISSUE.message, UNANALYSED_CLAUSE_REASON]);
  });

  it("is empty for a done rating, even when extraction noted something", () => {
    expect(
      reviewReasonsFor({
        status: "done",
        extraction: { issues: [WAGE_ISSUE] },
        findings: [],
      }),
    ).toEqual([]);
  });
});
