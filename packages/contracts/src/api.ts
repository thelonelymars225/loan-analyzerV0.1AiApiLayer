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
 * One place in the contract a finding is about, so the report can show the passage behind it
 * and open the contract viewer there. A clause that runs onto a second page is two passages.
 */
export const Passage = z.object({
  /** The clause shown: "15.4", or "1" for the whole of Section 1. */
  clause: z.string(),
  page: z.number().int().positive(),
  pageWidth: z.number().positive(),
  pageHeight: z.number().positive(),
  /** The clause's rows, across both language columns. */
  box: PageBox,
  /** What GET /ratings/{id}/passages/{clause}/{page} renders: the box plus a line of context. */
  crop: PageBox,
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

/**
 * A pending invitation. No email is sent in v1: an owner or admin copies `acceptPath`
 * (a link into the web app) and shares it. Only the invited email address can accept.
 */
export const InviteResponse = z.object({
  id: z.string(),
  email: z.string(),
  role: OrgRole,
  status: z.string(),
  expiresAt: z.string(),
  /** Web path the invitee opens to accept, e.g. "/invite/<id>". */
  acceptPath: z.string(),
});
export type InviteResponse = z.infer<typeof InviteResponse>;

/** GET /orgs/{id}/invites (owner or admin): pending invitations of the workspace. */
export const ListInvitesResponse = z.object({
  items: z.array(InviteResponse),
});
export type ListInvitesResponse = z.infer<typeof ListInvitesResponse>;

/** GET /invites/{id}: what the invitee sees before accepting. 404 for anyone else. */
export const InvitePreview = z.object({
  id: z.string(),
  orgName: z.string(),
  role: OrgRole,
  email: z.string(),
  status: z.string(),
  expiresAt: z.string(),
});
export type InvitePreview = z.infer<typeof InvitePreview>;

/** PUT /me/active-org: switch the session's workspace. Returns MeResponse. */
export const SetActiveOrgBody = z.object({
  orgId: z.string().min(1),
});
export type SetActiveOrgBody = z.infer<typeof SetActiveOrgBody>;

/**
 * Header the web app sends on every mutating request with the workspace it is showing.
 * The API answers 409 conflict when it differs from the session's active workspace.
 */
export const ORG_HEADER = "x-org-id";

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

/** GET /orgs/{id}/members: the org's members (used by the web org settings page). */
export const ListMembersResponse = z.object({
  items: z.array(MemberResponse),
});
export type ListMembersResponse = z.infer<typeof ListMembersResponse>;

export const HealthResponse = z.object({
  ok: z.boolean(),
  db: z.boolean(),
  queue: z.boolean(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;
