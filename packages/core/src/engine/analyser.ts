import { z } from "zod";
import { ClauseAnalysis, CrossCheckResult } from "@rater/contracts";
import type { LlmReply, LlmUsage } from "@rater/llm";
import type { AnalysedFinding } from "../types";
import { addUsage, REVIEW_RULE_ID, ZERO_USAGE } from "./verdicts";

/*
 * Talking to the analyser safely: every reply is validated against the Zod schema and the
 * request's own candidate rules and citations, and an invalid reply gets one retry.
 */

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

/** What a reply may name: the candidate rule IDs, the citations provided, and the clauses sent. */
export interface AllowedAnswers {
  ruleIds: ReadonlySet<string>;
  citations: ReadonlySet<string>;
  clauses?: ReadonlySet<string>;
}

/** Two attempts in all: the first call and one retry that carries the first call's error. */
const MAX_ATTEMPTS = 2;

/** Errors are sent back to the model and stored on review findings, so keep them short. */
const MAX_ERROR_LENGTH = 600;

export type AskResult<T> =
  { ok: true; value: T; usage: LlmUsage } | { ok: false; error: string; usage: LlmUsage };

/**
 * Calls the analyser and validates the reply. An invalid reply, or a call that throws, is
 * retried once with `previousError` saying what was wrong.
 */
export async function askWithRetry<T>(
  ask: (previousError: string | undefined) => Promise<LlmReply>,
  check: (json: unknown) => Checked<T>,
): Promise<AskResult<T>> {
  let usage = ZERO_USAGE;
  let previousError: string | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const reply = await ask(previousError);
      usage = addUsage(usage, reply.usage);
      const result = check(reply.json);
      if (result.ok) return { ok: true, value: result.value, usage };
      previousError = result.error;
    } catch (error) {
      // A refused or cut-off reply was still paid for, so its tokens count too.
      const failedUsage = usageOf(error);
      if (failedUsage) usage = addUsage(usage, failedUsage);
      const message = error instanceof Error ? error.message : String(error);
      previousError = shorten(`The analyser call failed: ${message}`);
    }
  }
  return { ok: false, error: previousError ?? "No valid reply.", usage };
}

/**
 * The tokens a failed call used, when the error carries them (the Claude client's
 * ClaudeReplyError does). Read by shape, so core needs no Claude-specific class.
 */
function usageOf(error: unknown): LlmUsage | undefined {
  const usage = (error as { usage?: Partial<LlmUsage> | null } | null | undefined)?.usage;
  if (typeof usage?.inputTokens !== "number" || typeof usage.outputTokens !== "number") {
    return undefined;
  }
  return { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };
}

export function checkClauseAnalysis(
  json: unknown,
  allowed: AllowedAnswers,
): Checked<ClauseAnalysis> {
  const parsed = ClauseAnalysis.safeParse(json);
  if (!parsed.success) {
    return invalid(
      `The reply does not match the ClauseAnalysis schema. ${z.prettifyError(parsed.error)}`,
    );
  }
  const problems = parsed.data.matches.flatMap((match) =>
    answerProblems(match.ruleId, match.articles, allowed),
  );
  return problems.length > 0
    ? invalid(problems.join(" "))
    : { ok: true, value: parsed.data };
}

export function checkCrossCheck(
  json: unknown,
  allowed: AllowedAnswers,
): Checked<CrossCheckResult> {
  const parsed = CrossCheckResult.safeParse(json);
  if (!parsed.success) {
    return invalid(
      `The reply does not match the CrossCheckResult schema. ${z.prettifyError(parsed.error)}`,
    );
  }
  const problems = parsed.data.conflicts.flatMap((conflict) => {
    const clauseProblem =
      allowed.clauses && !allowed.clauses.has(conflict.clause)
        ? [`Clause "${conflict.clause}" is not one of the Section 15 clauses provided.`]
        : [];
    return [
      ...answerProblems(conflict.ruleId, conflict.articles, allowed),
      ...clauseProblem,
    ];
  });
  return problems.length > 0
    ? invalid(problems.join(" "))
    : { ok: true, value: parsed.data };
}

function answerProblems(
  ruleId: string,
  articles: string[],
  allowed: AllowedAnswers,
): string[] {
  const problems: string[] = [];
  if (!allowed.ruleIds.has(ruleId)) {
    problems.push(`Rule "${ruleId}" is not one of the candidate rules.`);
  }
  for (const article of articles) {
    if (!allowed.citations.has(article)) {
      problems.push(
        `Citation "${article}" (rule ${ruleId}) is not one of the articles provided.`,
      );
    }
  }
  return problems;
}

function invalid(error: string): Checked<never> {
  return { ok: false, error: shorten(error) };
}

function shorten(text: string): string {
  return text.length > MAX_ERROR_LENGTH
    ? `${text.slice(0, MAX_ERROR_LENGTH - 1)}…`
    : text;
}

/**
 * The finding raised when the analyser failed twice: low severity, but flagged so a person
 * reads the clause (or, for the cross-check, all of Section 15).
 */
export function reviewFinding(clause: string | null, error: string): AnalysedFinding {
  const whole = clause === null;
  return {
    ruleId: REVIEW_RULE_ID,
    clause,
    verdict: "unclear",
    severity: "low",
    confidence: "low",
    categories: ["clarity"],
    articles: [],
    impact: null,
    explanation: `${whole ? "The cross-check of Section 15 against sections 1-14" : "The analysis of this clause"} failed twice. Last problem: ${error}`,
    employeeMsg: whole
      ? "We couldn't check the additional terms against the rest of your contract automatically. Have someone read Section 15 before you sign."
      : "We couldn't analyse this clause automatically. Have someone read it before you sign.",
    hrMsg: whole
      ? "Automatic cross-check of Section 15 against sections 1-14 failed. Review it manually."
      : "Automatic analysis of this clause failed. Review it manually.",
    source: whole ? "cross_check" : "clause",
    needsReview: true,
  };
}
