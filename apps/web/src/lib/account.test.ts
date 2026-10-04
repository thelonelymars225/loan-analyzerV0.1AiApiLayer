import type { ListRatingsResponse, OrgSummary, RatingSummary } from "@rater/contracts";
import { describe, expect, it, vi } from "vitest";
import { deleteAllRatings, deleteMyData } from "./account";

const rating = (id: string): RatingSummary => ({
  id,
  status: "done",
  defaultView: "employee",
  scoreOverall: 70,
  band: "Fair",
  createdAt: "2026-10-01T09:00:00Z",
  finishedAt: "2026-10-01T09:01:00Z",
});

/** An in-memory ratings API that pages two at a time. */
function fakeRatingsApi(ids: string[]) {
  const remaining = [...ids];
  return {
    listRatings: vi.fn(async (): Promise<ListRatingsResponse> => ({
      items: remaining.slice(0, 2).map(rating),
      nextCursor: remaining.length > 2 ? "next" : null,
    })),
    deleteRating: vi.fn(async (id: string) => {
      remaining.splice(remaining.indexOf(id), 1);
    }),
  };
}

const personal: OrgSummary = {
  id: "org_personal",
  name: "Personal",
  kind: "personal",
  role: "owner",
  retentionDays: 30,
};

describe("deleteAllRatings", () => {
  it("deletes every rating across pages", async () => {
    const ratings = fakeRatingsApi(["rt_1", "rt_2", "rt_3", "rt_4", "rt_5"]);
    await expect(deleteAllRatings(ratings)).resolves.toBe(5);
    expect(ratings.deleteRating.mock.calls.map(([id]) => id)).toEqual([
      "rt_1",
      "rt_2",
      "rt_3",
      "rt_4",
      "rt_5",
    ]);
  });

  it("stops instead of looping when a deleted rating is still listed", async () => {
    const ratings = {
      listRatings: vi.fn(async () => ({ items: [rating("rt_stuck")], nextCursor: null })),
      deleteRating: vi.fn(async () => {}),
    };
    await expect(deleteAllRatings(ratings)).rejects.toThrow(/still listed/);
  });
});

describe("deleteMyData", () => {
  it("switches to the personal workspace, deletes its ratings, then signs out", async () => {
    const calls: string[] = [];
    const ratings = fakeRatingsApi(["rt_1"]);
    ratings.deleteRating.mockImplementation(
      async (id: string) => void calls.push(`delete ${id}`),
    );
    ratings.listRatings
      .mockResolvedValueOnce({ items: [rating("rt_1")], nextCursor: null })
      .mockResolvedValueOnce({ items: [], nextCursor: null });

    const count = await deleteMyData(personal, "org_company", {
      ratings,
      setActiveOrg: async (id) => void calls.push(`activate ${id}`),
      signOut: async () => void calls.push("sign out"),
    });

    expect(count).toBe(1);
    expect(calls).toEqual(["activate org_personal", "delete rt_1", "sign out"]);
  });

  it("does not sign out when a delete fails", async () => {
    const signOut = vi.fn(async () => {});
    const ratings = fakeRatingsApi(["rt_1"]);
    ratings.deleteRating.mockRejectedValue(new Error("network"));

    await expect(
      deleteMyData(personal, personal.id, {
        ratings,
        setActiveOrg: vi.fn(async () => {}),
        signOut,
      }),
    ).rejects.toThrow("network");
    expect(signOut).not.toHaveBeenCalled();
  });
});
