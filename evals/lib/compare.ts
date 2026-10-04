import { isDeepStrictEqual } from "node:util";
import type { ContractFields, Finding, Severity, Verdict, View } from "@rater/contracts";
import { REVIEW_RULE_ID } from "@rater/core";
import type { Expected, ExpectedDeadline, ExpectedFinding, ScoreRange } from "./expected";

/*
 * Compares one pipeline run with expected.json, and adds the per-case results up into the v1
 * pass bars (Build Plan, "Eval harness"). Pure functions: run.ts does the I/O.
 */

/** v1 pass bars. */
export const PASS_BARS = {
  fieldAccuracy: 1,
  highRecall: 1,
  precision: 0.9,
  mustNotViolations: 0,
  /** Score range, stability, status and deadlines must hold in every case. */
  everyCase: 1,
} as const;

/** What one pipeline run produced, reduced to what the eval compares. */
export interface RunOutcome {
  /** "error": the pipeline threw (the eval reports the message). */
  status: "done" | "needs_review" | "rejected" | "error";
  fields: ContractFields | null;
  findings: Pick<Finding, "ruleId" | "clause" | "verdict" | "severity" | "source">[];
  deadlines: ExpectedDeadline[];
  /** Overall score per view; null for a rejected document. */
  scores: Record<View, number> | null;
}

export type FindingOutcome = RunOutcome["findings"][number];

export interface FieldMismatch {
  field: string;
  expected: unknown;
  actual: unknown;
}

export interface MissingFinding {
  expected: ExpectedFinding;
  /** A finding for the same rule and clause with another verdict or severity, if any. */
  closest: FindingOutcome | null;
}

export interface ScoreCheck {
  view: View;
  actual: number | null;
  range: ScoreRange;
  ok: boolean;
}

export interface CaseComparison {
  status: { expected: Expected["status"]; actual: RunOutcome["status"]; ok: boolean };
  fields: { checked: number; mismatches: FieldMismatch[] };
  findings: {
    matched: ExpectedFinding[];
    missing: MissingFinding[];
    /** Problem findings that match no expected finding: false positives. */
    unexpected: FindingOutcome[];
  };
  /** Expected high-severity problem findings, and how many were found. */
  highRecall: { expected: number; found: number };
  /** Problem findings produced, and how many of them were expected. */
  precision: { produced: number; correct: number };
  /** Problem findings for rules the case says must not fire. */
  mustNotViolations: FindingOutcome[];
  deadlines: {
    checked: boolean;
    missing: ExpectedDeadline[];
    unexpected: ExpectedDeadline[];
  };
  scores: ScoreCheck[];
}

function isProblemVerdict(verdict: Verdict): boolean {
  return verdict !== "compliant" && verdict !== "better_than_law";
}

/** A problem is anything that is not compliant or better than the law, except info findings. */
export function isProblem(finding: Pick<Finding, "verdict" | "source">): boolean {
  return finding.source !== "info" && isProblemVerdict(finding.verdict);
}

/**
 * Same rule, clause, verdict and severity. REVIEW-00 (the analyser could not answer) never
 * matches, so it always counts as a miss.
 */
export function sameFinding(expected: ExpectedFinding, actual: FindingOutcome): boolean {
  return (
    actual.ruleId !== REVIEW_RULE_ID &&
    actual.ruleId === expected.ruleId &&
    actual.clause === expected.clause &&
    actual.verdict === expected.verdict &&
    actual.severity === expected.severity
  );
}

export function compareCase(expected: Expected, run: RunOutcome): CaseComparison {
  const findings = compareFindings(expected.findings, run.findings);
  const highExpected = expected.findings.filter(
    (finding) => finding.severity === "high" && isProblemVerdict(finding.verdict),
  );
  const problems = run.findings.filter(isProblem);

  return {
    status: {
      expected: expected.status,
      actual: run.status,
      ok: expected.status === run.status,
    },
    fields: compareFields(expected.fields, run.fields),
    findings,
    highRecall: {
      expected: highExpected.length,
      found: highExpected.filter((finding) => findings.matched.includes(finding)).length,
    },
    precision: {
      produced: problems.length,
      correct: problems.length - findings.unexpected.length,
    },
    mustNotViolations: problems.filter((finding) =>
      expected.mustNot.includes(finding.ruleId),
    ),
    deadlines: compareDeadlines(expected.deadlines, run.deadlines),
    scores: compareScores(expected.score, run.scores),
  };
}

/** Each expected field must equal the extracted value exactly (deep equality for the wage). */
export function compareFields(
  expected: Partial<ContractFields>,
  actual: ContractFields | null,
): CaseComparison["fields"] {
  const entries = Object.entries(expected) as [keyof ContractFields, unknown][];
  const mismatches = entries
    .filter(([field, value]) => !isDeepStrictEqual(actual?.[field] ?? null, value))
    .map(([field, value]) => ({
      field,
      expected: value,
      actual: actual?.[field] ?? null,
    }));
  return { checked: entries.length, mismatches };
}

/**
 * Pairs expected findings with actual ones, one to one. Expected findings of any verdict are
 * looked for; only problem findings can be "unexpected", because compliant and info findings
 * the case does not list are harmless.
 */
export function compareFindings(
  expected: ExpectedFinding[],
  actual: FindingOutcome[],
): CaseComparison["findings"] {
  const unused = [...actual];
  const matched: ExpectedFinding[] = [];
  const missing: MissingFinding[] = [];
  for (const want of expected) {
    const index = unused.findIndex((finding) => sameFinding(want, finding));
    if (index >= 0) {
      matched.push(want);
      unused.splice(index, 1);
    } else {
      const closest =
        unused.find(
          (finding) => finding.ruleId === want.ruleId && finding.clause === want.clause,
        ) ?? null;
      missing.push({ expected: want, closest });
    }
  }
  return { matched, missing, unexpected: unused.filter(isProblem) };
}

export function compareDeadlines(
  expected: ExpectedDeadline[] | undefined,
  actual: ExpectedDeadline[],
): CaseComparison["deadlines"] {
  if (expected === undefined) return { checked: false, missing: [], unexpected: [] };
  const same = (a: ExpectedDeadline, b: ExpectedDeadline) =>
    a.ruleId === b.ruleId && a.date === b.date;
  return {
    checked: true,
    missing: expected.filter((want) => !actual.some((got) => same(want, got))),
    unexpected: actual.filter((got) => !expected.some((want) => same(want, got))),
  };
}

export function compareScores(
  expected: Expected["score"],
  actual: RunOutcome["scores"],
): ScoreCheck[] {
  if (!expected) return [];
  const views: View[] = ["employee", "hr"];
  return views.map((view) => {
    const range = expected[view];
    const score = actual?.[view] ?? null;
    const ok = score !== null && score >= range[0] && score <= range[1];
    return { view, actual: score, range, ok };
  });
}

// ---------------------------------------------------------------------------------------------
// Stability across repeated runs
// ---------------------------------------------------------------------------------------------

/** "OT-RATE-01@15.2 likely_void/high": one finding as a comparable string. */
export function findingKey(finding: {
  ruleId: string;
  clause: string | null;
  verdict: Verdict;
  severity: Severity;
}): string {
  return `${finding.ruleId}@${finding.clause ?? "-"} ${finding.verdict}/${finding.severity}`;
}

export interface StabilityCheck {
  runs: number;
  stable: boolean;
  /** For each later run that differs from the first: what it added and what it lost. */
  differences: { run: number; added: string[]; removed: string[] }[];
}

/** Repeated runs are stable when every run produced the same findings as the first. */
export function checkStability(runs: FindingOutcome[][]): StabilityCheck {
  const [first = [], ...rest] = runs.map((findings) => findings.map(findingKey).sort());
  const differences = rest
    .map((keys, index) => ({
      run: index + 2,
      added: multisetMinus(keys, first),
      removed: multisetMinus(first, keys),
    }))
    .filter((diff) => diff.added.length > 0 || diff.removed.length > 0);
  return { runs: runs.length, stable: differences.length === 0, differences };
}

/** Items of `a` left after removing one copy of each item of `b`. */
function multisetMinus(a: string[], b: string[]): string[] {
  const left = [...b];
  return a.filter((item) => {
    const index = left.indexOf(item);
    if (index < 0) return true;
    left.splice(index, 1);
    return false;
  });
}

// ---------------------------------------------------------------------------------------------
// Pass / fail
// ---------------------------------------------------------------------------------------------

/** Per-case checks. Precision is judged over all cases together, as the v1 bar says. */
export interface CaseVerdict {
  status: boolean;
  fields: boolean;
  highRecall: boolean;
  mustNot: boolean;
  deadlines: boolean;
  score: boolean;
  stable: boolean;
  pass: boolean;
}

export function caseVerdict(
  comparison: CaseComparison,
  stability: StabilityCheck,
): CaseVerdict {
  const checks = {
    status: comparison.status.ok,
    fields: comparison.fields.mismatches.length === 0,
    highRecall: comparison.highRecall.found === comparison.highRecall.expected,
    mustNot: comparison.mustNotViolations.length === 0,
    deadlines:
      comparison.deadlines.missing.length === 0 &&
      comparison.deadlines.unexpected.length === 0,
    score: comparison.scores.every((check) => check.ok),
    stable: stability.stable,
  };
  return { ...checks, pass: Object.values(checks).every(Boolean) };
}

export interface Metric {
  value: number;
  /** Numerator and denominator, for the summary table. */
  of: [number, number];
}

export interface Summary {
  cases: number;
  casesPassed: number;
  fieldAccuracy: Metric;
  highRecall: Metric;
  precision: Metric;
  /** Expected findings of every severity and verdict that were found (reported, not a bar). */
  recallAll: Metric;
  mustNotViolations: number;
  statusCorrect: Metric;
  deadlinesCorrect: Metric;
  scoresInRange: Metric;
  stableCases: Metric;
  bars: Bar[];
  pass: boolean;
}

export interface Bar {
  name: string;
  ok: boolean;
  /** "100.0% (14/14) (bar 100%)" */
  detail: string;
}

export interface CaseResultForSummary {
  comparison: CaseComparison;
  stability: StabilityCheck;
  verdict: CaseVerdict;
}

export function summarise(results: CaseResultForSummary[]): Summary {
  const sum = (pick: (result: CaseResultForSummary) => number) =>
    results.reduce((total, result) => total + pick(result), 0);
  const metric = (numerator: number, denominator: number): Metric => ({
    // Nothing to measure counts as a full score: no expected high findings, none missed.
    value: denominator === 0 ? 1 : numerator / denominator,
    of: [numerator, denominator],
  });

  const fieldsChecked = sum((r) => r.comparison.fields.checked);
  const fieldsWrong = sum((r) => r.comparison.fields.mismatches.length);
  const fieldAccuracy = metric(fieldsChecked - fieldsWrong, fieldsChecked);
  const highRecall = metric(
    sum((r) => r.comparison.highRecall.found),
    sum((r) => r.comparison.highRecall.expected),
  );
  const precision = metric(
    sum((r) => r.comparison.precision.correct),
    sum((r) => r.comparison.precision.produced),
  );
  const matched = sum((r) => r.comparison.findings.matched.length);
  const recallAll = metric(
    matched,
    matched + sum((r) => r.comparison.findings.missing.length),
  );
  const mustNotViolations = sum((r) => r.comparison.mustNotViolations.length);
  const count = (pick: (verdict: CaseVerdict) => boolean) =>
    metric(results.filter((r) => pick(r.verdict)).length, results.length);
  const scoreCases = results.filter((r) => r.comparison.scores.length > 0);
  const scoresInRange = metric(
    scoreCases.filter((r) => r.verdict.score).length,
    scoreCases.length,
  );
  const statusCorrect = count((v) => v.status);
  const deadlinesCorrect = count((v) => v.deadlines);
  const stableCases = count((v) => v.stable);

  const bars: Bar[] = [
    rateBar("Field accuracy", fieldAccuracy, PASS_BARS.fieldAccuracy),
    rateBar("Recall, high severity", highRecall, PASS_BARS.highRecall),
    rateBar("Precision, problem findings", precision, PASS_BARS.precision),
    {
      name: "mustNot violations",
      ok: mustNotViolations <= PASS_BARS.mustNotViolations,
      detail: `${mustNotViolations} (bar ${PASS_BARS.mustNotViolations})`,
    },
    rateBar("Score within range", scoresInRange, PASS_BARS.everyCase),
    rateBar("Stable across runs", stableCases, PASS_BARS.everyCase),
    rateBar(
      "Status (done / needs_review / rejected)",
      statusCorrect,
      PASS_BARS.everyCase,
    ),
    rateBar("Deadlines", deadlinesCorrect, PASS_BARS.everyCase),
  ];
  return {
    cases: results.length,
    casesPassed: results.filter((r) => r.verdict.pass).length,
    fieldAccuracy,
    highRecall,
    precision,
    recallAll,
    mustNotViolations,
    statusCorrect,
    deadlinesCorrect,
    scoresInRange,
    stableCases,
    bars,
    pass: bars.every((b) => b.ok),
  };
}

function rateBar(name: string, metric: Metric, minimum: number): Bar {
  const target = minimum === 1 ? "100%" : `>= ${minimum * 100}%`;
  return {
    name,
    ok: metric.value >= minimum,
    detail: `${formatMetric(metric)} (bar ${target})`,
  };
}

export function formatMetric(metric: Metric): string {
  const [numerator, denominator] = metric.of;
  return `${(metric.value * 100).toFixed(1)}% (${numerator}/${denominator})`;
}
