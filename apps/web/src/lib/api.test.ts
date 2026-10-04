import { describe, expect, it, vi } from "vitest";
import { i18n } from "../i18n";
import { jsonResponse } from "../test/render";
import { ApiError, api } from "./api";
import { errorMessage } from "./errors";

function stubFetch(response: Response | Error) {
  const fetchMock = vi.fn<typeof fetch>();
  if (response instanceof Error) fetchMock.mockRejectedValue(response);
  else fetchMock.mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function caught(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("expected the call to fail");
}

describe("api", () => {
  it("reads the problem+json code", async () => {
    stubFetch(
      jsonResponse(
        {
          type: "about:blank",
          title: "Too many ratings",
          status: 429,
          code: "rate_limited",
          detail: "Try tomorrow",
        },
        429,
        "application/problem+json",
      ),
    );
    const error = await caught(api.listRatings());
    expect(error.status).toBe(429);
    expect(error.code).toBe("rate_limited");
  });

  it("derives a code from the status when the body is not a problem", async () => {
    stubFetch(new Response("<html>Payload Too Large</html>", { status: 413 }));
    expect((await caught(api.listRatings())).code).toBe("file_too_large");
  });

  it("reports network failures", async () => {
    stubFetch(new TypeError("Failed to fetch"));
    expect((await caught(api.me())).code).toBe("network");
  });

  it("rejects responses that break the contract in development", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetch(jsonResponse({ items: "not a list" }));
    expect((await caught(api.listRatings())).code).toBe("invalid_response");
  });

  it("sends the cursor, the view and the reader's language", async () => {
    const fetchMock = stubFetch(jsonResponse({ items: [], nextCursor: null }));
    await i18n.changeLanguage("ar");
    await api.listRatings("abc/1");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/v1/ratings?cursor=abc%2F1");
    expect(new Headers(init?.headers).get("Accept-Language")).toBe("ar");
  });

  it("maps codes to friendly messages", () => {
    const t = i18n.getFixedT("en");
    const unsupported = new ApiError({
      status: 422,
      code: "unsupported_document",
      message: "x",
    });
    expect(errorMessage(t, unsupported)).toMatch(/Qiwa Unified Employment Contract/);
    expect(
      errorMessage(
        t,
        new ApiError({ status: 413, code: "file_too_large", message: "x" }),
      ),
    ).toMatch(/10 MB/);
    expect(
      errorMessage(t, new ApiError({ status: 429, code: "rate_limited", message: "x" })),
    ).toMatch(/limit/);
    expect(errorMessage(t, new Error("boom"))).toBe("Something went wrong. Try again.");
  });
});
