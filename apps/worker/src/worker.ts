import { createDb, migrate } from "@rater/db";
import { loadRules } from "@rater/law";
import { createLlmClient } from "@rater/llm";
import { ocrArabicRegions, toolsAvailable } from "@rater/pdf";
import { createStorage } from "@rater/storage";
import { PgBoss } from "pg-boss";
import type { Logger } from "pino";
import type { WorkerConfig } from "./config";
import { errorForLog } from "./logger";
import { createArticleLookup } from "./pg-article-lookup";
import { PgClauseCache } from "./pg-clause-cache";
import { registerJobs } from "./queue";
import type { ArabicOcr, RateJobDeps } from "./rate-job";

export interface StartWorkerOptions {
  config: WorkerConfig;
  /** Storage and LLM settings are read from here (createStorage, createLlmClient). */
  env: NodeJS.ProcessEnv;
  logger: Logger;
}

export interface RunningWorker {
  /** Lets running jobs finish (up to 30 s), then closes every connection. */
  stop(): Promise<void>;
}

/** How long a graceful stop waits for running ratings before pg-boss hands them back for retry. */
const STOP_TIMEOUT_MS = 30_000;

/** Connects everything, starts consuming the rating and retention queues, and returns a handle to stop. */
export async function startWorker(options: StartWorkerOptions): Promise<RunningWorker> {
  const { config, env, logger } = options;

  if (config.DB_MIGRATE_ON_START) await migrate(config.DATABASE_URL);
  const { db, pool } = createDb(config.DATABASE_URL, {
    // One connection per concurrent rating, plus a little room for the retention sweep.
    max: config.WORKER_CONCURRENCY + 2,
    onIdleError: (error) =>
      logger.error({ err: errorForLog(error) }, "Idle database connection failed"),
  });
  const boss = new PgBoss({
    connectionString: config.DATABASE_URL,
    application_name: "contract-rater-worker",
  });
  boss.on("error", (error) => logger.error({ err: errorForLog(error) }, "pg-boss error"));

  try {
    const deps: RateJobDeps = {
      db,
      storage: createStorage(env),
      llm: createLlmClient(env),
      articles: await createArticleLookup(db, logger),
      cache: new PgClauseCache(db),
      rules: loadRules(),
      ocr: await checkPdfTools(config, logger),
      logger,
    };
    await boss.start();
    await registerJobs(boss, deps, config.WORKER_CONCURRENCY);
    logger.info(
      {
        concurrency: config.WORKER_CONCURRENCY,
        storage: config.STORAGE_DRIVER,
        model: deps.llm.model,
        promptVersion: deps.llm.promptVersion,
        rulesetVersion: deps.rules.rulesetVersion,
        lawVersion: deps.rules.lawVersion,
        ocr: deps.ocr !== undefined,
      },
      "Worker started",
    );
  } catch (error) {
    await boss.stop({ graceful: false }).catch(() => {});
    await pool.end();
    throw error;
  }

  return {
    async stop() {
      try {
        await boss.stop({ graceful: true, timeout: STOP_TIMEOUT_MS });
      } finally {
        await pool.end();
      }
    },
  };
}

/**
 * Checks the PDF tools once at start-up and returns the Arabic OCR function when it can run.
 * pdftotext is required: without it every rating would fail. Arabic OCR is optional; without
 * it Section 15 is analysed in English only.
 */
async function checkPdfTools(
  config: WorkerConfig,
  logger: Logger,
): Promise<ArabicOcr | undefined> {
  const tools = await toolsAvailable();
  logger.info({ tools }, "PDF tools");
  if (!tools.pdftotext) {
    throw new Error(
      "pdftotext is not installed (poppler-utils); the worker cannot read PDFs",
    );
  }
  if (!config.OCR_ENABLED) {
    logger.info("Arabic OCR is turned off (OCR_ENABLED=false)");
    return undefined;
  }
  if (!tools.pdftoppm || !tools.tesseract || !tools.tesseractAra) {
    logger.warn(
      "Arabic OCR needs pdftoppm, tesseract and its Arabic data; Section 15 will be analysed in English only",
    );
    return undefined;
  }
  return arabicOcr;
}

const arabicOcr: ArabicOcr = (pdf, regions, logger) =>
  ocrArabicRegions(pdf, regions, {
    onError: (error, region) =>
      logger.warn(
        { err: errorForLog(error), page: region.page },
        "Arabic OCR failed for one region; skipping it",
      ),
  });
