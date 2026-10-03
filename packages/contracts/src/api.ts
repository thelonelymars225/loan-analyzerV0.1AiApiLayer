import { z } from "zod";
import {
  Band,
  Confidence,
  OrgKind,
  OrgRole,
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
});
export type ViewFinding = z.infer<typeof ViewFinding>;

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

export const OrgSummary = z.object({
  id: z.string(),
  name: z.string(),
  kind: OrgKind,
  role: OrgRole,
  retentionDays: z.number().int(),
});
export type OrgSummary = z.infer<typeof OrgSummary>;

export const MeResponse = z.object({
  user: z.object({ id: z.string(), email: z.string(), name: z.string() }),
  activeOrgId: z.string().nullable(),
  orgs: z.array(OrgSummary),
});
export type MeResponse = z.infer<typeof MeResponse>;

export const CreateOrgBody = z.object({
  name: z.string().trim().min(2).max(120),
});
export type CreateOrgBody = z.infer<typeof CreateOrgBody>;

export const UpdateOrgBody = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  retentionDays: z.number().int().min(1).max(365).optional(),
});
export type UpdateOrgBody = z.infer<typeof UpdateOrgBody>;

export const InviteBody = z.object({
  email: z.email(),
  role: z.enum(["admin", "member"]),
});
export type InviteBody = z.infer<typeof InviteBody>;

export const InviteResponse = z.object({
  id: z.string(),
  email: z.string(),
  role: OrgRole,
  status: z.string(),
});
export type InviteResponse = z.infer<typeof InviteResponse>;

export const UpdateMemberBody = z.object({
  role: OrgRole,
});
export type UpdateMemberBody = z.infer<typeof UpdateMemberBody>;

export const MemberResponse = z.object({
  userId: z.string(),
  email: z.string(),
  name: z.string(),
  role: OrgRole,
});
export type MemberResponse = z.infer<typeof MemberResponse>;

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
