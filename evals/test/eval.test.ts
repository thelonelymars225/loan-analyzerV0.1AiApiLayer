import { describe, expect, it } from "vitest";
import { loadCorpus, loadRules, MemoryArticleLookup } from "@rater/law";
import { HeuristicLlmClient } from "@rater/llm";
import { toolsAvailable } from "@rater/pdf";
import { CASES_DIR, loadCases } from "../lib/cases";
import { summarise } from "../lib/compare";
import { caseDiff } from "../lib/report";
import { runCase, type EvalContext } from "../lib/run-case";

/*
 * The committed eval set must pass with the offline analyser, so `pnpm test` guards it too.
 * Same pipeline as `pnpm eval`, without OCR (the offline analyser reads the English text).
 */

const tools = await toolsAvailable();

describe.skipIf(!tools.pdftotext)("eval set with the offline analyser", () => {
  const context: EvalContext = {
    rules: loadRules(),
    articles: new MemoryArticleLookup(loadCorpus()),
    llm: new HeuristicLlmClient(),
    ocr: false,
    runs: 2,
  };
  const cases = loadCases(CASES_DIR, { isPrivate: false });

  it("passes every case and every bar", async () => {
    const results = [];
    for (const evalCase of cases) results.push(await runCase(evalCase, context));

    const failures = results
      .filter((result) => !result.verdict.pass)
      .map((result) => `${result.id}: ${caseDiff(result).join("; ")}`);
    expect(failures).toEqual([]);
    expect(summarise(results).pass).toBe(true);
  });

  it("reports a pipeline error as a failed case instead of throwing", async () => {
    const [first] = cases;
    const result = await runCase(
      { ...first!, pdfPath: "/nonexistent/contract.pdf" },
      context,
    );
    expect(result.error).toMatch(/ENOENT/);
    expect(result.comparison.status.actual).toBe("error");
    expect(result.verdict.pass).toBe(false);
  });
});
