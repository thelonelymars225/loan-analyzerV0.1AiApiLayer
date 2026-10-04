import { pino } from "pino";
import type { Logger } from "pino";
import type { Config } from "./config";

/**
 * Structured JSON logs. Fastify's request logs carry method, URL and status only; bodies,
 * file names and contract contents are never logged. Credentials are redacted in case a
 * header object ever ends up in a log line.
 */
export function createLogger(level: Config["LOG_LEVEL"]): Logger {
  return pino({
    level,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        'res.headers["set-cookie"]',
        "headers.authorization",
        "headers.cookie",
      ],
      censor: "[redacted]",
    },
  });
}

/**
 * What we log about an unexpected error: no driver `detail` fields, which can echo the
 * values of a failed row (for example an email address).
 */
export function errorForLog(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { message: String(error) };
  const code = (error as { code?: unknown }).code;
  return { name: error.name, message: error.message, code, stack: error.stack };
}
