import i18n, { type TFunction } from "i18next";
import { ApiError, type ApiErrorCode } from "./api";

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

/**
 * The API explains each error in English (problem+json `detail`, or the stored message of a
 * failed rating). That text is more precise than our per-code copy: the real upload limit, or
 * that a PDF is damaged rather than not a Qiwa contract. English readers get it; Arabic readers
 * get the translated copy for the code, which is written to be true in every case.
 */
function canShowServerText(text: string | undefined): text is string {
  return Boolean(text?.trim()) && !i18n.language?.startsWith("ar");
}

/** A friendly sentence for any error the API layer can throw. */
export function errorMessage(t: TFunction, error: unknown): string {
  if (!(error instanceof ApiError)) return t("errors.unknown");
  if (canShowServerText(error.detail)) return error.detail;
  return t(API_ERROR_KEYS[error.code]);
}

/** Error codes only a failed rating carries (set by the worker). */
const RATING_ERROR_KEYS: Record<string, string> = {
  timeout: "errors.rating_timeout",
  document_missing: "errors.document_missing",
};

/** Explains a failed rating (report.error); codes the web does not know get a generic line. */
export function ratingErrorMessage(
  t: TFunction,
  error: { code: string; message: string },
): string {
  if (canShowServerText(error.message)) return error.message;
  const key = RATING_ERROR_KEYS[error.code] ?? API_ERROR_KEYS[error.code as ApiErrorCode];
  return key ? t(key) : t("errors.rating_failed");
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
