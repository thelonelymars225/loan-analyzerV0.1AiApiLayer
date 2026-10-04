import type { Span } from "@opentelemetry/api";
import type { RulesFile } from "@rater/contracts";
import { detectQiwa, parseBboxXhtml, runPipeline } from "@rater/core";
import type { ArticleLookup, ClauseCache, PageLayout, PageRegion } from "@rater/core";
import type { Db } from "@rater/db";
import type { LlmClient } from "@rater/llm";
import { PdfToolError, pdftotextBbox } from "@rater/pdf";
import { ObjectNotFoundError } from "@rater/storage";
import type { ObjectStorage } from "@rater/storage";
import type { Logger } from "pino";
import { errorForLog } from "./logger";
import {
  findDocument,
  findRating,
  markAnalysing,
  markExtracting,
  markFailed,
  saveResult,
} from "./rating-store";
import type { RatedResult, RatingRow } from "./rating-store";
import { withSpan } from "./telemetry";

/*
 * One rating job: read the PDF, run the pipeline (packages/core runPipeline, the same code the
 * evals measure), and save the result.
 *
 *   queued → extracting  read the PDF from storage, pdftotext, check it is a Qiwa contract
 *          → analysing   runPipeline: extraction, Arabic OCR, redaction, rules, Section 15
 *                        analysis, impact and scores
 *          → done | needs_review   everything saved in one transaction
 *          → failed      with error_code unsupported_document, document_missing or internal
 *                        (or timeout, set by the hourly sweep when a job was lost: stuck-ratings.ts)
 *
 * Retries: an unexpected error is rethrown so pg-boss retries the job. The rating is marked
 * failed only on the final attempt, so the user never sees "failed" flip back to "extracting".
 * A retry re-runs the whole job: the cheap steps are deterministic, and clauses analysed by an
 * earlier attempt come from the clause cache, so in effect it resumes where the last one stopped.
 */

/** Arabic OCR of the Section 15 regions of one PDF. Problems are logged to `logger`. */
export type ArabicOcr = (
  pdf: Buffer,
  regions: PageRegion[],
  logger: Logger,
) => Promise<string>;

export interface RateJobDeps {
  db: Db;
  storage: ObjectStorage;
  llm: LlmClient;
  articles: ArticleLookup;
  cache: ClauseCache;
  rules: RulesFile;
  /** Without OCR, Section 15 is analysed from the English text alone. */
  ocr?: ArabicOcr;
  logger: Logger;
  /** YYYY-MM-DD, for deadlines. Defaults to today in Saudi Arabia. */
  today?: string;
}

export interface ProcessOptions {
  /**
   * Whether pg-boss will give up after this attempt. Only the final attempt marks the rating
   * failed after an unexpected error. Defaults to true (no retries).
   */
  finalAttempt?: boolean;
}

/** "skipped": the rating no longer exists (deleted before or while the job ran). */
export type RatingOutcome = "done" | "needs_review" | "failed" | "skipped";

/** Shown to the user after an unexpected error. The details go to the logs. */
export const INTERNAL_ERROR_MESSAGE =
  "Something went wrong while rating this contract. Please try again later.";
export const DOCUMENT_MISSING_MESSAGE =
  "The uploaded PDF is no longer available. Please upload it again.";
export const UNREADABLE_PDF_MESSAGE =
  "The PDF could not be read. It may be damaged or password-protected.";

/** An expected way for a rating to fail. Retrying would not help, so the job ends here. */
export class RatingFailure extends Error {
  override readonly name = "RatingFailure";

  constructor(
    readonly code: "unsupported_document" | "document_missing",
    message: string,
  ) {
    super(message);
  }
}

export async function processRating(
  ratingId: string,
  deps: RateJobDeps,
  options: ProcessOptions = {},
): Promise<RatingOutcome> {
  const logger = deps.logger.child({ ratingId });
  const job = { ...deps, logger };

  return withSpan("rating.process", { "rating.id": ratingId }, async (span) => {
    const startedAt = performance.now();
    const elapsed = () => Math.round(performance.now() - startedAt);

    const rating = await findRating(deps.db, ratingId);
    if (!rating) {
      logger.warn("Rating not found (deleted before the job ran); skipping");
      return "skipped";
    }

    try {
      const outcome = await rate(rating, job);
      span.setAttribute("rating.outcome", outcome);
      logger.info({ outcome, durationMs: elapsed() }, "Rating finished");
      return outcome;
    } catch (error) {
      if (error instanceof RatingFailure) {
        await markFailed(deps.db, ratingId, error.code, error.message);
        span.setAttribute("rating.outcome", "failed");
        logger.info({ errorCode: error.code, durationMs: elapsed() }, "Rating failed");
        return "failed";
      }
      const finalAttempt = options.finalAttempt ?? true;
      logger.error(
        { err: errorForLog(error), finalAttempt, durationMs: elapsed() },
        "Rating job crashed",
      );
      if (finalAttempt) {
        await markFailed(deps.db, ratingId, "internal", INTERNAL_ERROR_MESSAGE);
      }
      throw error;
    }
  });
}

async function rate(rating: RatingRow, job: RateJobDeps): Promise<RatingOutcome> {
  const { db } = job;

  await markExtracting(db, rating.id);
  const pdf = await runStep("read_pdf", job, () => readPdf(rating, job));
  const pages = await runStep("pdftotext", job, () => readPages(pdf));
  const detection = detectQiwa(pages);
  if (!detection.ok) throw new RatingFailure("unsupported_document", detection.reason);

  await markAnalysing(db, rating.id);
  const ocr = job.ocr;
  const result = await runStep("analyse", job, async (span) => {
    const output = await runPipeline({
      pages,
      ocrArabic: ocr
        ? (regions) => runStep("ocr", job, () => ocr(pdf, regions, job.logger))
        : undefined,
      rules: job.rules,
      llm: job.llm,
      articles: job.articles,
      cache: job.cache,
      today: job.today ?? todayInRiyadh(),
    });
    span.setAttributes({
      "llm.model": output.versions.model,
      "llm.input_tokens": output.usage.inputTokens,
      "llm.output_tokens": output.usage.outputTokens,
      "rating.findings": output.findings.length,
    });
    return output;
  });
  // detectQiwa already passed, so this is only a safety net.
  if (result.status === "rejected" || !result.extraction) {
    throw new RatingFailure(
      "unsupported_document",
      result.rejectReason ?? "Not a Qiwa contract.",
    );
  }
  job.logger.info(
    {
      status: result.status,
      clauses: result.extraction.clauses.length,
      findings: result.findings.length,
      extractionIssues: result.extraction.issues.length,
      model: result.versions.model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    },
    "Analysis finished",
  );

  const rated: RatedResult = {
    ...result,
    status: result.status,
    extraction: result.extraction,
  };
  const saved = await runStep("save", job, () => saveResult(db, rating, rated));
  return saved ? rated.status : "skipped";
}

/** Runs one step in its own span and logs how long it took. */
async function runStep<T>(
  step: string,
  job: RateJobDeps,
  work: (span: Span) => Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  const value = await withSpan(`rating.${step}`, {}, work);
  job.logger.info(
    { step, durationMs: Math.round(performance.now() - startedAt) },
    "Step finished",
  );
  return value;
}

async function readPdf(rating: RatingRow, job: RateJobDeps): Promise<Buffer> {
  const document = await findDocument(job.db, rating);
  // deletedAt is set once retention (or the user) removed the file from storage.
  if (!document || document.deletedAt) {
    throw new RatingFailure("document_missing", DOCUMENT_MISSING_MESSAGE);
  }
  try {
    return await job.storage.get(document.storageKey);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      throw new RatingFailure("document_missing", DOCUMENT_MISSING_MESSAGE);
    }
    throw error;
  }
}

async function readPages(pdf: Buffer): Promise<PageLayout[]> {
  try {
    return parseBboxXhtml(await pdftotextBbox(pdf));
  } catch (error) {
    if (isUnreadablePdf(error)) {
      throw new RatingFailure("unsupported_document", UNREADABLE_PDF_MESSAGE);
    }
    throw error;
  }
}

/**
 * pdftotext ran and exited with an error code: the file is damaged or encrypted, and a retry
 * would fail the same way. A missing binary or a timeout is not the file's fault, so those
 * stay unexpected errors and are retried.
 */
function isUnreadablePdf(error: unknown): boolean {
  if (!(error instanceof PdfToolError)) return false;
  const exitCode = (error.cause as { code?: unknown } | undefined)?.code;
  return typeof exitCode === "number";
}

/** Saudi Arabia is UTC+3 all year (no daylight saving time). */
const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Today's date in Saudi Arabia, as YYYY-MM-DD. Deadlines are calendar dates there. */
export function todayInRiyadh(now: Date = new Date()): string {
  return new Date(now.getTime() + RIYADH_OFFSET_MS).toISOString().slice(0, 10);
}
