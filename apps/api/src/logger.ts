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

export { errorForLog } from "@rater/db";
