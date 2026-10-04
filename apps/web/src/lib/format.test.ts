import { describe, expect, it } from "vitest";
import { formatDate, formatMegabytes, formatSar } from "./format";

/** Intl puts a no-break space between currency and amount. */
const plain = (text: string) => text.replace(/\s/g, " ");

describe("format", () => {
  it("formats SAR with decimals only when needed", () => {
    expect(plain(formatSar(8750.5, "en"))).toBe("SAR 8,750.50");
    expect(plain(formatSar(30000, "en"))).toBe("SAR 30,000");
  });

  it("uses Latin digits in Arabic so figures match the contract", () => {
    expect(formatSar(1750.5, "ar")).toMatch(/1,750\.50/);
    expect(formatDate("2027-01-31", "ar")).toMatch(/31/);
    expect(formatDate("2027-01-31", "ar")).toMatch(/2027/);
  });

  it("keeps a bare date on its calendar day", () => {
    expect(formatDate("2027-01-31", "en")).toBe("31 Jan 2027");
  });

  it("formats file sizes in megabytes", () => {
    expect(formatMegabytes(2.5 * 1024 * 1024, "en")).toBe("2.5");
    expect(formatMegabytes(10, "en")).toBe("0.1");
  });
});
