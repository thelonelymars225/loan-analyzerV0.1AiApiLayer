import { createDb, migrate } from "@rater/db";
import { createStorage } from "@rater/storage";
import { buildApp } from "./app";
import { loadConfig } from "./config";
import { createLogger, errorForLog } from "./logger";
import { PgBossQueue } from "./queue";
import { startTelemetry } from "./telemetry";

/** Starts the API: migrations, queue, HTTP server; stops cleanly on SIGINT / SIGTERM. */
async function main(): Promise<void> {
  const stopTelemetry = startTelemetry();
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL);

  if (config.DB_MIGRATE_ON_START) await migrate(config.DATABASE_URL);
  const { db, pool } = createDb(config.DATABASE_URL, {
    onIdleError: (error) =>
      logger.error({ err: errorForLog(error) }, "idle database connection failed"),
  });
  const storage = createStorage(process.env);
  const queue = await PgBossQueue.start(config.DATABASE_URL, logger);
  const app = await buildApp({ config, db, storage, queue, logger });

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, "shutting down");
    try {
      await app.close(); // stops accepting requests and waits for running ones
      await queue.stop();
      await pool.end();
      // Losing the last few spans (collector down) is no reason to fail the shutdown.
      await stopTelemetry().catch((error: unknown) =>
        logger.warn({ err: errorForLog(error) }, "could not flush traces"),
      );
      process.exit(0);
    } catch (error) {
      logger.error({ err: errorForLog(error) }, "shutdown failed");
      process.exit(1);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ port: config.PORT, host: config.HOST });
}

main().catch((error: unknown) => {
  console.error("API failed to start:", error);
  process.exit(1);
});
