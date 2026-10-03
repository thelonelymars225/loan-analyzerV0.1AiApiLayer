/**
 * The only seam between the rating engine and a language model. The engine (packages/core)
 * validates every reply against the Zod schemas in @rater/contracts and retries once, so an
 * adapter only has to send the prompt and parse JSON.
 */

/** A rule the analyser may match, with the text that tells it what to look for. */
export interface CandidateRule {
  id: string;
  title: string;
  detect: string;
  note?: string;
  articles: string[];
}

/** Article text fetched for the candidate rules (rule-first lookup, vector search as backstop). */
export interface ArticleText {
  /** Citation as the analyser must repeat it, e.g. "Art. 84". */
  citation: string;
  /** Arabic official text, if ingested. */
  textAr: string | null;
  /** Unofficial English, if available. */
  textEn: string | null;
}

export interface ClauseAnalysisRequest {
  /** Redacted clause. */
  clause: { number: string; textEn: string; textAr: string | null };
  /** Redacted one-paragraph summary of sections 1-14 (type, term, wage split, leave...). */
  fieldSummary: string;
  candidateRules: CandidateRule[];
  articles: ArticleText[];
  /** Set on the retry after an invalid reply: what was wrong with the previous one. */
  previousError?: string;
}

export interface CrossCheckRequest {
  fieldSummary: string;
  clauses: { number: string; textEn: string; textAr: string | null }[];
  candidateRules: CandidateRule[];
  articles: ArticleText[];
  previousError?: string;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmReply {
  /** Parsed JSON from the model. Validated by the caller, so typed as unknown here. */
  json: unknown;
  usage: LlmUsage;
}

export interface LlmClient {
  /** Pinned model ID, or the name of the offline analyser. Stored on every rating. */
  readonly model: string;
  /** Version of the prompt files in use, e.g. "s15-v1". Stored on every rating. */
  readonly promptVersion: string;
  /** Step 4b: which rules one Section 15 clause touches, and the verdict for each. */
  analyzeClause(req: ClauseAnalysisRequest): Promise<LlmReply>;
  /** Step 4c: Section 15 statements that contradict sections 1-14. */
  crossCheck(req: CrossCheckRequest): Promise<LlmReply>;
}
