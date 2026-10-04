import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RulesFile } from "@rater/contracts";
import { applyImpact } from "../../src/impact";
import { FIELD_CHECKS, runFieldRules } from "../../src/rules";
import { scoreFindings } from "../../src/score";
import {
  analyseSection15,
  crossCheckSection15,
  MemoryClauseCache,
} from "../../src/section15";
import {
  FakeArticleLookup,
  FakeLlmClient,
  TEST1_CLAUSES,
  TEST1_CROSS,
  TEST1_REPLIES,
  TODAY,
  test1Fields,
} from "./fixtures";

/*
 * The engine against the real rules table (packages/law/rules/rules.json). Core does not
 * import @rater/law, so the file is read directly; the suite is skipped if it is missing.
 */
const RULES_PATH = fileURLToPath(
  new URL("../../../law/rules/rules.json", import.meta.url),
);
const ALLOWED_PLACEHOLDERS = new Set(["deadline", "days", "limit", "position", "value"]);

describe.skipIf(!existsSync(RULES_PATH))("the real rules table", () => {
  const table = () => RulesFile.parse(JSON.parse(readFileSync(RULES_PATH, "utf8")));

  it("has a check function for every field and market rule (the deadline rule makes a date)", () => {
    const missing = table()
      .rules.filter(
        (r) => (r.kind === "field" || r.kind === "market") && !FIELD_CHECKS[r.id],
      )
      .map((r) => r.id);
    expect(missing).toEqual(["RENEW-DEADLINE-01"]);
  });

  it("uses only the placeholders the engine fills", () => {
    const used = table().rules.flatMap((r) =>
      [
        r.employeeMsg,
        r.hrMsg,
        r.goodMsg ?? "",
        r.askFor ?? "",
        r.suggestedWording ?? "",
      ].flatMap((text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1])),
    );
    expect(used.filter((name) => !ALLOWED_PLACEHOLDERS.has(name ?? ""))).toEqual([]);
  });

  it("leaves no placeholder unfilled in test #1's field findings and deadlines", () => {
    const { findings, deadlines } = runFieldRules(test1Fields(), table().rules, {
      today: TODAY,
    });
    const texts = [
      ...findings.flatMap((f) => [f.employeeMsg, f.hrMsg]),
      ...deadlines.flatMap((d) => [d.employeeMsg, d.hrMsg]),
    ];
    expect(texts.filter((text) => /\{\w+\}/.test(text))).toEqual([]);
  });

  it("scores test #1 at employee ≈ 64 and HR ≈ 61", async () => {
    const { rules } = table();
    const fields = test1Fields();
    const input = {
      clauses: TEST1_CLAUSES,
      fields,
      rules,
      llm: new FakeLlmClient({ clauses: TEST1_REPLIES, cross: TEST1_CROSS }),
      articles: new FakeArticleLookup(),
      cache: new MemoryClauseCache(),
      versions: { law: "2025-11", ruleset: "0.1.0" },
    };
    const field = runFieldRules(fields, rules, { today: TODAY });
    const section15 = await analyseSection15(input);
    const cross = await crossCheckSection15(input);
    expect(
      [...section15.findings, ...cross.findings].some((f) => f.ruleId === "REVIEW-00"),
    ).toBe(false);

    const impactByRule = new Map(rules.map((r) => [r.id, r.impact]));
    const findings = applyImpact(
      [
        ...field.findings.map((f) => ({ ...f, impactKind: impactByRule.get(f.ruleId) })),
        ...section15.findings,
        ...cross.findings,
      ],
      fields,
    );
    expect(scoreFindings(findings, "employee").overall).toBe(64);
    expect(scoreFindings(findings, "hr").overall).toBe(61);
  });
});
