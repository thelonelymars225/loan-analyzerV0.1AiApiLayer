import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ContractFields, Finding } from "@rater/contracts";
import { MemoryClauseCache, parseBboxXhtml, runPipeline } from "@rater/core";
import { loadCorpus, loadRules, MemoryArticleLookup } from "@rater/law";
import { HeuristicLlmClient } from "@rater/llm";
import { pdftotextBbox, toolsAvailable } from "@rater/pdf";

/*
 * The committed eval set: evals/cases/<id>/ holds a synthetic Qiwa contract.pdf and the
 * expected.json it must rate to. Each case goes through the real pipeline (pdftotext and the
 * offline analyser, no API key). No OCR: the offline analyser reads the English text, and OCR
 * has its own tests in packages/pdf and rate-job.test.ts.
 */

const CASES_DIR = fileURLToPath(new URL("../../../evals/cases/", import.meta.url));

type FindingKey = Pick<Finding, "ruleId" | "clause" | "verdict" | "severity">;

interface Expected {
  id: string;
  /** The date the rating runs on: deadlines depend on it. */
  today: string;
  status: "done" | "needs_review" | "rejected";
  /** Fields that must be extracted exactly. */
  fields: Partial<ContractFields>;
  /** Findings that must be present. Any other problem finding is a failure. */
  findings: FindingKey[];
  /** When given, the deadlines must be exactly these. */
  deadlines?: { ruleId: string; date: string }[];
  /** Inclusive [min, max] of the overall score per view. */
  score?: { employee: [number, number]; hr: [number, number] };
}

const cases = readdirSync(CASES_DIR).sort();
const tools = await toolsAvailable();
const rules = loadRules();
const articles = new MemoryArticleLookup(loadCorpus());

/** "OT-RATE-01@15.2 likely_void/high" */
const key = (f: FindingKey) =>
  `${f.ruleId}@${f.clause ?? "-"} ${f.verdict}/${f.severity}`;

/** Compliant, better-than-law and info findings are not problems. */
const isProblem = (f: Pick<Finding, "verdict" | "source">) =>
  f.source !== "info" && f.verdict !== "compliant" && f.verdict !== "better_than_law";

describe.skipIf(!tools.pdftotext)("eval set with the offline analyser", () => {
  it("has the 14 committed cases", () => {
    expect(cases).toHaveLength(14);
  });

  it.each(cases)(
    "%s",
    async (id) => {
      const dir = `${CASES_DIR}${id}/`;
      const expected = JSON.parse(
        readFileSync(`${dir}expected.json`, "utf8"),
      ) as Expected;
      expect(expected.id).toBe(id);

      const pdf = readFileSync(`${dir}contract.pdf`);
      const result = await runPipeline({
        pages: parseBboxXhtml(await pdftotextBbox(pdf)),
        rules,
        llm: new HeuristicLlmClient(),
        articles,
        cache: new MemoryClauseCache(),
        today: expected.today,
      });

      expect(result.status).toBe(expected.status);

      const fields = result.extraction?.fields;
      const extracted = Object.fromEntries(
        Object.keys(expected.fields).map((name) => [
          name,
          fields?.[name as keyof ContractFields] ?? null,
        ]),
      );
      expect(extracted).toEqual(expected.fields);

      const found = result.findings.map(key);
      const wanted = expected.findings.map(key);
      expect({
        missing: wanted.filter((k) => !found.includes(k)),
        unexpected: result.findings
          .filter(isProblem)
          .map(key)
          .filter((k) => !wanted.includes(k)),
      }).toEqual({ missing: [], unexpected: [] });

      if (expected.deadlines) {
        const deadlines = result.deadlines.map(({ ruleId, date }) => `${ruleId} ${date}`);
        expect(deadlines.sort()).toEqual(
          expected.deadlines.map(({ ruleId, date }) => `${ruleId} ${date}`).sort(),
        );
      }

      if (expected.score) {
        for (const view of ["employee", "hr"] as const) {
          const [min, max] = expected.score[view];
          const score = result.scores[view].overall;
          expect(score, `${view} score`).toBeGreaterThanOrEqual(min);
          expect(score, `${view} score`).toBeLessThanOrEqual(max);
        }
      }
    },
    60_000,
  );
});
