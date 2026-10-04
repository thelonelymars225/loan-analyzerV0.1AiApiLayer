import { setTimeout as sleep } from "node:timers/promises";
import type { FastifyReply } from "fastify";
import type { RatingEvent, RatingStatus } from "@rater/contracts";

/** The worker is done with a rating in these statuses; the stream ends after sending one. */
export const FINAL_STATUSES: ReadonlySet<RatingStatus> = new Set([
  "done",
  "failed",
  "needs_review",
]);

export interface StatusStreamOptions {
  ratingId: string;
  /** Current status, or null once the rating is deleted or no longer visible to the caller. */
  readStatus: () => Promise<RatingStatus | null>;
  pollMs: number;
  /** Aborted when the server shuts down. */
  shutdown: AbortSignal;
  onError: (error: unknown) => void;
}

/** Comment lines keep proxies from closing a quiet connection. */
const KEEP_ALIVE_MS = 15_000;
/** A rating finishes in about two minutes; after this the client reconnects or polls. */
const MAX_STREAM_MS = 10 * 60_000;

/**
 * Server-sent events for GET /ratings/{id}/events: one `event: status` with a RatingEvent
 * every time the status changes (the first one right away), then the stream ends once the
 * status is final. Status changes are found by re-reading the rating every `pollMs`.
 */
export async function streamRatingStatus(
  reply: FastifyReply,
  options: StatusStreamOptions,
): Promise<void> {
  reply.hijack();
  const response = reply.raw;
  // Keep the headers earlier hooks set on the reply (CORS), which hijacking would drop.
  for (const [name, value] of Object.entries(reply.getHeaders())) {
    if (value !== undefined) response.setHeader(name, value);
  }
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no", // stop nginx from buffering the stream
  });

  // Polling stops as soon as the client goes away (or the server shuts down).
  const clientGone = new AbortController();
  response.on("close", () => clientGone.abort());
  if (response.destroyed) clientGone.abort(); // it left before the listener was attached
  const stop = AbortSignal.any([clientGone.signal, options.shutdown]);
  const deadline = Date.now() + MAX_STREAM_MS;

  let lastStatus: RatingStatus | null = null;
  let lastWrite = Date.now();
  try {
    while (!stop.aborted && Date.now() < deadline) {
      const status = await options.readStatus();
      if (status === null) break;
      if (status !== lastStatus) {
        const event: RatingEvent = { id: options.ratingId, status };
        response.write(`event: status\ndata: ${JSON.stringify(event)}\n\n`);
        lastStatus = status;
        lastWrite = Date.now();
      } else if (Date.now() - lastWrite >= KEEP_ALIVE_MS) {
        response.write(": keep-alive\n\n");
        lastWrite = Date.now();
      }
      if (FINAL_STATUSES.has(status)) break;
      await sleep(options.pollMs, undefined, { signal: stop }).catch(() => undefined);
    }
  } catch (error) {
    options.onError(error);
  } finally {
    response.end();
  }
}
