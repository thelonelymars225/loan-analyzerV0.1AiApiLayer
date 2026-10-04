import type { TFunction } from "i18next";
import { ApiError, type ApiErrorCode } from "./api";
import { MAX_UPLOAD_MB, type UploadProblem } from "./upload";

const API_ERROR_KEYS: Record<ApiErrorCode, string> = {
  unauthorized: "errors.unauthorized",
  forbidden: "errors.forbidden",
  not_found: "errors.not_found",
  validation_error: "errors.validation_error",
  unsupported_document: "errors.unsupported_document",
  file_too_large: "errors.file_too_large",
  rate_limited: "errors.rate_limited",
  conflict: "errors.conflict",
  internal: "errors.internal",
  network: "errors.network",
  invalid_response: "errors.invalid_response",
};

/** A friendly, translated sentence for any error the API layer can throw. */
export function errorMessage(t: TFunction, error: unknown): string {
  if (!(error instanceof ApiError)) return t("errors.unknown");
  return t(API_ERROR_KEYS[error.code]);
}

/** Translates a stored rating error code (ratings.error.code); unknown codes get a generic line. */
export function ratingErrorMessage(t: TFunction, code: string): string {
  const key = API_ERROR_KEYS[code as ApiErrorCode];
  return key ? t(key) : t("errors.rating_failed");
}

const UPLOAD_PROBLEM_KEYS: Record<UploadProblem, string> = {
  not_pdf: "upload.errors.not_pdf",
  too_large: "upload.errors.too_large",
  empty: "upload.errors.empty",
};

export function uploadProblemMessage(t: TFunction, problem: UploadProblem): string {
  return t(UPLOAD_PROBLEM_KEYS[problem], { max: MAX_UPLOAD_MB });
}

const AUTH_ERROR_KEYS: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "auth.errors.invalid_credentials",
  INVALID_EMAIL: "auth.errors.invalid_email",
  USER_ALREADY_EXISTS: "auth.errors.user_exists",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "auth.errors.user_exists",
  PASSWORD_TOO_SHORT: "auth.errors.password_too_short",
  PASSWORD_TOO_LONG: "auth.errors.password_too_long",
};

export function authErrorMessage(t: TFunction, code: string | undefined): string {
  const key = code ? AUTH_ERROR_KEYS[code] : undefined;
  return t(key ?? "auth.errors.generic");
}
