import { describe, expect, it } from "vitest";
import type { ContractFields, Finding } from "@rater/contracts";
import { FIELD_CHECKS, runFieldRules, summariseFields } from "../../src/rules";
import { RULES, TODAY, test1Fields } from "./fixtures";

function findingFor(fields: ContractFields, ruleId: string): Finding | undefined {
  return runFieldRules(fields, RULES, { today: TODAY }).findings.find(
    (f) => f.ruleId === ruleId,
  );
}

describe("runFieldRules: field checks", () => {
  it("rates test #1's fields as in the report", () => {
    const { findings } = runFieldRules(test1Fields(), RULES, { today: TODAY });
    const summary = findings.map((f) => [
      f.ruleId,
      f.clause,
      f.verdict,
      f.severity,
      f.source,
    ]);
    expect(summary).toEqual([
      ["PROB-MAX-01", "6.1", "compliant", "none", "field_rule"],
      ["PROB-EXCL-01", "6.1", "compliant", "none", "field_rule"],
      ["PROB-NOCOMP-01", "6.2", "compliant", "none", "info"],
      ["LEAVE-MIN-01", "8.1", "better_than_law", "none", "field_rule"],
      ["HOURS-MAX-01", "7", "better_than_law", "none", "field_rule"],
      ["OT-RATE-01", "11.2", "compliant", "none", "field_rule"],
      ["RENEW-CONVERT-01", "5.1", "compliant", "none", "info"],
      ["SETTLE-TIME-01", null, "compliant", "none", "info"],
      ["MARKET-ALLOW-01", "9.1.1", "compliant", "none", "market"],
    ]);
  });

  it("never turns RENEW-DEADLINE-01 into a finding", () => {
    const { findings } = runFieldRules(test1Fields(), RULES, { today: TODAY });
    expect(findings.some((f) => f.ruleId === "RENEW-DEADLINE-01")).toBe(false);
  });

  it.each([
    [
      "probation over 180 days",
      { probationDays: 270 },
      "PROB-MAX-01",
      "likely_void",
      "high",
    ],
    [
      "probation under 180 days",
      { probationDays: 90 },
      "PROB-MAX-01",
      "better_than_law",
      "none",
    ],
    [
      "leave under 21 days",
      { annualLeaveDays: 15 },
      "LEAVE-MIN-01",
      "likely_void",
      "high",
    ],
    [
      "leave of exactly 21 days",
      { annualLeaveDays: 21 },
      "LEAVE-MIN-01",
      "compliant",
      "none",
    ],
    [
      "more than 48 hours a week",
      { weeklyHours: 54, dailyHours: 9 },
      "HOURS-MAX-01",
      "likely_void",
      "high",
    ],
    [
      "more than 8 hours a day",
      { weeklyHours: 45, dailyHours: 9, workDaysPerWeek: 5 },
      "HOURS-MAX-01",
      "likely_void",
      "high",
    ],
    [
      "exactly 48 hours a week",
      { weeklyHours: 48, workDaysPerWeek: 6 },
      "HOURS-MAX-01",
      "compliant",
      "none",
    ],
    [
      "overtime premium under 50%",
      { overtimePremiumPct: 25 },
      "OT-RATE-01",
      "likely_void",
      "high",
    ],
    [
      "overtime premium over 50%",
      { overtimePremiumPct: 75 },
      "OT-RATE-01",
      "better_than_law",
      "none",
    ],
    [
      "an unlisted day pausing probation",
      { probationExcludedDays: ["eid_al_fitr", "other"] },
      "PROB-EXCL-01",
      "likely_void",
      "medium",
    ],
  ] as const)("rates %s", (_name, overrides, ruleId, verdict, severity) => {
    const finding = findingFor(test1Fields(overrides as Partial<ContractFields>), ruleId);
    expect(finding).toMatchObject({ verdict, severity });
  });

  it("works out weekly hours from the day and the working days when the week is missing", () => {
    const finding = findingFor(
      test1Fields({ weeklyHours: null, dailyHours: 8, workDaysPerWeek: 6 }),
      "HOURS-MAX-01",
    );
    expect(finding?.verdict).toBe("compliant");
    expect(finding?.explanation).toContain("48 a week");
  });

  it("uses the rule's problem messages, ask and wording for a failing check", () => {
    const finding = findingFor(test1Fields({ probationDays: 270 }), "PROB-MAX-01");
    expect(finding).toMatchObject({
      employeeMsg: "Your probation is longer than 180 days.",
      hrMsg: "PROB-MAX-01 HR message.",
      askFor: "Ask for 180 days or less.",
      suggestedWording: "Probation of [N] days, at most 180.",
      articles: ["Art. 53"],
    });
  });

  it("uses the filled goodMsg for the employee and the title for HR when a check passes", () => {
    const finding = findingFor(test1Fields(), "LEAVE-MIN-01");
    expect(finding?.employeeMsg).toBe("You get 22 days of annual leave a year.");
    expect(finding?.hrMsg).toBe("At least 21 days' annual leave");
    expect(finding?.askFor).toBeUndefined();
  });

  it("falls back to the title when the goodMsg needs a value the contract doesn't give", () => {
    const fields = test1Fields({
      weeklyHours: null,
      workDaysPerWeek: null,
      dailyHours: 7,
    });
    const finding = findingFor(fields, "HOURS-MAX-01");
    expect(finding?.verdict).toBe("better_than_law");
    expect(finding?.employeeMsg).toBe("Normal hours within 8 a day and 48 a week");
  });

  it("skips a check whose field was not extracted", () => {
    const fields = test1Fields({
      probationDays: null,
      overtimePremiumPct: null,
      wage: null,
    });
    const ids = runFieldRules(fields, RULES, { today: TODAY }).findings.map(
      (f) => f.ruleId,
    );
    expect(ids).not.toContain("PROB-MAX-01");
    expect(ids).not.toContain("OT-RATE-01");
    expect(ids).not.toContain("MARKET-ALLOW-01");
  });

  it("ignores clause and cross rules, and field rules with no check function", () => {
    const unknown = { ...RULES[0]!, id: "NEW-FIELD-01" };
    const { findings } = runFieldRules(
      test1Fields(),
      [unknown, ...RULES.filter((r) => r.kind === "clause" || r.kind === "cross")],
      {
        today: TODAY,
      },
    );
    expect(findings).toEqual([]);
  });

  it("has a check function for every field and market rule except the deadline", () => {
    const withoutCheck = RULES.filter(
      (r) => (r.kind === "field" || r.kind === "market") && !FIELD_CHECKS[r.id],
    );
    expect(withoutCheck.map((r) => r.id)).toEqual(["RENEW-DEADLINE-01"]);
  });
});

describe("runFieldRules: market allowances", () => {
  const withWage = (housing: number, transport: number) =>
    findingFor(
      test1Fields({
        wage: {
          basic: 10000,
          housing,
          transport,
          other: 0,
          total: 10000 + housing + transport,
        },
      }),
      "MARKET-ALLOW-01",
    );

  it("is compliant within the tolerance and fills {position}", () => {
    const finding = withWage(2200, 800);
    expect(finding).toMatchObject({
      verdict: "compliant",
      severity: "none",
      confidence: "medium",
    });
    expect(finding?.employeeMsg).toBe(
      "Your allowances are in line with the usual split.",
    );
  });

  it("is worse than the default (low) when either allowance is below the norm", () => {
    const finding = withWage(3500, 500);
    expect(finding).toMatchObject({
      verdict: "worse_than_default",
      severity: "low",
      source: "market",
    });
    expect(finding?.hrMsg).toBe("The allowance split is below the market convention.");
  });

  it("is better than the norm when one is above and none below", () => {
    expect(withWage(3500, 1000)?.verdict).toBe("better_than_law");
  });
});

describe("runFieldRules: info rules", () => {
  const infoIds = (fields: ContractFields) =>
    runFieldRules(fields, RULES, { today: TODAY })
      .findings.filter((f) => f.source === "info")
      .map((f) => f.ruleId);

  it("shows the renewal-conversion rule only to Saudi workers on fixed-term contracts", () => {
    expect(infoIds(test1Fields())).toContain("RENEW-CONVERT-01");
    expect(infoIds(test1Fields({ nationality: "non_saudi" }))).not.toContain(
      "RENEW-CONVERT-01",
    );
    expect(infoIds(test1Fields({ contractType: "indefinite" }))).not.toContain(
      "RENEW-CONVERT-01",
    );
  });

  it("shows the notice-period rule only on indefinite contracts", () => {
    expect(infoIds(test1Fields())).not.toContain("NOTICE-INDEF-01");
    expect(infoIds(test1Fields({ contractType: "indefinite", endDate: null }))).toContain(
      "NOTICE-INDEF-01",
    );
  });

  it("always shows the settlement rule, with the rule's own message", () => {
    const { findings } = runFieldRules(test1Fields(), RULES, { today: TODAY });
    expect(findings.find((f) => f.ruleId === "SETTLE-TIME-01")).toMatchObject({
      severity: "none",
      employeeMsg: "SETTLE-TIME-01 employee message.",
    });
  });

  it("drops the probation rule when there is no probation", () => {
    expect(infoIds(test1Fields({ probationDays: 0 }))).not.toContain("PROB-NOCOMP-01");
  });
});

describe("runFieldRules: deadlines", () => {
  const deadlines = (overrides: Partial<ContractFields>, today = TODAY) =>
    runFieldRules(test1Fields(overrides), RULES, { today }).deadlines;
  const renewal = (overrides: Partial<ContractFields>, today = TODAY) =>
    deadlines(overrides, today).find((d) => d.kind === "renewal_notice");

  it("puts the renewal notice deadline renewalNoticeDays before the end date", () => {
    expect(renewal({ endDate: "2027-01-10", renewalNoticeDays: 30 })).toEqual({
      ruleId: "RENEW-DEADLINE-01",
      date: "2026-12-11",
      kind: "renewal_notice",
      employeeMsg: "Give notice on Qiwa by 2026-12-11.",
      hrMsg: "Non-renewal notice is due by 2026-12-11.",
    });
  });

  it("rolls a passed deadline forward by one term on an auto-renewing contract", () => {
    expect(
      renewal({ endDate: "2026-03-01", renewalNoticeDays: 30, termMonths: 12 })?.date,
    ).toBe("2027-01-30");
  });

  it("rolls forward several terms without month-end drift", () => {
    const date = renewal({
      endDate: "2024-02-29",
      renewalNoticeDays: 60,
      termMonths: 12,
    })?.date;
    // 2027-02-28 (three terms on) minus 60 days.
    expect(date).toBe("2026-12-30");
  });

  it("keeps a deadline that falls today", () => {
    expect(renewal({ endDate: "2026-11-02", renewalNoticeDays: 30 })?.date).toBe(TODAY);
  });

  it("does not roll when renewal is unknown, and gives no deadline when the contract does not renew", () => {
    expect(renewal({ endDate: "2026-03-01", autoRenew: null })?.date).toBe("2026-01-30");
    expect(renewal({ endDate: "2026-03-01", autoRenew: false })).toBeUndefined();
  });

  it("gives no renewal deadline without an end date or a notice period", () => {
    expect(renewal({ endDate: null })).toBeUndefined();
    expect(renewal({ renewalNoticeDays: null })).toBeUndefined();
  });

  it("gives the last day of probation while it is still ahead", () => {
    const probation = deadlines({
      commencementDate: "2026-09-01",
      probationDays: 180,
    }).find((d) => d.kind === "probation_end");
    expect(probation).toMatchObject({ ruleId: "PROB-NOCOMP-01", date: "2027-02-27" });
    expect(probation?.employeeMsg).toContain("2027-02-27");
  });

  it("drops a probation that has ended or does not exist", () => {
    const kinds = (o: Partial<ContractFields>) => deadlines(o).map((d) => d.kind);
    expect(kinds({ commencementDate: "2025-01-01", probationDays: 90 })).not.toContain(
      "probation_end",
    );
    expect(kinds({ commencementDate: "2026-09-01", probationDays: 0 })).not.toContain(
      "probation_end",
    );
  });

  it("sorts deadlines by date", () => {
    const list = deadlines({
      commencementDate: "2026-09-01",
      probationDays: 60,
      endDate: "2027-01-10",
    });
    expect(list.map((d) => d.kind)).toEqual(["probation_end", "renewal_notice"]);
  });
});

describe("summariseFields", () => {
  it("states the terms the analyser needs", () => {
    const summary = summariseFields(test1Fields());
    expect(summary).toContain("Contract type: fixed-term.");
    expect(summary).toContain("Term: 12 months.");
    expect(summary).toContain("Annual leave: 22 days a year.");
    expect(summary).toContain("basic 10,000");
    expect(summary).toContain("total 13,500");
  });

  it("leaves out nationality, occupation and work location", () => {
    const summary = summariseFields(
      test1Fields({ occupation: "Pilot", workLocation: "Abha" }),
    );
    expect(summary).not.toMatch(/Pilot|Abha|saudi/i);
  });

  it("says when a value was not found", () => {
    const summary = summariseFields(test1Fields({ probationDays: null, wage: null }));
    expect(summary).toContain("Probation: not found.");
    expect(summary).toContain("Monthly wage: not found.");
  });
});
