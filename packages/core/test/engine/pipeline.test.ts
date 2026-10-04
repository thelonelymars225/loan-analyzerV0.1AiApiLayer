import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseBboxXhtml } from "../../src/bbox";
import { extractContract } from "../../src/extract";
import { runPipeline, type PipelineInput } from "../../src/pipeline";
import { MemoryClauseCache } from "../../src/section15";
import type { PageLayout } from "../../src/types";
import {
  FakeArticleLookup,
  FakeLlmClient,
  RULES_FILE,
  TEST1_CROSS,
  TEST1_REPLIES,
  TODAY,
} from "./fixtures";

const FIXTURES = fileURLToPath(new URL("../fixtures/", import.meta.url));

/** Synthetic Qiwa contracts rendered from evals/template (made-up parties and values). */
function pages(id: string): PageLayout[] {
  return parseBboxXhtml(readFileSync(`${FIXTURES}${id}.bbox.html`, "utf8"));
}

function input(id: string, overrides: Partial<PipelineInput> = {}): PipelineInput {
  return {
    pages: pages(id),
    rules: RULES_FILE,
    llm: new FakeLlmClient({ clauses: TEST1_REPLIES, cross: TEST1_CROSS }),
    articles: new FakeArticleLookup(),
    cache: new MemoryClauseCache(),
    today: TODAY,
    ...overrides,
  };
}

describe("runPipeline", () => {
  it("rejects a PDF that is not a Qiwa contract without calling the analyser", async () => {
    const llm = new FakeLlmClient();
    const result = await runPipeline(input("not-qiwa", { llm }));
    expect(result.status).toBe("rejected");
    expect(result.rejectReason).toBeTruthy();
    expect(result.extraction).toBeNull();
    expect(result.findings).toEqual([]);
    expect(llm.clauseRequests).toHaveLength(0);
  });

  it("rates the bad Section 15 fixture like test #1", async () => {
    const result = await runPipeline(input("fixed-term-bad-s15"));
    expect(result.status).toBe("done");
    const problems = result.findings
      .filter((f) => !["compliant", "better_than_law"].includes(f.verdict))
      .map((f) => `${f.ruleId}@${f.clause}:${f.severity}`);
    expect(problems).toEqual([
      "TYPE-ART57-01@15.1:high",
      "CONFIDENTIAL-01@15.2:low",
      "TRANSFER-KSA-01@15.3:medium",
      "COMP-ART77-01@15.4:high",
      "LEAVE-FORFEIT-01@15.5:low",
      "EOS-BASE-01@15.6:high",
      "TYPE-CONFLICT-01@15.1:high",
    ]);
    expect(result.scores.employee.overall).toBe(64);
    expect(result.scores.hr.overall).toBe(61);
    // Ended 2026-03-01 and auto-renews yearly, so the next notice is due before 2027-03-01.
    expect(result.deadlines.map((d) => [d.ruleId, d.date])).toEqual([
      ["RENEW-DEADLINE-01", "2027-01-30"],
    ]);
  });

  it("records the versions and adds up the analyser's usage", async () => {
    const result = await runPipeline(input("fixed-term-bad-s15"));
    expect(result.versions).toEqual({
      law: "2025-11",
      ruleset: "0.1.0",
      prompt: "fake-prompt-v1",
      model: "fake-model-1",
    });
    // 7 clause calls + 1 cross-check call at 100 / 20 tokens each.
    expect(result.usage).toEqual({ inputTokens: 800, outputTokens: 160 });
  });

  it("sends only redacted text to the analyser and keeps no names in the result", async () => {
    const names = extractContract(pages("fixed-term-bad-s15")).identifyingStrings;
    expect(names.length).toBeGreaterThan(0);
    const llm = new FakeLlmClient({ clauses: TEST1_REPLIES, cross: TEST1_CROSS });
    const result = await runPipeline(input("fixed-term-bad-s15", { llm }));

    const sent = JSON.stringify([llm.clauseRequests, llm.crossRequests]);
    for (const name of names) expect(sent).not.toContain(name);
    expect(result.extraction?.identifyingStrings).toEqual([]);
    expect(result.extraction?.namePlaceholders).toBeUndefined();
  });

  it("merges Arabic OCR into the clauses before analysis", async () => {
    const llm = new FakeLlmClient({ clauses: TEST1_REPLIES, cross: TEST1_CROSS });
    const ocrArabic = async () => "15.1 نص عربي للبند الأول\n15.2 نص عربي للبند الثاني";
    await runPipeline(input("fixed-term-bad-s15", { llm, ocrArabic }));
    const first = llm.clauseRequests.find((r) => r.clause.number === "15.1");
    expect(first?.clause.textAr).toContain("نص عربي");
  });

  it("carries on with English only when OCR fails, and notes the issue", async () => {
    const ocrArabic = async (): Promise<string> => {
      throw new Error("tesseract crashed");
    };
    const result = await runPipeline(input("fixed-term-bad-s15", { ocrArabic }));
    expect(result.status).toBe("done");
    expect(
      result.extraction?.issues.some((issue) =>
        issue.message.includes("tesseract crashed"),
      ),
    ).toBe(true);
  });

  it("needs review when the extraction does", async () => {
    const result = await runPipeline(input("wage-mismatch"));
    expect(result.extraction?.needsReview).toBe(true);
    expect(result.status).toBe("needs_review");
  });

  it("needs review when the analyser fails twice on a clause", async () => {
    const llm = new FakeLlmClient({
      clauses: { ...TEST1_REPLIES, "15.3": ["garbage"] },
      cross: TEST1_CROSS,
    });
    const result = await runPipeline(input("fixed-term-bad-s15", { llm }));
    expect(result.status).toBe("needs_review");
    expect(result.findings.find((f) => f.clause === "15.3")).toMatchObject({
      ruleId: "REVIEW-00",
      needsReview: true,
    });
  });

  it("answers repeated clauses from the cache on the next run", async () => {
    const cache = new MemoryClauseCache();
    await runPipeline(input("fixed-term-bad-s15", { cache }));
    const llm = new FakeLlmClient({ cross: TEST1_CROSS });
    const again = await runPipeline(input("fixed-term-bad-s15", { cache, llm }));
    expect(llm.clauseRequests).toHaveLength(0);
    expect(again.scores.employee.overall).toBe(64);
  });
});
