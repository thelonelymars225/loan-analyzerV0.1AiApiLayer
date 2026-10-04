import type { Confidence, ImpactParams, Severity, Verdict } from "@rater/contracts";

/** What one detector concludes about one clause for its rule. */
export interface Detection {
  verdict: Verdict;
  severity: Severity;
  confidence: Confidence;
  /** Plain English for a non-lawyer. */
  explanation: string;
  impactParams?: ImpactParams;
}

/** The clause as detectors see it. */
export interface ClauseText {
  /** Normalised English: the clause's English text, or an English gloss of its Arabic text. */
  text: string;
  /** Probation days already set in sections 1-14 (clause 6.1), when the field summary has them. */
  probationDays: number | null;
}

/**
 * Reads one clause for one rule. Returns null when the clause does not touch the rule, so
 * that a clause with nothing to report produces no match at all.
 */
export type Detector = (clause: ClauseText) => Detection | null;

/** A finding that passes: no severity. */
export function passes(
  verdict: "compliant" | "better_than_law",
  explanation: string,
  confidence: Confidence = "high",
  impactParams?: ImpactParams,
): Detection {
  return withParams({ verdict, severity: "none", confidence, explanation }, impactParams);
}

/** A finding that is a problem for the worker. */
export function problem(
  verdict: "likely_void" | "worse_than_default" | "unclear",
  severity: Exclude<Severity, "none">,
  explanation: string,
  confidence: Confidence = "high",
  impactParams?: ImpactParams,
): Detection {
  return withParams({ verdict, severity, confidence, explanation }, impactParams);
}

function withParams(
  detection: Detection,
  impactParams: ImpactParams | undefined,
): Detection {
  return impactParams ? { ...detection, impactParams } : detection;
}
