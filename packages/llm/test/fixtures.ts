import type {
  CandidateRule,
  ClauseAnalysisRequest,
  CrossCheckRequest,
} from "../src/types";

/*
 * Synthetic requests shaped like the ones packages/core builds. The candidate rules mirror
 * the clause and cross rules in packages/law/rules/rules.json (IDs and citations).
 */

function candidate(id: string, articles: string[]): CandidateRule {
  return { id, title: `${id} title`, detect: `${id} detect text.`, articles };
}

/** Clause rules plus the field rules that have detect text: step 4b's candidates. */
export const CLAUSE_CANDIDATES: CandidateRule[] = [
  candidate("PROB-MAX-01", ["Art. 53", "Exec. Reg. Art. 19"]),
  candidate("LEAVE-MIN-01", ["Art. 109"]),
  candidate("LEAVE-FORFEIT-01", ["Arts. 109-111", "Art. 8"]),
  candidate("HOURS-MAX-01", ["Art. 98"]),
  candidate("OT-RATE-01", ["Art. 107"]),
  candidate("EOS-BASE-01", ["Art. 2", "Art. 84", "Art. 8"]),
  candidate("COMP-ART77-01", ["Art. 77"]),
  candidate("TYPE-ART57-01", ["Art. 57"]),
  candidate("TRANSFER-KSA-01", ["Art. 58", "Exec. Reg. Art. 20"]),
  candidate("NONCOMPETE-01", ["Art. 83(1)"]),
  candidate("CONFIDENTIAL-01", ["Art. 83(2)"]),
];

export const CROSS_CANDIDATES: CandidateRule[] = [
  candidate("TYPE-CONFLICT-01", ["Contract cl. 14.5", "Contract cl. 14.8.1", "Art. 74"]),
];

export const FIXED_TERM_SUMMARY =
  "Contract type: fixed-term. Start date: 2026-01-01. End date: 2026-12-31. Term: 12 months. Renews automatically: yes. Probation: 180 days. Annual leave: 21 days a year.";

export const INDEFINITE_SUMMARY =
  "Contract type: indefinite (open-ended). Start date: 2026-01-01. End date: not found. Term: not found. Probation: 90 days. Annual leave: 21 days a year.";

export function clauseRequest(
  text: { en?: string; ar?: string },
  options: {
    number?: string;
    fieldSummary?: string;
    candidateRules?: CandidateRule[];
  } = {},
): ClauseAnalysisRequest {
  return {
    clause: {
      number: options.number ?? "15.1",
      textEn: text.en ?? "",
      textAr: text.ar ?? null,
    },
    fieldSummary: options.fieldSummary ?? FIXED_TERM_SUMMARY,
    candidateRules: options.candidateRules ?? CLAUSE_CANDIDATES,
    articles: [{ citation: "Art. 84", textAr: "نص المادة", textEn: "Article text." }],
  };
}

export function crossRequest(
  clauses: { number: string; en?: string; ar?: string }[],
  fieldSummary: string,
  candidateRules: CandidateRule[] = CROSS_CANDIDATES,
): CrossCheckRequest {
  return {
    fieldSummary,
    clauses: clauses.map((clause) => ({
      number: clause.number,
      textEn: clause.en ?? "",
      textAr: clause.ar ?? null,
    })),
    candidateRules,
    articles: [],
  };
}
