import { z } from "zod";
import {
  Band,
  Confidence,
  RatingStatus,
  ScoreCategory,
  Severity,
  Verdict,
  View,
} from "./enums";
import { ContractFields } from "./fields";
import { Rule } from "./rule";

/** Error body for every 4xx/5xx (application/problem+json). `code` is stable. */
export const ErrorCode = z.enum([
  "unauthorized",
  "forbidden",
  "not_found",
  "validation_error",
  "unsupported_document",
  "file_too_large",
  "rate_limited",
  "conflict",
  "internal",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const Problem = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: ErrorCode,
  detail: z.string().optional(),
});
export type Problem = z.infer<typeof Problem>;

export const Versions = z.object({
  law: z.string(),
  ruleset: z.string(),
  prompt: z.string(),
  model: z.string(),
});
export type Versions = z.infer<typeof Versions>;

/** A rectangle on a page, in PDF points from the page's top-left corner. */
export const PageBox = z.object({
  xMin: z.number(),
  yMin: z.number(),
  xMax: z.number(),
  yMax: z.number(),
});
export type PageBox = z.infer<typeof PageBox>;

/**
 * One place in the contract a finding is about, so the report can open the contract viewer
 * there. A clause that runs onto a second page is two passages.
 */
export const Passage = z.object({
  /** The clause shown: "15.4", or "1" for the whole of Section 1. */
  clause: z.string(),
  page: z.number().int().positive(),
  pageWidth: z.number().positive(),
  pageHeight: z.number().positive(),
  /** The clause's rows, across both language columns. */
  box: PageBox,
  /** The clause as it was rated (redacted). Only Section 15 items have stored text. */
  textEn: z.string().nullable(),
  textAr: z.string().nullable(),
  /** True when the clause itself was not placed and its section or parent clause is shown. */
  approximate: z.boolean(),
});
export type Passage = z.infer<typeof Passage>;

/** A finding as one view presents it. */
export const ViewFinding = z.object({
  ruleId: z.string(),
  title: z.string(),
  clause: z.string().nullable(),
  verdict: Verdict,
  severity: Severity,
  confidence: Confidence,
  categories: z.array(ScoreCategory),
  /** The view's message (employeeMsg or hrMsg). */
  message: z.string(),
  explanation: z.string(),
  articles: z.array(z.string()),
  /** SAR figures keyed as in Impact.sar. */
  impactSar: z.record(z.string(), z.number()).nullable(),
  impactKind: z.string().nullable(),
  /** Employee view: what to ask for. HR view: suggested wording. */
  action: z.string().nullable(),
  needsReview: z.boolean(),
  /** Where in the contract: the finding's clause first, then a related clause. Empty if unplaced. */
  passages: z.array(Passage),
});
export type ViewFinding = z.infer<typeof ViewFinding>;

/** The uploaded PDF behind a report, as far as the viewer needs to know. */
export const ReportDocument = z.object({
  pages: z.number().int().positive().nullable(),
  /** False once retention (or the user) has removed the file; passages then show text only. */
  available: z.boolean(),
  deletedAt: z.string().nullable(),
});
export type ReportDocument = z.infer<typeof ReportDocument>;

export const ViewDeadline = z.object({
  ruleId: z.string(),
  kind: z.enum(["renewal_notice", "probation_end"]),
  date: z.string(),
  message: z.string(),
});
export type ViewDeadline = z.infer<typeof ViewDeadline>;

export const ViewScore = z.object({
  overall: z.number().int(),
  legal: z.number().int(),
  market: z.number().int(),
  clarity: z.number().int(),
  band: Band,
  marketConfidence: Confidence,
});
export type ViewScore = z.infer<typeof ViewScore>;

/** A rendered report: GET /ratings/{id}?view=employee|hr once status is done. */
export const RatingReport = z.object({
  id: z.string(),
  status: RatingStatus,
  view: View,
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  score: ViewScore.nullable(),
  deadlines: z.array(ViewDeadline),
  /** Problems, ordered for the view. */
  findings: z.array(ViewFinding),
  /** "What's good": positive findings. */
  good: z.array(ViewFinding),
  /** Legal information that always applies (info rules). */
  info: z.array(ViewFinding),
  fields: ContractFields.nullable(),
  versions: Versions.nullable(),
  /** Why a needs_review rating needs a human look (e.g. wage parts that do not add up). */
  reviewReasons: z.array(z.string()),
  document: ReportDocument,
  disclaimer: z.string(),
});
export type RatingReport = z.infer<typeof RatingReport>;

export const CreateRatingResponse = z.object({
  id: z.string(),
  status: z.literal("queued"),
});
export type CreateRatingResponse = z.infer<typeof CreateRatingResponse>;

export const RatingSummary = z.object({
  id: z.string(),
  status: RatingStatus,
  defaultView: View,
  scoreOverall: z.number().int().nullable(),
  band: Band.nullable(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type RatingSummary = z.infer<typeof RatingSummary>;

export const ListRatingsResponse = z.object({
  items: z.array(RatingSummary),
  nextCursor: z.string().nullable(),
});
export type ListRatingsResponse = z.infer<typeof ListRatingsResponse>;

/** Server-sent event payload on GET /ratings/{id}/events. */
export const RatingEvent = z.object({
  id: z.string(),
  status: RatingStatus,
});
export type RatingEvent = z.infer<typeof RatingEvent>;

export const MeResponse = z.object({
  user: z.object({ id: z.string(), email: z.string(), name: z.string() }),
});
export type MeResponse = z.infer<typeof MeResponse>;

export const RulesResponse = z.object({
  rulesetVersion: z.string(),
  lawVersion: z.string(),
  rules: z.array(Rule),
});
export type RulesResponse = z.infer<typeof RulesResponse>;

export const HealthResponse = z.object({
  ok: z.boolean(),
  db: z.boolean(),
  queue: z.boolean(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;
