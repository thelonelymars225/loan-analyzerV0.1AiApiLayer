import { z } from "zod";

const LogLevel = z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]);

/**
 * Worker settings from the environment. STORAGE_ENCRYPTION_KEY and LLM settings are read by
 * createStorage and createLlmClient themselves, so they never end up in this object or in a
 * log line.
 */
export const WorkerConfig = z.object({
  DATABASE_URL: z.string({ error: "DATABASE_URL is required" }),
  /** Ratings processed at the same time by this process. */
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  /** Arabic OCR of Section 15. Also off when tesseract or its Arabic data is missing. */
  OCR_ENABLED: z.stringbool().default(true),
  /** Apply pending database migrations on start-up (safe with several processes). */
  DB_MIGRATE_ON_START: z.stringbool().default(true),
  LOCAL_STORAGE_DIR: z.string().optional(),
  LOG_LEVEL: LogLevel.default("info"),
});
export type WorkerConfig = z.infer<typeof WorkerConfig>;

/**
 * Parses the environment. Empty values count as unset, so `OCR_ENABLED=` in a compose file
 * falls back to the default instead of failing.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const setValues = Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined && value.trim() !== ""),
  );
  const parsed = WorkerConfig.safeParse(setValues);
  if (!parsed.success) {
    throw new Error(`Invalid worker configuration:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
