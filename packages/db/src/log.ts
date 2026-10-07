import { DrizzleQueryError } from "drizzle-orm";

/**
 * What the API and the worker log about an unexpected error: name, message, code and stack.
 * Not the other properties: a Postgres error's `detail` can echo the values of a failed row
 * (an email address, contract text). Failed database queries get their own, stricter shape.
 */
export function errorForLog(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { message: String(error) };
  if (error instanceof DrizzleQueryError) return queryErrorForLog(error);
  const code = (error as { code?: unknown }).code;
  return { name: error.name, message: error.message, code, stack: error.stack };
}

/**
 * Drizzle wraps every failed query in a DrizzleQueryError whose message is
 * "Failed query: <sql>\nparams: <values>", and the stack starts with that message. The
 * Postgres error inside can quote a value as well (`invalid input syntax for type integer:
 * "..."`). So we keep the SQL, which has placeholders ($1, $2, ...) instead of values, the
 * Postgres error code and the stack frames, and drop every message.
 */
function queryErrorForLog(error: DrizzleQueryError): Record<string, unknown> {
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
 * The stack without the message V8 puts at its top ("<name>: <message>"). A value can span
 * several lines, including lines that look like "    at ...", so the message is cut off by
 * its length rather than by matching frame lines. If the stack does not start the expected
 * way, it is left out.
 */
function stackFrames(error: Error): string | undefined {
  const header = `${String(error)}\n`;
  if (!error.stack?.startsWith(header)) return undefined;
  return error.stack.slice(header.length);
}
