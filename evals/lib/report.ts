import type { ExpectedDeadline, ExpectedFinding } from "./expected";
import { findingKey, formatMetric, type Summary } from "./compare";
import type { CaseResult } from "./run-case";

/*
 * Console output of the eval runner: a diff per case and a summary table. Private cases (real
 * contracts) never show field values or dates, only names and rule IDs.
 */

const HIDDEN = "(hidden: private case)";

/** One line per case, plus indented lines for everything that differs from expected.json. */
export function formatCase(result: CaseResult, idWidth = result.id.length): string[] {
  const { comparison, verdict } = result;
  const scores = comparison.scores
    .map((check) => `${check.view} ${check.actual ?? "-"} [${check.range.join("-")}]`)
    .join("  ");
  const { matched, missing } = comparison.findings;
  const found = `findings ${matched.length}/${matched.length + missing.length}`;
  const head = [
    verdict.pass ? "PASS" : "FAIL",
    result.id.padEnd(idWidth),
    comparison.status.actual.padEnd(12),
    found.padEnd(15),
    scores,
    `${(result.durationMs / 1000).toFixed(1)}s`,
  ].join("  ");
  return [head, ...caseDiff(result).map((line) => `      ${line}`)];
}

/** The differences, one line each. Empty when the case matches expected.json exactly. */
export function caseDiff(result: CaseResult): string[] {
  const { comparison, stability, isPrivate } = result;
  const value = (v: unknown) => (isPrivate ? HIDDEN : JSON.stringify(v));
  const date = (d: ExpectedDeadline) => `${d.ruleId} ${isPrivate ? HIDDEN : d.date}`;
  const lines: string[] = [];

  if (result.error) lines.push(`error: ${result.error}`);
  if (!comparison.status.ok) {
    lines.push(
      `status: expected ${comparison.status.expected}, got ${comparison.status.actual}`,
    );
  }
  for (const mismatch of comparison.fields.mismatches) {
    lines.push(
      `field ${mismatch.field}: expected ${value(mismatch.expected)}, got ${value(mismatch.actual)}`,
    );
  }
  for (const missing of comparison.findings.missing) {
    const got = missing.closest ? ` (got ${findingKey(missing.closest)})` : "";
    const level = isHighProblem(missing.expected) ? "missing HIGH" : "missing";
    lines.push(`${level}: ${findingKey(missing.expected)}${got}`);
  }
  for (const finding of comparison.findings.unexpected) {
    lines.push(`unexpected: ${findingKey(finding)}`);
  }
  for (const finding of comparison.mustNotViolations) {
    lines.push(`mustNot violated: ${findingKey(finding)}`);
  }
  for (const deadline of comparison.deadlines.missing) {
    lines.push(`deadline missing: ${date(deadline)}`);
  }
  for (const deadline of comparison.deadlines.unexpected) {
    lines.push(`deadline unexpected: ${date(deadline)}`);
  }
  for (const check of comparison.scores.filter((s) => !s.ok)) {
    lines.push(
      `score ${check.view}: ${check.actual ?? "none"} is outside [${check.range.join(", ")}]`,
    );
  }
  for (const difference of stability.differences) {
    lines.push(
      `unstable: run ${difference.run} added [${difference.added.join(", ")}] removed [${difference.removed.join(", ")}]`,
    );
  }
  return lines;
}

function isHighProblem(finding: ExpectedFinding): boolean {
  return (
    finding.severity === "high" &&
    finding.verdict !== "compliant" &&
    finding.verdict !== "better_than_law"
  );
}

export function formatSummary(summary: Summary): string[] {
  const width = Math.max(...summary.bars.map((bar) => bar.name.length));
  return [
    "",
    `${"Bar".padEnd(width)}  Result`,
    `${"-".repeat(width)}  ${"-".repeat(40)}`,
    ...summary.bars.map(
      (bar) => `${bar.name.padEnd(width)}  ${bar.ok ? "PASS" : "FAIL"}  ${bar.detail}`,
    ),
    "",
    `Recall, all expected findings (reported, not a bar): ${formatMetric(summary.recallAll)}`,
    `Cases passed: ${summary.casesPassed}/${summary.cases}`,
    summary.pass ? "EVAL PASSED" : "EVAL FAILED",
  ];
}

/**
 * The case result as saved in evals/results. For a private case, field values and dates are
 * replaced so that nothing from a real contract lands on disk.
 */
export function resultForFile(result: CaseResult): CaseResult {
  if (!result.isPrivate) return result;
  const { comparison } = result;
  const hideDate = (deadline: ExpectedDeadline) => ({ ...deadline, date: HIDDEN });
  return {
    ...result,
    comparison: {
      ...comparison,
      fields: {
        checked: comparison.fields.checked,
        mismatches: comparison.fields.mismatches.map((mismatch) => ({
          field: mismatch.field,
          expected: HIDDEN,
          actual: HIDDEN,
        })),
      },
      deadlines: {
        ...comparison.deadlines,
        missing: comparison.deadlines.missing.map(hideDate),
        unexpected: comparison.deadlines.unexpected.map(hideDate),
      },
    },
  };
}
