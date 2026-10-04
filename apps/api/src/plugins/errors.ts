import type { FastifyInstance } from "fastify";
import { isAPIError } from "better-auth/api";
import { hasZodFastifySchemaValidationErrors } from "fastify-type-provider-zod";
import type { ErrorCode, Problem } from "@rater/contracts";
import { ApiError } from "../errors";
import { errorForLog } from "../logger";

/**
 * Every error leaves the API as application/problem+json (RFC 9457) with a stable `code`
 * from ErrorCode, so clients branch on the code and show `detail` to people.
 */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    const { problem, headers } = toProblem(error);
    if (problem.status >= 500) {
      request.log.error({ err: errorForLog(error) }, "request failed");
    }
    return reply
      .code(problem.status)
      .headers(headers)
      .type("application/problem+json")
      .send(problem);
  });

  app.setNotFoundHandler((request, reply) => {
    const problem = makeProblem(
      404,
      "not_found",
      `No route for ${request.method} ${request.url}.`,
    );
    return reply.code(404).type("application/problem+json").send(problem);
  });
}

const TITLES: Record<ErrorCode, string> = {
  unauthorized: "Unauthorized",
  forbidden: "Forbidden",
  not_found: "Not found",
  validation_error: "Invalid request",
  unsupported_document: "Unsupported document",
  file_too_large: "File too large",
  rate_limited: "Too many requests",
  conflict: "Conflict",
  internal: "Internal server error",
};

export function makeProblem(status: number, code: ErrorCode, detail?: string): Problem {
  return {
    type: `urn:contract-rater:error:${code}`,
    title: TITLES[code],
    status,
    code,
    ...(detail ? { detail } : {}),
  };
}

/** Multipart limits other than the file size: the request had the wrong shape. */
const MULTIPART_SHAPE_ERRORS = new Set([
  "FST_FILES_LIMIT",
  "FST_FIELDS_LIMIT",
  "FST_PARTS_LIMIT",
]);
const BODY_TOO_LARGE_ERRORS = new Set([
  "FST_REQ_FILE_TOO_LARGE",
  "FST_ERR_CTP_BODY_TOO_LARGE",
]);

export function toProblem(error: unknown): {
  problem: Problem;
  headers: Record<string, string>;
} {
  if (error instanceof ApiError) {
    return {
      problem: makeProblem(error.status, error.code, error.message),
      headers: error.headers,
    };
  }
  if (hasZodFastifySchemaValidationErrors(error)) {
    const context =
      (error as { validationContext?: string }).validationContext ?? "request";
    const detail = error.validation
      .map((issue) => `${context}${issue.instancePath}: ${issue.message}`)
      .join("; ");
    return { problem: makeProblem(400, "validation_error", detail), headers: {} };
  }

  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && BODY_TOO_LARGE_ERRORS.has(code)) {
    return {
      problem: makeProblem(413, "file_too_large", "The file is too large."),
      headers: {},
    };
  }
  if (typeof code === "string" && MULTIPART_SHAPE_ERRORS.has(code)) {
    return {
      problem: makeProblem(400, "validation_error", 'Send one PDF in the "file" field.'),
      headers: {},
    };
  }

  // Better Auth errors (from auth.api calls) and Fastify's own 4xx errors (bad JSON,
  // wrong content type, ...) keep their status; the code follows from it.
  const status = isAPIError(error)
    ? error.statusCode
    : ((error as { statusCode?: unknown }).statusCode as number | undefined);
  if (typeof status === "number" && status >= 400 && status < 500) {
    const detail = isAPIError(error) ? error.body?.message : (error as Error).message;
    return { problem: makeProblem(status, codeForStatus(status), detail), headers: {} };
  }
  return { problem: makeProblem(500, "internal", "Something went wrong."), headers: {} };
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
    case 429:
      return "rate_limited";
    default:
      return "validation_error";
  }
}
