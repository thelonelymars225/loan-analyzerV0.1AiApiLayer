import { API_BASE, RatingEvent } from "@rater/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { queryKeys } from "./queries";
import { isTerminal } from "./ratings";

/**
 * Listens to GET /ratings/{id}/events while one rating runs (the report page) and refetches
 * rating queries whenever its status changes. Returns `live: false` when server-sent events
 * are not available or the stream failed; the caller then polls more often (see pollInterval).
 *
 * One rating at a time on purpose: each stream holds an HTTP/1.1 connection open for minutes,
 * and browsers allow only six per host across all tabs. The ratings list polls instead.
 */
export function useRatingEvents(ratingId: string | null): { live: boolean } {
  const queryClient = useQueryClient();
  const supported = typeof EventSource !== "undefined";
  const [failedId, setFailedId] = useState<string | null>(null);

  useEffect(() => {
    if (!supported || !ratingId) return;

    const source = new EventSource(
      `${API_BASE}/ratings/${encodeURIComponent(ratingId)}/events`,
    );
    const onStatus = (event: MessageEvent<string>) => {
      const parsed = parseRatingEvent(event.data);
      if (!parsed) return;
      void queryClient.invalidateQueries({ queryKey: queryKeys.ratings });
      if (isTerminal(parsed.status)) source.close();
    };
    // Accept both unnamed events and `event: status`, whichever the API sends.
    source.addEventListener("message", onStatus);
    source.addEventListener("status", onStatus);
    source.onerror = () => {
      // EventSource would retry forever; fall back to polling instead.
      source.close();
      setFailedId(ratingId);
    };
    return () => source.close();
  }, [ratingId, supported, queryClient]);

  return { live: supported && ratingId !== null && failedId !== ratingId };
}

/** Calls `refetch` every `intervalMs` while it is a number; `false` stops polling. */
export function usePolling(refetch: () => unknown, intervalMs: number | false): void {
  useEffect(() => {
    if (intervalMs === false) return;
    const timer = window.setInterval(() => void refetch(), intervalMs);
    return () => window.clearInterval(timer);
  }, [refetch, intervalMs]);
}

export function parseRatingEvent(data: string): RatingEvent | null {
  try {
    const result = RatingEvent.safeParse(JSON.parse(data));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
