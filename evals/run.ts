/**
 * The eval runner (Build Plan, "Eval harness"):
 *
 *   pnpm eval [--private <dir>] [--case <id>]... [--runs N] [--llm heuristic|claude]
 *             [--no-ocr] [--json]
 *
 * Rates every case in evals/cases (and, with --private, every <dir>/<id>/ that holds
 * contract.pdf + expected.json), compares the result with expected.json, prints a diff per case
 * and a summary table, and saves the results to evals/results/<timestamp>.json. Exits with 1
 * when any v1 pass bar fails, 2 on a usage error.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadCorpus, loadRules, MemoryArticleLookup } from "@rater/law";
import { createLlmClient, type LlmClient } from "@rater/llm";
import { toolsAvailable } from "@rater/pdf";
import { CASES_DIR, loadCases, type EvalCase } from "./lib/cases";
import { summarise } from "./lib/compare";
import { formatCase, formatSummary, resultForFile } from "./lib/report";
import { runCase, type CaseResult, type EvalContext } from "./lib/run-case";

const RESULTS_DIR = fileURLToPath(new URL("./results/", import.meta.url));

const USAGE = `Usage: pnpm eval [options]

  --private <dir>   Also run <dir>/<id>/{contract.pdf,expected.json} (real contracts kept out of git)
  --case <id>       Run only this case (repeatable)
  --runs <N>        Runs per case for the stability check (default 3)
  --llm <name>      heuristic or claude (default: from the environment, see createLlmClient)
  --no-ocr          Skip Arabic OCR of Section 15
  --json            Print the results as JSON instead of the report
  --help            Show this help`;

class UsageError extends Error {}

interface Options {
  privateDir: string | undefined;
  caseIds: string[];
  runs: number;
  llm: string | undefined;
  ocr: boolean;
  json: boolean;
}

function parseOptions(argv: string[]): Options | "help" {
  const { values } = parseArgs({
    args: argv,
    options: {
      private: { type: "string" },
      case: { type: "string", multiple: true },
      runs: { type: "string" },
      llm: { type: "string" },
      "no-ocr": { type: "boolean" },
      json: { type: "boolean" },
      help: { type: "boolean" },
    },
    strict: true,
  });
  if (values.help) return "help";
  const runs = Number(values.runs ?? "3");
  if (!Number.isInteger(runs) || runs < 1) {
    throw new UsageError(
      `--runs must be a whole number of at least 1, got "${values.runs}"`,
    );
  }
  if (values.llm !== undefined && values.llm !== "heuristic" && values.llm !== "claude") {
    throw new UsageError(`--llm must be "heuristic" or "claude", got "${values.llm}"`);
  }
  return {
    privateDir: values.private,
    caseIds: values.case ?? [],
    runs,
    llm: values.llm,
    ocr: !values["no-ocr"],
    json: values.json ?? false,
  };
}

/** --llm picks the provider; without it the environment decides (Claude when a key is set). */
function chooseLlm(choice: string | undefined): LlmClient {
  const env =
    choice === undefined ? process.env : { ...process.env, LLM_PROVIDER: choice };
  try {
    return createLlmClient(env);
  } catch (error) {
    // A missing API key or an unknown provider is a setup problem, not a failed eval.
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
}

function selectCases(options: Options): EvalCase[] {
  const cases = [
    ...loadCases(CASES_DIR, { isPrivate: false }),
    ...(options.privateDir ? loadCases(options.privateDir, { isPrivate: true }) : []),
  ];
  if (options.caseIds.length === 0) return cases;
  const unknown = options.caseIds.filter((id) => !cases.some((c) => c.id === id));
  if (unknown.length > 0) throw new UsageError(`Unknown case: ${unknown.join(", ")}`);
  return cases.filter((c) => options.caseIds.includes(c.id));
}

async function main(argv: string[]): Promise<number> {
  const options = parseOptions(argv);
  if (options === "help") {
    console.log(USAGE);
    return 0;
  }
  // In --json mode stdout carries only the JSON; progress goes to stderr.
  const log = options.json ? console.error : console.log;

  const cases = selectCases(options);
  const tools = await toolsAvailable();
  if (!tools.pdftotext) throw new Error("pdftotext (poppler) is not installed.");
  const llm = chooseLlm(options.llm);
  const rules = loadRules();
  const context: EvalContext = {
    rules,
    articles: new MemoryArticleLookup(loadCorpus()),
    llm,
    ocr: options.ocr && tools.tesseract && tools.tesseractAra,
    runs: options.runs,
  };
  log(
    `Eval: ${cases.length} cases x ${context.runs} runs · analyser ${llm.model} (prompt ${llm.promptVersion}) · law ${rules.lawVersion} · rules ${rules.rulesetVersion} · OCR ${context.ocr ? "on" : "off"}`,
  );

  const startedAt = new Date();
  const idWidth = Math.max(...cases.map((evalCase) => evalCase.id.length));
  const results: CaseResult[] = [];
  for (const evalCase of cases) {
    const result = await runCase(evalCase, context);
    results.push(result);
    for (const line of formatCase(result, idWidth)) log(line);
  }
  const summary = summarise(results);
  for (const line of formatSummary(summary)) log(line);

  const report = {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    versions: {
      law: rules.lawVersion,
      ruleset: rules.rulesetVersion,
      prompt: llm.promptVersion,
      model: llm.model,
    },
    options: {
      runs: context.runs,
      ocr: context.ocr,
      private: Boolean(options.privateDir),
    },
    summary,
    cases: results.map(resultForFile),
  };
  const path = saveResults(report, startedAt);
  log(`Results: ${path}`);
  if (options.json) console.log(JSON.stringify(report, null, 2));
  return summary.pass ? 0 : 1;
}

function saveResults(report: unknown, startedAt: Date): string {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = startedAt.toISOString().replace(/[:.]/g, "-");
  const path = `${RESULTS_DIR}${stamp}.json`;
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  return path;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    if (
      error instanceof UsageError ||
      (error as { code?: string }).code?.startsWith("ERR_PARSE_ARGS")
    ) {
      console.error(`${(error as Error).message}\n\n${USAGE}`);
      process.exitCode = 2;
      return;
    }
    console.error(error);
    process.exitCode = 1;
  },
);
