import type { Confidence, CrossConflict } from "@rater/contracts";
import type { StatedType } from "./contract-term";
import { statedContractTypes } from "./contract-term";
import { normaliseEnglish } from "./text";

/*
 * Offline cross-check for TYPE-CONFLICT-01: a Section 15 clause that states a contract type
 * or term different from the one recorded in sections 1-14.
 */

export const TYPE_CONFLICT_RULE_ID = "TYPE-CONFLICT-01";

/** The contract type recorded in sections 1-14, read from the field summary. */
export function recordedContractType(fieldSummary: string): StatedType | null {
  const match = /contract type:\s*([^.]*)/i.exec(fieldSummary);
  const value = normaliseEnglish(match?.[1] ?? "");
  if (/\b(?:indefinite|unlimited|open[- ]ended)\b/.test(value)) return "indefinite";
  if (/\b(?:fixed|limited|definite)\b/.test(value)) return "fixed_term";
  if (/\b(?:specific work|project)\b/.test(value)) return "specific_work";
  return null;
}

/** What each recorded type cannot be at the same time. */
const CONTRADICTS: Record<StatedType, StatedType[]> = {
  fixed_term: ["indefinite", "specific_work"],
  indefinite: ["fixed_term", "specific_work"],
  specific_work: ["indefinite", "fixed_term"],
};

const RECORDED_AS: Record<StatedType, string> = {
  fixed_term: "a fixed-term contract",
  indefinite: "an indefinite (open-ended) contract",
  specific_work: "a contract for a specific work",
};

const CLAUSE_SAYS: Record<StatedType, string> = {
  fixed_term: "it runs for a fixed term",
  indefinite: "it runs for an unlimited period",
  specific_work: "it ends when a project or specific work is completed",
};

export interface ClauseStatement {
  number: string;
  /** Normalised English (or English gloss of the Arabic). */
  text: string;
  confidence: Confidence;
}

/** The conflict a clause creates with the recorded type, or null if it agrees or says nothing. */
export function typeConflict(
  clause: ClauseStatement,
  recorded: StatedType,
  articles: string[],
): CrossConflict | null {
  const stated = statedContractTypes(clause.text);
  const conflicting = CONTRADICTS[recorded].filter((type) => stated.has(type));
  if (conflicting.length === 0) return null;

  // A different type contradicts Section 1; a project end on a fixed-term contract contradicts
  // the end date in clause 5.1.
  const onlyProjectEnd = conflicting.length === 1 && conflicting[0] === "specific_work";
  const templateClause = onlyProjectEnd && recorded === "fixed_term" ? "5.1" : "1";
  const says = conflicting.map((type) => CLAUSE_SAYS[type]).join(" and ");

  return {
    ruleId: TYPE_CONFLICT_RULE_ID,
    clause: clause.number,
    templateClause,
    severity: "high",
    confidence: clause.confidence,
    articles,
    explanation: `The contract records ${RECORDED_AS[recorded]}, but this clause says ${says}. An additional term that contradicts the contract is void and the contract type can only change through Qiwa, so the recorded type most likely prevails.`,
  };
}
