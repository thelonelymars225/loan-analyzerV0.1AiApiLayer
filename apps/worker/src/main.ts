import { loadConfig } from "./config";
import { createLogger, errorForLog } from "./logger";
import { startWorker } from "./worker";

/*
 * The rating worker: consumes QUEUES.rate (one rating per job) and runs the hourly sweep
 * (fails ratings whose job was lost, deletes PDFs past their retention). Logs are JSON lines;
 * pipe them through `pnpm exec pino-pretty` to read them locally.
 */

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const logger = createLogger(config.LOG_LEVEL);

  const worker = await startWorker({ config, env: process.env, logger });

  // The first signal stops gracefully. The listeners are removed after it, so a second
  // Ctrl-C ends the process at once.
  const shutdown = async (signal: NodeJS.Signals) => {
    logger.info({ signal }, "Stopping: letting running jobs finish");
    try {
      await worker.stop();
      logger.info("Worker stopped");
    } catch (error) {
      logger.error({ err: errorForLog(error) }, "Worker did not stop cleanly");
      process.exitCode = 1;
    }
  };
  process.once("SIGTERM", (signal) => void shutdown(signal));
  process.once("SIGINT", (signal) => void shutdown(signal));
}

main().catch((error: unknown) => {
  console.error("Worker failed to start:", error);
  process.exit(1);
});
