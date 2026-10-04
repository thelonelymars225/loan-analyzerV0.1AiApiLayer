import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ContractFields, RulesFile, type Rule } from "@rater/contracts";
import { LAW_VERSION, loadCorpus, loadRules, matchesRef, RULESET_VERSION } from "../src";

const rules = loadRules().rules;
const corpus = loadCorpus();
const byId = new Map(rules.map((rule) => [rule.id, rule]));

/** The 19 verified seed rules from test rating #1 (rules-seed.json). */
// prettier-ignore
const SEED_IDS = [
  "PROB-MAX-01", "PROB-EXCL-01", "PROB-NOCOMP-01", "LEAVE-MIN-01", "LEAVE-FORFEIT-01",
  "HOURS-MAX-01", "OT-RATE-01", "EOS-BASE-01", "COMP-ART77-01", "TYPE-CONFLICT-01",
  "TYPE-ART57-01", "RENEW-CONVERT-01", "RENEW-DEADLINE-01", "NOTICE-INDEF-01",
  "TRANSFER-KSA-01", "NONCOMPETE-01", "CONFIDENTIAL-01", "SETTLE-TIME-01", "MARKET-ALLOW-01",
];

/** The calibration table in the build spec: kind, categories and severity, exactly. */
const CALIBRATION: Record<
  string,
  Pick<Rule, "kind" | "categories" | "severityIfFail">
> = {
  "PROB-MAX-01": { kind: "field", categories: ["legal"], severityIfFail: "high" },
  "PROB-EXCL-01": { kind: "field", categories: ["legal"], severityIfFail: "medium" },
  "PROB-NOCOMP-01": { kind: "info", categories: ["legal"], severityIfFail: "none" },
  "LEAVE-MIN-01": { kind: "field", categories: ["legal"], severityIfFail: "high" },
  "LEAVE-FORFEIT-01": { kind: "clause", categories: ["legal"], severityIfFail: "medium" },
  "HOURS-MAX-01": { kind: "field", categories: ["legal"], severityIfFail: "high" },
  "OT-RATE-01": { kind: "field", categories: ["legal"], severityIfFail: "high" },
  "EOS-BASE-01": { kind: "clause", categories: ["legal"], severityIfFail: "high" },
  "COMP-ART77-01": { kind: "clause", categories: ["market"], severityIfFail: "medium" },
  "TYPE-CONFLICT-01": {
    kind: "cross",
    categories: ["legal", "clarity"],
    severityIfFail: "high",
  },
  "TYPE-ART57-01": { kind: "clause", categories: ["clarity"], severityIfFail: "high" },
  "RENEW-CONVERT-01": { kind: "info", categories: ["legal"], severityIfFail: "none" },
  "RENEW-DEADLINE-01": { kind: "field", categories: ["clarity"], severityIfFail: "none" },
  "NOTICE-INDEF-01": { kind: "info", categories: ["legal"], severityIfFail: "none" },
  "TRANSFER-KSA-01": { kind: "clause", categories: ["market"], severityIfFail: "medium" },
  "NONCOMPETE-01": { kind: "clause", categories: ["legal"], severityIfFail: "high" },
  "CONFIDENTIAL-01": { kind: "clause", categories: ["clarity"], severityIfFail: "low" },
  "SETTLE-TIME-01": { kind: "info", categories: ["legal"], severityIfFail: "none" },
  "MARKET-ALLOW-01": { kind: "market", categories: ["market"], severityIfFail: "low" },
};

/** Field rules that Section 15 can also break, so the clause analyser gets them as candidates. */
const FIELD_RULES_WITH_DETECT = [
  "PROB-MAX-01",
  "LEAVE-MIN-01",
  "HOURS-MAX-01",
  "OT-RATE-01",
];

/** RENEW-DEADLINE-01 only produces a Deadline, so it has no finding to praise or fix. */
const DEADLINE_ONLY = "RENEW-DEADLINE-01";

const ALLOWED_PLACEHOLDERS = new Set(["deadline", "days", "limit", "position", "value"]);

function placeholders(text: string | undefined): string[] {
  return [...(text ?? "").matchAll(/\{(\w+)\}/g)].map((match) => match[1]!);
}

/** "Art. 83(1)", "Arts. 109-111", "Exec. Reg. Art. 20", "Contract cl. 14.5" → corpus refs. */
function refsOfCitation(citation: string): { source: string; article: string }[] {
  const regulation = /^Exec\. Reg\. Art\. (\S+)$/.exec(citation);
  if (regulation)
    return [{ source: "implementing_regulations", article: regulation[1]! }];
  const clause = /^Contract cl\. (\S+)$/.exec(citation);
  if (clause) return [{ source: "qiwa_template", article: clause[1]! }];
  const range = /^Arts?\. (\d+)(?:\(\w+\))?(?:-(\d+))?$/.exec(citation);
  if (!range) throw new Error(`Unrecognised citation: ${citation}`);
  const from = Number(range[1]);
  const to = range[2] ? Number(range[2]) : from;
  return Array.from({ length: to - from + 1 }, (_, i) => ({
    source: "labor_law",
    article: String(from + i),
  }));
}

describe("rules.json", () => {
  it("validates against RulesFile as stored on disk", () => {
    const raw: unknown = JSON.parse(
      readFileSync(new URL("../rules/rules.json", import.meta.url), "utf8"),
    );
    expect(RulesFile.safeParse(raw).success).toBe(true);
  });

  it("carries the package's ruleset and law versions", () => {
    expect(loadRules().rulesetVersion).toBe(RULESET_VERSION);
    expect(loadRules().lawVersion).toBe(LAW_VERSION);
    expect(RULESET_VERSION).toBe("0.1.0");
    expect(LAW_VERSION).toBe("2025-11");
  });

  it("has unique rule IDs", () => {
    expect(new Set(rules.map((rule) => rule.id)).size).toBe(rules.length);
  });

  it("keeps all 19 seed rules", () => {
    expect(rules.map((rule) => rule.id).sort()).toEqual([...SEED_IDS].sort());
  });

  it.each(Object.entries(CALIBRATION))(
    "%s matches the calibration table",
    (id, expected) => {
      const rule = byId.get(id)!;
      expect({
        kind: rule.kind,
        categories: rule.categories,
        severityIfFail: rule.severityIfFail,
      }).toEqual(expected);
    },
  );

  it("attaches the SAR impact formulas to the right rules", () => {
    const withImpact = Object.fromEntries(
      rules.filter((rule) => rule.impact).map((rule) => [rule.id, rule.impact]),
    );
    expect(withImpact).toEqual({
      "EOS-BASE-01": "eos_gap",
      "COMP-ART77-01": "art77_gap",
      "LEAVE-MIN-01": "leave_value",
    });
  });

  it("gives every clause and cross rule, and the Section 15-sensitive field rules, a detect text", () => {
    for (const rule of rules) {
      const needsDetect =
        rule.kind === "clause" ||
        rule.kind === "cross" ||
        FIELD_RULES_WITH_DETECT.includes(rule.id);
      expect(Boolean(rule.detect), rule.id).toBe(needsDetect);
    }
  });

  it("reads only real contract fields", () => {
    const fieldNames = Object.keys(ContractFields.shape);
    for (const rule of rules) {
      for (const field of rule.fields) expect(fieldNames, rule.id).toContain(field);
    }
  });

  it("resolves every articleRef to at least one corpus article", () => {
    for (const rule of rules) {
      for (const ref of rule.articleRefs) {
        const hits = corpus.filter((article) => matchesRef(article, ref));
        expect(hits.length, `${rule.id} → ${JSON.stringify(ref)}`).toBeGreaterThan(0);
      }
    }
  });

  it("backs every displayed citation with an articleRef", () => {
    for (const rule of rules) {
      for (const citation of rule.articles) {
        for (const ref of refsOfCitation(citation)) {
          const covered = rule.articleRefs.some(
            (r) => r.source === ref.source && r.article === ref.article,
          );
          expect(covered, `${rule.id}: ${citation}`).toBe(true);
        }
      }
    }
  });

  it("cites the law for every rule except the market convention", () => {
    for (const rule of rules) {
      if (rule.kind === "market") continue;
      expect(rule.articles.length, rule.id).toBeGreaterThan(0);
      expect(rule.articleRefs.length, rule.id).toBeGreaterThan(0);
    }
  });

  it("gives every scored rule something to ask for and suggested wording", () => {
    for (const rule of rules) {
      if (rule.kind === "info" || rule.id === DEADLINE_ONLY) continue;
      expect(rule.askFor, rule.id).toBeTruthy();
      expect(rule.suggestedWording, rule.id).toBeTruthy();
    }
  });

  it("gives field and market rules a 'what's good' message", () => {
    for (const rule of rules) {
      if (rule.kind !== "field" && rule.kind !== "market") continue;
      if (rule.id === DEADLINE_ONLY) continue;
      expect(rule.goodMsg, rule.id).toBeTruthy();
    }
  });

  it("uses only the placeholders the report renderer fills", () => {
    for (const rule of rules) {
      const texts = [
        rule.employeeMsg,
        rule.hrMsg,
        rule.goodMsg,
        rule.askFor,
        rule.suggestedWording,
      ];
      for (const name of texts.flatMap(placeholders)) {
        expect(ALLOWED_PLACEHOLDERS.has(name), `${rule.id}: {${name}}`).toBe(true);
      }
    }
  });

  it("keeps placeholders out of messages the clause analyser can produce", () => {
    // A Section 15 finding has no field value to fill {value} with.
    for (const rule of rules.filter((r) => r.detect)) {
      expect(placeholders(rule.employeeMsg), rule.id).toEqual([]);
      expect(placeholders(rule.hrMsg), rule.id).toEqual([]);
    }
  });

  it("uses {deadline} for the renewal deadline and {position} for the market rule", () => {
    expect(placeholders(byId.get("RENEW-DEADLINE-01")!.employeeMsg)).toEqual([
      "deadline",
    ]);
    expect(placeholders(byId.get("RENEW-DEADLINE-01")!.hrMsg)).toEqual(["deadline"]);
    expect(placeholders(byId.get("MARKET-ALLOW-01")!.employeeMsg)).toEqual(["position"]);
    expect(byId.get("MARKET-ALLOW-01")!.confidence).toBe("medium");
  });

  it("marks every seed rule as verified", () => {
    for (const rule of rules) expect(rule.verified, rule.id).toBe(true);
  });
});
