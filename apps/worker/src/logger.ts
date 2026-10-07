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

export { errorForLog } from "@rater/db";
