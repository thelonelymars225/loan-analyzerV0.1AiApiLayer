import type { ScoreCategory, View } from "./enums";

export const API_BASE = "/api/v1";

/** pg-boss queue names. */
export const QUEUES = {
  rate: "rate-contract",
  retention: "retention-sweep",
} as const;

/**
 * Options for the rating queue. The API and the worker both create the queue, and pg-boss
 * keeps whichever options arrive first, so both must pass the same ones.
 */
export const RATE_QUEUE_OPTIONS = {
  retryLimit: 2,
  retryDelay: 15,
  retryBackoff: true,
  expireInSeconds: 15 * 60,
} as const;

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const RATINGS_PER_USER_PER_DAY = 20;
export const DEFAULT_RETENTION_DAYS = 30;

/** Sub-score weights per view, in percent (Legal / Market / Clarity). */
export const VIEW_WEIGHTS: Record<View, Record<ScoreCategory, number>> = {
  employee: { legal: 40, market: 35, clarity: 25 },
  hr: { legal: 60, market: 10, clarity: 30 },
};

export const DISCLAIMER_EN = "Rating aid, not legal advice.";
export const DISCLAIMER_AR = "أداة تقييم مساعدة، وليست استشارة قانونية.";
