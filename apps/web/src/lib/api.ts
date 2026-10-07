import {
  API_BASE,
  CreateRatingResponse,
  InvitePreview,
  InviteResponse,
  ListInvitesResponse,
  ListMembersResponse,
  ListRatingsResponse,
  MeResponse,
  ORG_HEADER,
  OrgSummary,
  Problem,
  RatingReport,
} from "@rater/contracts";
import type {
  CreateOrgBody,
  ErrorCode,
  InviteBody,
  OrgRole,
  SetActiveOrgBody,
  UpdateMemberBody,
  UpdateOrgBody,
  View,
} from "@rater/contracts";

/** Error codes the UI knows how to explain: the API's own codes plus client-side failures. */
export type ApiErrorCode = ErrorCode | "network" | "invalid_response";

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  /** The API's own explanation (problem+json `detail`), written for people, in English. */
  readonly detail: string | undefined;

  constructor(input: {
    status: number;
    code: ApiErrorCode;
    message: string;
    detail?: string;
  }) {
    super(input.message);
    this.name = "ApiError";
    this.status = input.status;
    this.code = input.code;
    this.detail = input.detail;
  }
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

/** Anything with Zod's `safeParse`; keeps zod itself out of the web app's dependencies. */
interface Schema<T> {
  safeParse(
    input: unknown,
  ): { success: true; data: T } | { success: false; error: unknown };
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  json?: unknown;
  form?: FormData;
  /**
   * Leave out the x-org-id header: for the few changes that do not act on the shown
   * workspace (switching it, accepting an invitation, deleting personal data).
   */
  withoutOrgHeader?: boolean;
}

/** Sent with every request so the API can render messages in the reader's language. */
let currentLanguage = "en";
export function setApiLanguage(language: string): void {
  currentLanguage = language;
}

/**
 * The workspace this tab shows (set by <RequireAuth> from /me). The active workspace lives in
 * the session cookie that every tab shares, so another tab may have switched it. Changes carry
 * this id in x-org-id and the API refuses them with 409 when it no longer matches, instead of
 * acting on a workspace the user is not looking at.
 */
let shownOrgId: string | null = null;
export function setShownOrg(orgId: string | null): void {
  shownOrgId = orgId;
}

async function send(path: string, options: RequestOptions = {}): Promise<Response> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Accept-Language": currentLanguage,
  };
  if (method !== "GET" && !options.withoutOrgHeader && shownOrgId) {
    headers[ORG_HEADER] = shownOrgId;
  }
  let body: BodyInit | undefined;
  if (options.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.json);
  } else if (options.form) {
    body = options.form; // the browser sets the multipart boundary
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body,
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError({ status: 0, code: "network", message: "Network request failed" });
  }
  if (!response.ok) throw await toApiError(response);
  return response;
}

async function requestJson<T>(
  path: string,
  schema: Schema<T>,
  options?: RequestOptions,
): Promise<T> {
  const response = await send(path, options);
  const data: unknown = await response.json();
  return checkContract(schema, data, path);
}

async function requestEmpty(path: string, options?: RequestOptions): Promise<void> {
  await send(path, options);
}

/**
 * In development every response is validated against the shared contract, so API drift shows
 * up immediately. Production trusts the API and skips the cost.
 */
function checkContract<T>(schema: Schema<T>, data: unknown, path: string): T {
  if (!import.meta.env.DEV) return data as T;
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  console.error(`[api] ${path}: response does not match the contract`, result.error);
  throw new ApiError({
    status: 0,
    code: "invalid_response",
    message: `Unexpected response from ${path}`,
  });
}

/** Reads an application/problem+json body; falls back to a code derived from the status. */
export async function toApiError(response: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Not JSON (for example a proxy error page): the status code is all we have.
  }
  const problem = Problem.safeParse(body);
  if (problem.success) {
    return new ApiError({
      status: response.status,
      code: problem.data.code,
      message: problem.data.detail ?? problem.data.title,
      detail: problem.data.detail,
    });
  }
  return new ApiError({
    status: response.status,
    code: codeForStatus(response.status),
    message: response.statusText || `HTTP ${response.status}`,
  });
}

function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 409:
      return "conflict";
    case 413:
      return "file_too_large";
    case 422:
      return "validation_error";
    case 429:
      return "rate_limited";
    default:
      return "internal";
  }
}

const enc = encodeURIComponent;

/** POST /orgs answers 201 with an OrgSummary; the UI only needs the new id. */
const CreatedOrg = OrgSummary.pick({ id: true });

export const api = {
  me: () => requestJson("/me", MeResponse),

  /** Makes another workspace the session's active one (in every tab). */
  setActiveOrg: (orgId: string) =>
    requestJson("/me/active-org", MeResponse, {
      method: "PUT",
      json: { orgId } satisfies SetActiveOrgBody,
      withoutOrgHeader: true,
    }),

  /** Deletes every rating and PDF in the caller's personal workspace, whichever is active. */
  deleteMyData: () =>
    requestEmpty("/me/data", { method: "DELETE", withoutOrgHeader: true }),

  listRatings: (cursor?: string | null) =>
    requestJson(
      cursor ? `/ratings?cursor=${enc(cursor)}` : "/ratings",
      ListRatingsResponse,
    ),

  /** Without a view the API renders the rating's default view. */
  getRating: (id: string, view?: View) =>
    requestJson(
      view ? `/ratings/${enc(id)}?view=${view}` : `/ratings/${enc(id)}`,
      RatingReport,
    ),

  createRating: (file: File, view: View) => {
    const form = new FormData();
    // Fields before the file: multipart parsers that stream the file only see earlier fields.
    form.append("view", view);
    form.append("file", file, file.name);
    return requestJson("/ratings", CreateRatingResponse, { method: "POST", form });
  },

  deleteRating: (id: string) => requestEmpty(`/ratings/${enc(id)}`, { method: "DELETE" }),

  createOrg: (body: CreateOrgBody) =>
    requestJson("/orgs", CreatedOrg, { method: "POST", json: body }),

  // The PATCH and DELETE endpoints below may answer 200 or 204; the UI refetches afterwards,
  // so their bodies are not read.
  updateOrg: (orgId: string, body: UpdateOrgBody) =>
    requestEmpty(`/orgs/${enc(orgId)}`, { method: "PATCH", json: body }),

  listMembers: (orgId: string) =>
    requestJson(`/orgs/${enc(orgId)}/members`, ListMembersResponse),

  invite: (orgId: string, body: InviteBody) =>
    requestJson(`/orgs/${enc(orgId)}/invites`, InviteResponse, {
      method: "POST",
      json: body,
    }),

  listInvites: (orgId: string) =>
    requestJson(`/orgs/${enc(orgId)}/invites`, ListInvitesResponse),

  cancelInvite: (orgId: string, inviteId: string) =>
    requestEmpty(`/orgs/${enc(orgId)}/invites/${enc(inviteId)}`, { method: "DELETE" }),

  /** The invitee's view of an invitation; 404 unless it is addressed to the signed-in user. */
  getInvite: (inviteId: string) =>
    requestJson(`/invites/${enc(inviteId)}`, InvitePreview),

  /** Joins the workspace and makes it the active one, so the answer is the new /me. */
  acceptInvite: (inviteId: string) =>
    requestJson(`/invites/${enc(inviteId)}/accept`, MeResponse, {
      method: "POST",
      withoutOrgHeader: true,
    }),

  updateMember: (orgId: string, userId: string, role: OrgRole) =>
    requestEmpty(`/orgs/${enc(orgId)}/members/${enc(userId)}`, {
      method: "PATCH",
      json: { role } satisfies UpdateMemberBody,
    }),

  removeMember: (orgId: string, userId: string) =>
    requestEmpty(`/orgs/${enc(orgId)}/members/${enc(userId)}`, { method: "DELETE" }),
};

export type Api = typeof api;

/**
 * URLs the browser fetches itself (an <img>, the PDF viewer) rather than through `api`. The
 * session cookie goes along as on any same-origin request.
 */
export const apiUrls = {
  /** PNG of the passage behind a finding, cut from the PDF on request (404 once it is deleted). */
  passageImage: (ratingId: string, clause: string, page: number) =>
    `${API_BASE}/ratings/${enc(ratingId)}/passages/${enc(clause)}/${page}`,
  /** PNG of one whole page, for the contract viewer (404 past the last page or once deleted). */
  page: (ratingId: string, page: number) =>
    `${API_BASE}/ratings/${enc(ratingId)}/pages/${page}`,
  /** The uploaded PDF: "inline" opens it in the browser, "attachment" downloads it. */
  document: (ratingId: string, disposition: "inline" | "attachment") =>
    `${API_BASE}/ratings/${enc(ratingId)}/document?disposition=${disposition}`,
};
