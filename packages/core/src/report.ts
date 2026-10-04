import { DISCLAIMER_AR, DISCLAIMER_EN } from "@rater/contracts";
import type {
  ContractFields,
  Deadline,
  Finding,
  Impact,
  RatingReport,
  RatingStatus,
  Rule,
  Score,
  Versions,
  View,
  ViewDeadline,
  ViewFinding,
  ViewScore,
} from "@rater/contracts";
import { fillPlaceholders, type PlaceholderValues } from "./engine/placeholders";
import {
  isProblemVerdict,
  LEGAL_RISK_RANK,
  REVIEW_RULE_ID,
  SEVERITY_RANK,
} from "./engine/verdicts";
import { fieldPlaceholderValues } from "./rules";
import { scoreFindings } from "./score";

/*
 * Step 7: one set of findings, two views. A view picks the messages, the order and the
 * score weights; it never changes the findings themselves.
 */

export interface RenderReportInput {
  id: string;
  status: RatingStatus;
  view: View;
  createdAt: string;
  finishedAt: string | null;
  error: { code: string; message: string } | null;
  findings: Finding[];
  deadlines: Deadline[];
  fields: ContractFields | null;
  versions: Versions | null;
  rules: Rule[];
  locale?: "en" | "ar";
  /** Reasons stored with a needs_review rating (extraction issues). */
  reviewReasons?: string[];
}

/** Statuses whose findings are final enough to score. */
const SCORED_STATUSES: ReadonlySet<RatingStatus> = new Set(["done", "needs_review"]);

export function renderReport(input: RenderReportInput): RatingReport {
  const { view, findings, fields } = input;
  const rulesById = new Map(input.rules.map((rule) => [rule.id, rule]));
  const renewal = input.deadlines.find((deadline) => deadline.kind === "renewal_notice");

  const present = (finding: Finding, withAction: boolean): ViewFinding => {
    const values: PlaceholderValues = {
      deadline: renewal?.date,
      ...(fields ? fieldPlaceholderValues(finding.ruleId, fields) : {}),
    };
    return toViewFinding(finding, {
      view,
      rule: rulesById.get(finding.ruleId),
      values,
      withAction,
    });
  };

  const problems = orderFindings(findings.filter(isProblem), view);
  const good = findings.filter((finding) => isGood(finding, rulesById));
  const info = findings.filter((finding) => finding.source === "info");

  return {
    id: input.id,
    status: input.status,
    view,
    createdAt: input.createdAt,
    finishedAt: input.finishedAt,
    error: input.error,
    score: SCORED_STATUSES.has(input.status)
      ? toViewScore(scoreFindings(findings, view))
      : null,
    deadlines: [...input.deadlines]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((deadline) => toViewDeadline(deadline, view)),
    findings: problems.map((finding) => present(finding, true)),
    good: good.map((finding) => present(finding, false)),
    info: info.map((finding) => present(finding, false)),
    fields,
    versions: input.versions,
    reviewReasons: input.reviewReasons ?? [],
    disclaimer: input.locale === "ar" ? DISCLAIMER_AR : DISCLAIMER_EN,
  };
}

/**
 * Problems in the order a view shows them (the sort is stable, so ties keep pipeline order).
 * Employee: largest SAR at stake first, then severity. HR: severity, then legal risk
 * (likely void > conflict > worse than default > unclear).
 */
export function orderFindings(findings: Finding[], view: View): Finding[] {
  const sorted = [...findings];
  if (view === "employee") {
    sorted.sort(
      (a, b) =>
        sarAtStake(b.impact) - sarAtStake(a.impact) ||
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
    );
  } else {
    sorted.sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        LEGAL_RISK_RANK[a.verdict] - LEGAL_RISK_RANK[b.verdict],
    );
  }
  return sorted;
}

/**
 * The headline SAR figure of an impact: the loss after 5 years for an end-of-service gap,
 * the gap to the legal default for Art. 77, the yearly value for leave, otherwise the
 * largest figure. No impact counts as 0.
 */
export function sarAtStake(impact: Impact | null): number {
  if (impact === null) return 0;
  const headline = { eos_gap: "5y", art77_gap: "gap", leave_value: "perYear" }[
    impact.kind
  ];
  const value = impact.sar[headline];
  if (value !== undefined) return value;
  const values = Object.values(impact.sar);
  return values.length > 0 ? Math.max(...values) : 0;
}

function isProblem(finding: Finding): boolean {
  return finding.source !== "info" && isProblemVerdict(finding.verdict);
}

/** "What's good": passing findings whose rule has something good to say. */
function isGood(finding: Finding, rulesById: Map<string, Rule>): boolean {
  return (
    finding.source !== "info" &&
    !isProblemVerdict(finding.verdict) &&
    rulesById.get(finding.ruleId)?.goodMsg !== undefined
  );
}

function toViewFinding(
  finding: Finding,
  opts: {
    view: View;
    rule: Rule | undefined;
    values: PlaceholderValues;
    withAction: boolean;
  },
): ViewFinding {
  const employee = opts.view === "employee";
  const action = employee ? finding.askFor : finding.suggestedWording;
  return {
    ruleId: finding.ruleId,
    title:
      opts.rule?.title ??
      (finding.ruleId === REVIEW_RULE_ID ? "Needs a manual review" : finding.ruleId),
    clause: finding.clause,
    verdict: finding.verdict,
    severity: finding.severity,
    confidence: finding.confidence,
    categories: finding.categories,
    message: fillPlaceholders(
      employee ? finding.employeeMsg : finding.hrMsg,
      opts.values,
    ),
    explanation: finding.explanation,
    articles: finding.articles,
    impactSar: finding.impact?.sar ?? null,
    impactKind: finding.impact?.kind ?? null,
    action: opts.withAction && action ? fillPlaceholders(action, opts.values) : null,
    needsReview: finding.needsReview,
  };
}

function toViewDeadline(deadline: Deadline, view: View): ViewDeadline {
  const message = view === "employee" ? deadline.employeeMsg : deadline.hrMsg;
  return {
    ruleId: deadline.ruleId,
    kind: deadline.kind,
    date: deadline.date,
    message: fillPlaceholders(message, { deadline: deadline.date }),
  };
}

function toViewScore(score: Score): ViewScore {
  return {
    overall: score.overall,
    legal: score.legal,
    market: score.market,
    clarity: score.clarity,
    band: score.band,
    marketConfidence: score.marketConfidence,
  };
}
