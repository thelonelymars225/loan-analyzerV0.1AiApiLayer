import { readFile } from "node:fs/promises";
import type { RulesFile } from "@rater/contracts";
import {
  MemoryClauseCache,
  parseBboxXhtml,
  runPipeline,
  type ArticleLookup,
  type PageRegion,
  type PipelineResult,
} from "@rater/core";
import type { LlmClient, LlmUsage } from "@rater/llm";
import { ocrArabicRegions, pdftotextBbox } from "@rater/pdf";
import type { EvalCase } from "./cases";
import {
  caseVerdict,
  checkStability,
  compareCase,
  type CaseComparison,
  type CaseVerdict,
  type RunOutcome,
  type StabilityCheck,
} from "./compare";

/** What every case shares: rules, law lookup, analyser and options. */
export interface EvalContext {
  rules: RulesFile;
  articles: ArticleLookup;
  llm: LlmClient;
  /** Run Arabic OCR on Section 15 (needs tesseract with the ara language). */
  ocr: boolean;
  /** Repeated runs per case, for the stability check. */
  runs: number;
}

export interface CaseResult {
  id: string;
  description: string;
  isPrivate: boolean;
  comparison: CaseComparison;
  stability: StabilityCheck;
  verdict: CaseVerdict;
  /** Wall time of all runs of this case. */
  durationMs: number;
  /** Analyser tokens of the first run. */
  usage: LlmUsage;
  /** Set when the pipeline threw instead of returning a result. */
  error?: string;
}

/**
 * pdftotext → parseBboxXhtml → runPipeline, `runs` times with a fresh clause cache each time,
 * then compares the first run with expected.json and all runs with each other.
 */
export async function runCase(
  evalCase: EvalCase,
  context: EvalContext,
): Promise<CaseResult> {
  const started = performance.now();
  let outcomes: RunOutcome[] = [];
  let usage: LlmUsage = { inputTokens: 0, outputTokens: 0 };
  let error: string | undefined;
  try {
    const pdf = await readFile(evalCase.pdfPath);
    const pages = parseBboxXhtml(await pdftotextBbox(pdf));
    const ocrArabic = context.ocr ? ocrOnce(pdf) : undefined;
    for (let run = 0; run < context.runs; run++) {
      const result = await runPipeline({
        pages,
        ocrArabic,
        rules: context.rules,
        llm: context.llm,
        articles: context.articles,
        // A fresh cache, so every run really asks the analyser again.
        cache: new MemoryClauseCache(),
        today: evalCase.expected.today,
      });
      if (run === 0) usage = result.usage;
      outcomes.push(toOutcome(result));
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
    // A crash counts as a single run that found nothing.
    outcomes = [FAILED_RUN];
  }

  const comparison = compareCase(evalCase.expected, outcomes[0] ?? FAILED_RUN);
  const stability = checkStability(outcomes.map((outcome) => outcome.findings));
  return {
    id: evalCase.id,
    description: evalCase.expected.description,
    isPrivate: evalCase.isPrivate,
    comparison,
    stability,
    verdict: caseVerdict(comparison, stability),
    durationMs: Math.round(performance.now() - started),
    usage,
    ...(error === undefined ? {} : { error }),
  };
}

/** A run that crashed: nothing extracted, nothing found. */
const FAILED_RUN: RunOutcome = {
  status: "error",
  fields: null,
  findings: [],
  deadlines: [],
  scores: null,
};

/**
 * OCR runs once per case and is reused by the repeated runs: it is the slow step, and the
 * stability check is about the analyser, not about Tesseract.
 */
function ocrOnce(pdf: Buffer): (regions: PageRegion[]) => Promise<string> {
  let text: Promise<string> | undefined;
  return (regions) => (text ??= ocrArabicRegions(pdf, regions));
}

export function toOutcome(result: PipelineResult): RunOutcome {
  return {
    status: result.status,
    fields: result.extraction?.fields ?? null,
    findings: result.findings.map(({ ruleId, clause, verdict, severity, source }) => ({
      ruleId,
      clause,
      verdict,
      severity,
      source,
    })),
    deadlines: result.deadlines.map(({ ruleId, date }) => ({ ruleId, date })),
    // A rejected document was not rated: its scores mean nothing.
    scores:
      result.status === "rejected"
        ? null
        : {
            employee: result.scores.employee.overall,
            hr: result.scores.hr.overall,
          },
  };
}
