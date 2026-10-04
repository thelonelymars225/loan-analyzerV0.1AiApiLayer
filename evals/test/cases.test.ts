import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadRules } from "@rater/law";
import { CASES_DIR, caseDirs, readCaseFile, readExpected } from "../lib/cases";
import { findLibraryClause, loadClauseLibrary } from "../lib/clause-library";
import type { Expected, ExpectedFinding } from "../lib/expected";

/*
 * The committed cases are well formed, take their Section 15 text from the clause library,
 * agree with it, and together cover what the Build Plan asks of the eval set.
 */

const library = loadClauseLibrary();
const rules = loadRules().rules;

const cases = caseDirs(CASES_DIR).map((dir) => {
  const id = dir.split("/").pop() ?? dir;
  const casePath = join(dir, "case.json");
  return {
    id,
    dir,
    casePath,
    raw: JSON.parse(readFileSync(casePath, "utf8")) as unknown,
    caseFile: readCaseFile(casePath),
    expected: readExpected(join(dir, "expected.json")),
  };
});

const isProblem = (finding: ExpectedFinding) =>
  finding.verdict !== "compliant" && finding.verdict !== "better_than_law";

/** Keys in `raw` that the schema dropped, e.g. a misspelt field that would silently default. */
function unknownKeys(raw: unknown, parsed: unknown, path = ""): string[] {
  if (Array.isArray(raw) && Array.isArray(parsed)) {
    return raw.flatMap((item, i) => unknownKeys(item, parsed[i], `${path}[${i}]`));
  }
  if (typeof raw !== "object" || raw === null) return [];
  const known = (parsed ?? {}) as Record<string, unknown>;
  return Object.entries(raw).flatMap(([key, value]) =>
    key in known ? unknownKeys(value, known[key], `${path}.${key}`) : [`${path}.${key}`],
  );
}

describe("eval cases on disk", () => {
  it("has at least 12 cases", () => {
    expect(cases.length).toBeGreaterThanOrEqual(12);
  });

  it.each(cases)("$id: files and ids agree", ({ id, dir, caseFile, expected }) => {
    expect(existsSync(join(dir, "contract.pdf"))).toBe(true);
    expect(caseFile.spec.id).toBe(id);
    expect(expected.id).toBe(id);
  });

  it.each(cases)("$id: case.json has no unknown keys", ({ raw, caseFile }) => {
    expect(unknownKeys(raw, caseFile.spec)).toEqual([]);
  });

  it.each(cases)("$id: names only rules that exist", ({ expected }) => {
    const ids = new Set(rules.map((rule) => rule.id));
    const named = [
      ...expected.findings.map((f) => f.ruleId),
      ...expected.mustNot,
      ...(expected.deadlines ?? []).map((d) => d.ruleId),
    ];
    expect(named.filter((id) => !ids.has(id))).toEqual([]);
  });

  it.each(cases)(
    "$id: mustNot does not contradict the expected problems",
    ({ expected }) => {
      const problems = expected.findings.filter(isProblem).map((f) => f.ruleId);
      expect(expected.mustNot.filter((id) => problems.includes(id))).toEqual([]);
    },
  );

  it.each(cases)("$id: uses only synthetic personal data", ({ casePath }) => {
    const text = readFileSync(casePath, "utf8");
    // IDs and unified numbers are obviously made up: 1, 2 or 7, then five zeros.
    const tenDigits = text.match(/\b\d{10}\b/g) ?? [];
    expect(tenDigits.filter((n) => !/^[127]0{5}\d{4}$/.test(n))).toEqual([]);
    const emails = text.match(/[\w.+-]+@[\w.-]+/g) ?? [];
    expect(emails.filter((e) => !/(^|\.|@)example\.com$/.test(e))).toEqual([]);
    expect(text).not.toMatch(/SA(?!0{22})\d{22}/);
  });
});

describe("Section 15 of each case comes from the clause library", () => {
  const qiwaCases = cases.flatMap(({ id, caseFile, expected }) =>
    caseFile.kind === "qiwa" ? [{ id, spec: caseFile.spec, expected }] : [],
  );

  it.each(qiwaCases)("$id", ({ spec, expected }) => {
    spec.section15.forEach((text, index) => {
      const number = `15.${index + 1}`;
      const clause = findLibraryClause(library, text);
      expect(clause, `${number} is not in clause-library.json`).not.toBeNull();
      const found = expected.findings.filter((f) => f.clause === number);

      // The library's answer for this clause is expected, at this clause number.
      const libraryAnswer = clause!.expected;
      if (libraryAnswer) {
        const match = found.find((f) => f.ruleId === libraryAnswer.ruleId);
        expect(match, `${number}: ${libraryAnswer.ruleId} not expected`).toBeDefined();
        expect(match!.verdict).toBe(libraryAnswer.verdict);
        // Only the impact step changes a severity: COMP-ART77-01 can be raised to high.
        if (match!.ruleId !== "COMP-ART77-01") {
          expect(match!.severity).toBe(libraryAnswer.severity);
        }
      }
      const conflict = clause!.crossCheck;
      if (conflict && conflict.contractType === spec.contract.type) {
        expect(found).toContainEqual({
          ruleId: conflict.ruleId,
          clause: number,
          verdict: conflict.verdict,
          severity: conflict.severity,
        });
      }

      // And nothing else is expected at this clause number.
      const allowed = [libraryAnswer?.ruleId, conflict?.ruleId];
      expect(found.filter((f) => !allowed.includes(f.ruleId))).toEqual([]);
    });
  });

  it("no expected finding points at a Section 15 clause the case does not have", () => {
    for (const { spec, expected } of qiwaCases) {
      const numbers = spec.section15.map((_, index) => `15.${index + 1}`);
      const s15 = expected.findings.filter((f) => f.clause?.startsWith("15."));
      expect(s15.filter((f) => !numbers.includes(f.clause!))).toEqual([]);
    }
  });
});

describe("what the Build Plan asks of the eval set", () => {
  const firstTen = cases.slice(0, 10).map((c) => c.expected);
  const findingsOf = (list: Expected[]) => list.flatMap((e) => e.findings);
  const deadlinesOf = (list: Expected[]) => list.flatMap((e) => e.deadlines ?? []);

  it("the first 10 cases cover every seed rule", () => {
    const covered = new Set([
      ...findingsOf(firstTen).map((f) => f.ruleId),
      ...deadlinesOf(firstTen).map((d) => d.ruleId),
    ]);
    const missing = rules.map((rule) => rule.id).filter((id) => !covered.has(id));
    expect(missing).toEqual([]);
    expect(rules).toHaveLength(19);
  });

  it("the first 10 cases have every field rule both failing and passing", () => {
    const fieldRules = rules.filter(
      (rule) => rule.kind === "field" && rule.severityIfFail !== "none",
    );
    for (const rule of fieldRules) {
      const findings = findingsOf(firstTen).filter((f) => f.ruleId === rule.id);
      expect(
        findings.some((f) => f.verdict === "likely_void"),
        `${rule.id} fails`,
      ).toBe(true);
      expect(
        findings.some((f) => !isProblem(f)),
        `${rule.id} passes`,
      ).toBe(true);
    }
  });

  it("the first 10 cases have every info rule, the market norm missed, and both deadlines", () => {
    const findings = findingsOf(firstTen);
    for (const rule of rules.filter((r) => r.kind === "info")) {
      expect(
        findings.some((f) => f.ruleId === rule.id && f.verdict === "compliant"),
      ).toBe(true);
    }
    expect(findings).toContainEqual({
      ruleId: "MARKET-ALLOW-01",
      clause: "9.1.1",
      verdict: "worse_than_default",
      severity: "low",
    });
    const deadlineRules = new Set(deadlinesOf(firstTen).map((d) => d.ruleId));
    expect([...deadlineRules].sort()).toEqual(["PROB-NOCOMP-01", "RENEW-DEADLINE-01"]);
  });

  it("has at least two clean contracts that must score 85 or more in both views", () => {
    const clean = cases.filter(({ expected }) => {
      const seriousProblem = expected.findings.some(
        (f) => isProblem(f) && f.severity !== "low",
      );
      const score = expected.score;
      return (
        !seriousProblem &&
        score !== undefined &&
        score.employee[0] >= 85 &&
        score.hr[0] >= 85
      );
    });
    expect(clean.length).toBeGreaterThanOrEqual(2);
  });

  it("has a needs_review case with wage parts that don't add up, and a rejected document", () => {
    const needsReview = cases.filter((c) => c.expected.status === "needs_review");
    expect(needsReview.length).toBeGreaterThanOrEqual(1);
    const wage = needsReview[0]!.expected.fields.wage!;
    expect(wage.basic + wage.housing + wage.transport + wage.other).not.toBe(wage.total);

    const rejected = cases.filter((c) => c.expected.status === "rejected");
    expect(rejected.length).toBeGreaterThanOrEqual(1);
    expect(rejected.every((c) => c.caseFile.kind === "other_document")).toBe(true);
    expect(rejected.every((c) => c.expected.score === undefined)).toBe(true);
  });

  it("varies contract type and nationality", () => {
    const types = new Set(
      cases.map((c) => c.expected.fields.contractType).filter(Boolean),
    );
    expect([...types].sort()).toEqual(["fixed_term", "indefinite"]);
    const nationalities = new Set(
      cases.map((c) => c.expected.fields.nationality).filter(Boolean),
    );
    expect([...nationalities].sort()).toEqual(["non_saudi", "saudi"]);
  });
});
