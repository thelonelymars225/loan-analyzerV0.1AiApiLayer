import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { vi } from "vitest";
import { ToastProvider } from "../components/ui/toast";

interface Options {
  /** Initial URL. */
  route?: string;
  /** Route pattern the element is mounted at, e.g. "/ratings/:id". */
  path?: string;
}

/** Renders with the app's providers: React Query (no retries), toasts and a memory router. */
export function renderWithProviders(
  ui: ReactElement,
  { route = "/", path = "*" }: Options = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path={path} element={ui} />
            {path !== "*" && <Route path="*" element={<p>other page</p>} />}
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

/** A File of any claimed size without allocating it. */
export function fakeFile(name: string, type: string, size: number): File {
  const file = new File(["%PDF-1.7 synthetic"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

/** A fetch Response with a JSON body. */
export function jsonResponse(
  body: unknown,
  status = 200,
  contentType = "application/json",
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": contentType },
  });
}

type Handler = (url: URL, init: RequestInit | undefined) => Response | Promise<Response>;

/**
 * Stubs global fetch with handlers keyed by "METHOD /path" (query string ignored).
 * Unknown requests answer 404 problem+json, like the API.
 */
export function routeFetch(handlers: Record<string, Handler>) {
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input), "http://localhost");
    const handler = handlers[`${init?.method ?? "GET"} ${url.pathname}`];
    if (handler) return handler(url, init);
    const notFound = {
      type: "about:blank",
      title: "Not found",
      status: 404,
      code: "not_found",
    };
    return jsonResponse(notFound, 404, "application/problem+json");
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
