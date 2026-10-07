import type { RatingSummary } from "@rater/contracts";
import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POLL_MS } from "../../lib/ratings";
import { jsonResponse, renderWithProviders, routeFetch } from "../../test/render";
import { RatingsList } from "./RatingsList";

const queued = (id: string): RatingSummary => ({
  id,
  status: "queued",
  defaultView: "hr",
  scoreOverall: null,
  band: null,
  createdAt: "2026-10-01T09:00:00Z",
  finishedAt: null,
});

afterEach(() => vi.useRealTimers());

describe("RatingsList", () => {
  it("polls the list while ratings run", async () => {
    // Only the interval is faked, so React Query and Testing Library keep real time.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    // An HR workspace with more running ratings than the browser has connections per host.
    const running = ["rt_1", "rt_2", "rt_3", "rt_4", "rt_5", "rt_6", "rt_7"].map(queued);
    const fetchMock = routeFetch({
      "GET /api/v1/ratings": () => jsonResponse({ items: running, nextCursor: null }),
    });
    renderWithProviders(<RatingsList orgId="org_co" />);

    expect(await screen.findAllByText("Queued")).toHaveLength(7);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(POLL_MS));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("stops polling once nothing is running", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const fetchMock = routeFetch({
      "GET /api/v1/ratings": () =>
        jsonResponse({
          items: [{ ...queued("rt_1"), status: "done", scoreOverall: 70, band: "Fair" }],
          nextCursor: null,
        }),
    });
    renderWithProviders(<RatingsList orgId="org_co" />);

    expect(await screen.findByText("Done")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(POLL_MS * 3));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
