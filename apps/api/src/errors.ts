import type { ErrorCode } from "@rater/contracts";

/**
 * An error the API answers with on purpose. The error handler turns it into an
 * application/problem+json body with this status, code and detail.
 */
export class ApiError extends Error {
  override readonly name = "ApiError";

  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    detail: string,
    /** Extra response headers, e.g. Retry-After. */
    readonly headers: Record<string, string> = {},
  ) {
    super(detail);
  }
}

export const unauthorized = (detail = "Sign in to continue.") =>
  new ApiError(401, "unauthorized", detail);

export const forbidden = (detail = "You do not have permission to do this.") =>
  new ApiError(403, "forbidden", detail);

export const notFound = (detail = "Not found.") => new ApiError(404, "not_found", detail);

export const validationError = (detail: string) =>
  new ApiError(400, "validation_error", detail);

export const conflict = (detail: string) => new ApiError(409, "conflict", detail);

export const fileTooLarge = (maxBytes: number) =>
  new ApiError(
    413,
    "file_too_large",
    `The file is larger than ${Number((maxBytes / (1024 * 1024)).toFixed(1))} MB.`,
  );

export const unsupportedDocument = (detail: string) =>
  new ApiError(422, "unsupported_document", detail);

export const rateLimited = (limit: number, retryAfterSeconds: number) =>
  new ApiError(
    429,
    "rate_limited",
    `You can rate ${limit} contracts per day. Try again later.`,
    { "retry-after": String(retryAfterSeconds) },
  );

/** Too many open event streams for this user or this server; the client polls instead. */
export const tooManyStreams = () =>
  new ApiError(429, "rate_limited", "Too many open live updates. Try again later.", {
    "retry-after": "30",
  });

/** The browser tab acts on a different workspace than the session's active one. */
export const workspaceChanged = () =>
  conflict(
    "Your active workspace was changed, probably in another tab. Reload to see it before " +
      "making changes.",
  );
