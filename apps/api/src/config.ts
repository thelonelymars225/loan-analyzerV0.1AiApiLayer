import { z } from "zod";
import { MAX_UPLOAD_BYTES, RATINGS_PER_USER_PER_DAY } from "@rater/contracts";

/** "true"/"false" environment flags. */
const flag = (fallback: boolean) =>
  z
    .enum(["true", "false"])
    .default(fallback ? "true" : "false")
    .transform((value) => value === "true");

const Env = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().min(1),
    PORT: z.coerce.number().int().min(0).max(65_535).default(3000),
    HOST: z.string().min(1).default("0.0.0.0"),
    /** Signs session cookies. Required in production (`openssl rand -base64 32`). */
    BETTER_AUTH_SECRET: z.string().min(32).optional(),
    /** Public URL of the API; Better Auth builds its links from it. */
    BETTER_AUTH_URL: z.url().default("http://localhost:3000"),
    /** Where the web app is served from. Allowed by CORS and Better Auth's origin check. */
    WEB_ORIGIN: z.url().default("http://localhost:5173"),
    /**
     * "local" or "s3". The driver reads its own variables (LOCAL_STORAGE_DIR,
     * STORAGE_ENCRYPTION_KEY, S3_*) in @rater/storage; this only fails fast on a typo.
     */
    STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    RATE_LIMIT_PER_DAY: z.coerce
      .number()
      .int()
      .positive()
      .default(RATINGS_PER_USER_PER_DAY),
    MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(MAX_UPLOAD_BYTES),
    /** Apply database migrations on start-up (safe when the worker does it too). */
    MIGRATE_ON_START: flag(true),
  })
  .refine((env) => env.NODE_ENV !== "production" || env.BETTER_AUTH_SECRET, {
    message: "BETTER_AUTH_SECRET is required in production",
    path: ["BETTER_AUTH_SECRET"],
  });

export type Config = z.infer<typeof Env>;

/** Reads and validates the API's environment. Throws one error listing every problem. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = Env.safeParse(withoutEmptyValues(env));
  if (!result.success) {
    throw new Error(`Invalid API configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

/** `FOO=` in a .env file means "not set", not "set to an empty string". */
function withoutEmptyValues(env: NodeJS.ProcessEnv): Record<string, string> {
  const entries = Object.entries(env).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined && entry[1].trim() !== "",
  );
  return Object.fromEntries(entries);
}

const VITE_DEV_ORIGIN = "http://localhost:5173";

/**
 * Origins allowed to call the API with cookies (CORS and Better Auth's origin check): the
 * configured web app, plus Vite's dev server outside production.
 */
export function trustedOrigins(config: Config): string[] {
  const origins = [new URL(config.WEB_ORIGIN).origin];
  if (config.NODE_ENV !== "production") origins.push(VITE_DEV_ORIGIN);
  return [...new Set(origins)];
}
