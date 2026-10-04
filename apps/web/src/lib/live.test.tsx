import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { parseRatingEvent, useRatingEvents } from "./live";

/** Minimal stand-in for the browser's EventSource. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly url: string;
  closed = false;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, ((event: MessageEvent<string>) => void)[]>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: unknown) {
    const event = new MessageEvent(type, { data: JSON.stringify(data) });
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }
}

function setup(ids: string[]) {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useRatingEvents(ids), { wrapper });
  return { hook, invalidate };
}

describe("useRatingEvents", () => {
  it("opens one stream per running rating and refetches on each status", () => {
    const { hook, invalidate } = setup(["rt_1", "rt_2"]);
    expect(hook.result.current.live).toBe(true);
    expect(FakeEventSource.instances.map((source) => source.url)).toEqual([
      "/api/v1/ratings/rt_1/events",
      "/api/v1/ratings/rt_2/events",
    ]);

    const [first] = FakeEventSource.instances;
    act(() => first!.emit("message", { id: "rt_1", status: "analysing" }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["ratings"] });
    expect(first!.closed).toBe(false);

    act(() => first!.emit("status", { id: "rt_1", status: "done" }));
    expect(first!.closed).toBe(true);
  });

  it("falls back to polling when a stream fails", () => {
    const { hook } = setup(["rt_1"]);
    act(() => FakeEventSource.instances[0]!.onerror?.());
    expect(hook.result.current.live).toBe(false);
    expect(FakeEventSource.instances[0]!.closed).toBe(true);
  });

  it("closes streams on unmount and opens none without running ratings", () => {
    const { hook } = setup(["rt_1"]);
    hook.unmount();
    expect(FakeEventSource.instances[0]!.closed).toBe(true);

    const idle = setup([]);
    expect(FakeEventSource.instances).toHaveLength(0);
    expect(idle.hook.result.current.live).toBe(false);
  });

  it("ignores malformed events", () => {
    expect(parseRatingEvent("not json")).toBeNull();
    expect(parseRatingEvent(JSON.stringify({ id: "rt_1", status: "bogus" }))).toBeNull();
    expect(parseRatingEvent(JSON.stringify({ id: "rt_1", status: "done" }))).toEqual({
      id: "rt_1",
      status: "done",
    });
  });
});
