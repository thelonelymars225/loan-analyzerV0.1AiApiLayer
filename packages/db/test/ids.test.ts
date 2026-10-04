import { afterEach, describe, expect, it, vi } from "vitest";
import { newId } from "../src/ids";

const ID_PATTERN = /^rt_[0-9abcdefghjkmnpqrstvwxyz]{26}$/;

afterEach(() => {
  vi.restoreAllMocks();
});

/** Independent reference: JavaScript's base32 digits mapped onto the Crockford alphabet. */
function expectedTimePart(ms: number): string {
  const standard = "0123456789abcdefghijklmnopqrstuv";
  const crockford = "0123456789abcdefghjkmnpqrstvwxyz";
  return [...ms.toString(32).padStart(10, "0")]
    .map((digit) => crockford[standard.indexOf(digit)])
    .join("");
}

describe("newId", () => {
  it("is the prefix, an underscore and 26 lowercase base32 characters", () => {
    const id = newId("rt");
    expect(id).toMatch(ID_PATTERN);
    expect(id).toBe(id.toLowerCase());
  });

  it("starts with the creation time in milliseconds", () => {
    const ms = Date.UTC(2026, 9, 3, 12, 0, 0, 123);
    vi.spyOn(Date, "now").mockReturnValue(ms);
    expect(newId("rt").slice(3, 13)).toBe(expectedTimePart(ms));
  });

  it("sorts by creation time", () => {
    const now = vi.spyOn(Date, "now");
    const ids: string[] = [];
    for (const ms of [
      1_700_000_000_000, 1_700_000_000_001, 1_700_000_060_000, 1_800_000_000_000,
    ]) {
      now.mockReturnValue(ms);
      ids.push(newId("rt"));
    }
    expect([...ids].sort()).toEqual(ids);
  });

  it("keeps creation order and uniqueness within the same millisecond", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_750_000_000_000);
    const ids = Array.from({ length: 1000 }, () => newId("fd"));
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
  });

  it.each(["", "RT", "r_t", "1rt", "rt-x"])("rejects the prefix %j", (prefix) => {
    expect(() => newId(prefix)).toThrow(/Invalid id prefix/);
  });
});
