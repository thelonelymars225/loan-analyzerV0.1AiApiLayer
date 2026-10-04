import { DrizzleQueryError } from "drizzle-orm";
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
 * What we log about an unexpected error: no driver `detail` fields and no query parameters,
 * which can echo the values of a failed row (for example an email address).
 */
export function errorForLog(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { message: String(error) };
  if (error instanceof DrizzleQueryError) return drizzleQueryErrorForLog(error);
  const code = (error as { code?: unknown }).code;
  return { name: error.name, message: error.message, code, stack: error.stack };
}

/**
 * Drizzle's message is "Failed query: <sql>\nparams: <values>", and the stack repeats it.
 * Keep the SQL (placeholders only) and the Postgres error code; drop the values.
 */
function drizzleQueryErrorForLog(error: DrizzleQueryError): Record<string, unknown> {
  const cause = error.cause as { name?: unknown; code?: unknown } | undefined;
  return {
    name: "DrizzleQueryError",
    message: `Failed query: ${error.query}`,
    code: cause?.code,
    cause: cause ? { name: cause.name, code: cause.code } : undefined,
    stack: stackFrames(error),
  };
}

/**
 * The stack without the message V8 puts at its top ("<name>: <message>"). A parameter value
 * can span several lines, including lines that look like "    at ...", so the message is
 * cut off by its length rather than by matching frame lines. Same rule as the worker.
 */
function stackFrames(error: Error): string | undefined {
  const header = `${String(error)}\n`;
  if (!error.stack?.startsWith(header)) return undefined;
  return error.stack.slice(header.length);
}
