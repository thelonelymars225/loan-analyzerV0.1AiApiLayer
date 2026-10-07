import { useEffect } from "react";

/** Calls `refetch` every `intervalMs` while it is a number; `false` stops polling. */
export function usePolling(refetch: () => unknown, intervalMs: number | false): void {
  useEffect(() => {
    if (intervalMs === false) return;
    const timer = window.setInterval(() => void refetch(), intervalMs);
    return () => window.clearInterval(timer);
  }, [refetch, intervalMs]);
}
