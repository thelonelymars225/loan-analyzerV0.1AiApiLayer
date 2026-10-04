import {
  API_BASE,
  CreateRatingResponse,
  InviteResponse,
  ListMembersResponse,
  ListRatingsResponse,
  MeResponse,
  OrgSummary,
  Problem,
  RatingReport,
} from "@rater/contracts";
import type {
  CreateOrgBody,
  ErrorCode,
  InviteBody,
  OrgRole,
  UpdateMemberBody,
  UpdateOrgBody,
  View,
} from "@rater/contracts";

/** Error codes the UI knows how to explain: the API's own codes plus client-side failures. */
export type ApiErrorCode = ErrorCode | "network" | "invalid_response";

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;

  constructor(input: { status: number; code: ApiErrorCode; message: string }) {
    super(input.message);
    this.name = "ApiError";
    this.status = input.status;
    this.code = input.code;
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
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  json?: unknown;
  form?: FormData;
}

/** Sent with every request so the API can render messages in the reader's language. */
let currentLanguage = "en";
export function setApiLanguage(language: string): void {
  currentLanguage = language;
}

async function send(path: string, options: RequestOptions = {}): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Accept-Language": currentLanguage,
  };
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
      method: options.method ?? "GET",
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

  updateMember: (orgId: string, userId: string, role: OrgRole) =>
    requestEmpty(`/orgs/${enc(orgId)}/members/${enc(userId)}`, {
      method: "PATCH",
      json: { role } satisfies UpdateMemberBody,
    }),

  removeMember: (orgId: string, userId: string) =>
    requestEmpty(`/orgs/${enc(orgId)}/members/${enc(userId)}`, { method: "DELETE" }),
};

export type Api = typeof api;
