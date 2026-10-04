import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  CreateRatingResponse,
  ListRatingsResponse,
  RatingReport,
  View,
} from "@rater/contracts";
import { recordAudit } from "../audit";
import type { AppDeps } from "../deps";
import { errorForLog } from "../logger";
import { loadReport, preferredLocale } from "../report";
import { decodeCursor } from "../ratings/cursor";
import { FINAL_STATUSES, streamRatingStatus } from "../ratings/events";
import {
  checkDailyLimit,
  createRating,
  deleteRating,
  findVisibleRating,
  listRatings,
  readRatingStatus,
  readStoredPdf,
} from "../ratings/store";
import { checkQiwaPdf, readUpload } from "../ratings/upload";

const RatingParams = z.object({ id: z.string().min(1).max(64) });

export const ratingRoutes: FastifyPluginAsyncZod<AppDeps> = async (app, deps) => {
  const { db, storage, queue, config, now } = deps;

  // Open event streams end when the server shuts down, so app.close() does not hang.
  const shutdown = new AbortController();
  app.addHook("preClose", async () => shutdown.abort());

  app.post(
    "/ratings",
    {
      schema: {
        summary: "Upload a Qiwa contract PDF to rate",
        description:
          'multipart/form-data: optional field "view" (employee | hr) first, then the PDF in ' +
          `"file" (at most ${config.MAX_UPLOAD_BYTES} bytes). 422 unsupported_document when ` +
          "it is not a Qiwa Unified Employment Contract; 429 rate_limited over the daily limit.",
        consumes: ["multipart/form-data"],
        response: { 202: CreateRatingResponse },
      },
    },
    async (request, reply) => {
      const { ctx } = request;
      await checkDailyLimit(db, ctx.user.id, config.RATE_LIMIT_PER_DAY, now());
      const upload = await readUpload(request, config.MAX_UPLOAD_BYTES);
      const { pages } = await checkQiwaPdf(upload.pdf);
      const id = await createRating(
        { db, storage, queue, now },
        { ctx, pdf: upload.pdf, pages, view: upload.view },
      );
      return reply.code(202).send({ id, status: "queued" });
    },
  );

  app.get(
    "/ratings",
    {
      schema: {
        summary: "List the workspace's ratings, newest first",
        querystring: z.object({ cursor: z.string().max(200).optional() }),
        response: { 200: ListRatingsResponse },
      },
    },
    async (request) => {
      const cursor = request.query.cursor ? decodeCursor(request.query.cursor) : null;
      return listRatings(db, request.ctx, cursor);
    },
  );

  app.get(
    "/ratings/:id",
    {
      schema: {
        summary: "A rating as a report in one view (any status)",
        params: RatingParams,
        querystring: z.object({ view: View.optional() }),
        response: { 200: RatingReport },
      },
    },
    async (request) => {
      const { ctx } = request;
      const rating = await findVisibleRating(db, ctx, request.params.id);
      const view = request.query.view ?? rating.defaultView;
      const locale = preferredLocale(request.headers["accept-language"]);
      const report = await loadReport(db, rating, view, locale);
      // Only finished reports count as a "view"; the web app polls while a rating runs.
      if (FINAL_STATUSES.has(rating.status)) {
        await recordAudit(db, {
          orgId: ctx.orgId,
          userId: ctx.user.id,
          action: "view",
          targetId: rating.id,
          meta: { view },
        });
      }
      return report;
    },
  );

  app.get(
    "/ratings/:id/events",
    {
      schema: {
        summary: "Server-sent events: the rating's status until it is final",
        description:
          'text/event-stream. Each event is `event: status` with data {"id","status"}.',
        params: RatingParams,
      },
    },
    async (request, reply) => {
      const rating = await findVisibleRating(db, request.ctx, request.params.id);
      await streamRatingStatus(reply, {
        ratingId: rating.id,
        readStatus: () => readRatingStatus(db, rating.id),
        pollMs: deps.eventsPollMs,
        shutdown: shutdown.signal,
        onError: (error) =>
          request.log.warn({ err: errorForLog(error) }, "rating event stream failed"),
      });
    },
  );

  app.get(
    "/ratings/:id/document",
    {
      schema: {
        summary: "Download the uploaded PDF (until the retention period deletes it)",
        params: RatingParams,
      },
    },
    async (request, reply) => {
      const { ctx } = request;
      const rating = await findVisibleRating(db, ctx, request.params.id);
      const { documentId, pdf } = await readStoredPdf({ db, storage }, rating);
      await recordAudit(db, {
        orgId: ctx.orgId,
        userId: ctx.user.id,
        action: "download",
        targetId: rating.id,
        meta: { documentId },
      });
      return reply
        .type("application/pdf")
        .header("content-disposition", `attachment; filename="contract-${rating.id}.pdf"`)
        .header("cache-control", "private, no-store")
        .send(pdf);
    },
  );

  app.delete(
    "/ratings/:id",
    {
      schema: {
        summary: "Delete the rating, its findings and the PDF",
        params: RatingParams,
      },
    },
    async (request, reply) => {
      const rating = await findVisibleRating(db, request.ctx, request.params.id);
      await deleteRating({ db, storage }, request.ctx, rating);
      return reply.code(204).send();
    },
  );
};
