import { describe, expect, it, vi } from "vitest";
import { routeFetch } from "../test/render";
import { api } from "./api";
import { deleteMyData } from "./account";

describe("deleteMyData", () => {
  it("asks the API to delete the user's data, then signs out", async () => {
    const calls: string[] = [];
    await deleteMyData({
      deleteMyData: async () => void calls.push("delete my data"),
      signOut: async () => void calls.push("sign out"),
    });
    expect(calls).toEqual(["delete my data", "sign out"]);
  });

  it("does not sign out when the delete fails", async () => {
    const signOut = vi.fn(async () => {});
    await expect(
      deleteMyData({
        deleteMyData: () => Promise.reject(new Error("network")),
        signOut,
      }),
    ).rejects.toThrow("network");
    expect(signOut).not.toHaveBeenCalled();
  });

  it("is one DELETE /me/data", async () => {
    const fetchMock = routeFetch({
      "DELETE /api/v1/me/data": () => new Response(null, { status: 204 }),
    });
    await api.deleteMyData();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/v1/me/data");
    expect(init?.method).toBe("DELETE");
  });
});
