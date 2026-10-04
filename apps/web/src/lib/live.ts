import { API_BASE, RatingEvent } from "@rater/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { queryKeys } from "./queries";
import { isTerminal } from "./ratings";

/**
 * Listens to GET /ratings/{id}/events for each rating still running and refetches rating
 * queries whenever a status changes. Returns `live: false` when server-sent events are not
 * available or a stream failed; callers then poll more often (see pollInterval).
 */
export function useRatingEvents(ratingIds: readonly string[]): { live: boolean } {
  const queryClient = useQueryClient();
  const supported = typeof EventSource !== "undefined";
  const idsKey = ratingIds.join(",");
  const [failedIdsKey, setFailedIdsKey] = useState<string | null>(null);

  useEffect(() => {
    if (!supported || idsKey === "") return;

    const sources = idsKey.split(",").map((id) => {
      const source = new EventSource(
        `${API_BASE}/ratings/${encodeURIComponent(id)}/events`,
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
        setFailedIdsKey(idsKey);
      };
      return source;
    });

    return () => sources.forEach((source) => source.close());
  }, [idsKey, supported, queryClient]);

  return { live: supported && idsKey !== "" && failedIdsKey !== idsKey };
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
