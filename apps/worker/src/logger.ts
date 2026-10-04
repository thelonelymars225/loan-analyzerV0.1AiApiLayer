import { pino } from "pino";
import type { Logger } from "pino";
import type { WorkerConfig } from "./config";

/**
 * Structured JSON logs. Rating logs carry the rating ID, step durations and LLM token counts;
 * never contract text, names or file contents.
 */
export function createLogger(level: WorkerConfig["LOG_LEVEL"]): Logger {
  return pino({ level, base: { service: "contract-rater-worker" } });
}

/**
 * What we log about an unexpected error: name, message, code and stack. Not the other
 * properties: a Postgres error's `detail` can echo the values of a failed row, which for
 * this worker means contract text.
 */
export function errorForLog(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { message: String(error) };
  const code = (error as { code?: unknown }).code;
  return { name: error.name, message: error.message, code, stack: error.stack };
}
