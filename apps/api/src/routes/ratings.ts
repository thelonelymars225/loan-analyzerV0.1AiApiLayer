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
import { tooManyStreams } from "../errors";
import { ConnectionSlots } from "../limiter";
import { errorForLog } from "../logger";
import { loadReport, preferredLocale } from "../report";
import { decodeCursor } from "../ratings/cursor";
import { readStoredPdf } from "../ratings/document";
import { FINAL_STATUSES, streamRatingStatus } from "../ratings/events";
import { renderDocumentPage } from "../ratings/images";
import {
  checkDailyLimit,
  createRating,
  deleteRating,
  findVisibleRating,
  listRatings,
  readVisibleStatus,
} from "../ratings/store";
import { checkQiwaPdf, readUpload } from "../ratings/upload";

const RatingParams = z.object({ id: z.string().min(1).max(64) });
const PageParams = RatingParams.extend({
  page: z.coerce.number().int().positive().max(999),
});
/** How the browser should treat the PDF: open it in the viewer, or save it as a file. */
const DocumentQuery = z.object({
  disposition: z.enum(["inline", "attachment"]).default("attachment"),
});

/**
 * Each open event stream re-reads Postgres every poll, so their number is capped per user
 * and per API process. Over a cap the stream answers 429 and the web app polls instead.
 */
const MAX_STREAMS_PER_USER = 3;
const MAX_STREAMS = 200;

export const ratingRoutes: FastifyPluginAsyncZod<AppDeps> = async (app, deps) => {
  const { db, storage, queue, config, now } = deps;

  // Open event streams end when the server shuts down, so app.close() does not hang.
  const shutdown = new AbortController();
  app.addHook("preClose", async () => shutdown.abort());
  const streams = new ConnectionSlots({
    perUser: MAX_STREAMS_PER_USER,
    total: MAX_STREAMS,
  });

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
      const dailyLimit = config.RATE_LIMIT_PER_DAY;
      // A cheap early answer before the upload is read and checked. createRating checks
      // again under a lock, which is what actually enforces the limit.
      await checkDailyLimit(db, ctx.user.id, dailyLimit, now());
      const upload = await readUpload(request, config.MAX_UPLOAD_BYTES);
      const { pages } = await checkQiwaPdf(upload.pdf);
      const id = await createRating(
        { db, storage, queue, now },
        { ctx, pdf: upload.pdf, pages, view: upload.view, dailyLimit },
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
          'text/event-stream. Each event is `event: status` with data {"id","status"}. ' +
          `429 rate_limited when the user already has ${MAX_STREAMS_PER_USER} streams open ` +
          "(or the server is at its limit); poll GET /ratings/{id} instead.",
        params: RatingParams,
      },
    },
    async (request, reply) => {
      const { ctx } = request;
      const rating = await findVisibleRating(db, ctx, request.params.id);
      if (!streams.tryTake(ctx.user.id)) throw tooManyStreams();
      try {
        await streamRatingStatus(reply, {
          ratingId: rating.id,
          readStatus: () => readVisibleStatus(db, ctx, rating.id),
          pollMs: deps.eventsPollMs,
          shutdown: shutdown.signal,
          onError: (error) =>
            request.log.warn({ err: errorForLog(error) }, "rating event stream failed"),
        });
      } finally {
        streams.release(ctx.user.id);
      }
    },
  );

  app.get(
    "/ratings/:id/document",
    {
      schema: {
        summary: "The uploaded PDF (until the retention period deletes it)",
        description:
          "disposition=attachment (default) downloads it; disposition=inline opens it in the " +
          "contract viewer. Each is audited as its own action. 404 once the PDF is deleted.",
        params: RatingParams,
        querystring: DocumentQuery,
      },
    },
    async (request, reply) => {
      const { ctx } = request;
      const { disposition } = request.query;
      const rating = await findVisibleRating(db, ctx, request.params.id);
      const { document, pdf } = await readStoredPdf({ db, storage }, rating);
      await recordAudit(db, {
        orgId: ctx.orgId,
        userId: ctx.user.id,
        action: disposition === "inline" ? "view_document" : "download",
        targetId: rating.id,
        meta: { documentId: document.id },
      });
      return reply
        .type("application/pdf")
        .header(
          "content-disposition",
          `${disposition}; filename="contract-${rating.id}.pdf"`,
        )
        .header("cache-control", "private, no-store")
        .send(pdf);
    },
  );

  app.get(
    "/ratings/:id/pages/:page",
    {
      schema: {
        summary: "One page of the PDF as a PNG, cut on request for the contract viewer",
        description:
          "Rendered from the PDF each time and never stored; " +
          "404 for a page the contract does not have, or once the PDF is deleted.",
        params: PageParams,
      },
    },
    async (request, reply) => {
      const { id, page } = request.params;
      const rating = await findVisibleRating(db, request.ctx, id);
      const png = await renderDocumentPage({ db, storage }, rating, page);
      return reply
        .type("image/png")
        .header("cache-control", "private, no-store")
        .send(png);
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
