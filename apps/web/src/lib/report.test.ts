import { describe, expect, it } from "vitest";
import { syntheticReport } from "../test/fixtures";
import { findingAnchor, impactColumns, likelyVoidFindings } from "./report";
import { bandForScore, defaultViewFor, progressPercent } from "./ratings";

describe("report helpers", () => {
  it("orders impact columns per kind and keeps unknown kinds", () => {
    expect(impactColumns("eos_gap", { "10y": 3, "1y": 1, "5y": 2 })).toEqual([
      "1y",
      "5y",
      "10y",
    ]);
    expect(impactColumns("art77_gap", { gap: 3, contract: 1, default: 2 })).toEqual([
      "contract",
      "default",
      "gap",
    ]);
    expect(impactColumns("future_kind", { a: 1, b: 2 })).toEqual(["a", "b"]);
  });

  it("builds DOM-safe anchors", () => {
    expect(findingAnchor({ ruleId: "EOS-BASE-01", clause: "15.6" })).toBe(
      "finding-EOS-BASE-01-15-6",
    );
    expect(findingAnchor({ ruleId: "SETTLE-TIME-01", clause: null })).toBe(
      "finding-SETTLE-TIME-01",
    );
  });

  it("picks the likely-void findings for the HR summary", () => {
    expect(
      likelyVoidFindings(syntheticReport("hr").findings).map((f) => f.ruleId),
    ).toEqual(["EOS-BASE-01"]);
  });
});

describe("rating helpers", () => {
  it("uses the scorer's bands", () => {
    expect([80, 79, 60, 59, 40, 39].map(bandForScore)).toEqual([
      "Good",
      "Fair",
      "Fair",
      "Weak",
      "Weak",
      "Poor",
    ]);
  });

  it("maps statuses to progress and workspaces to default views", () => {
    expect(progressPercent("queued")).toBe(25);
    expect(progressPercent("analysing")).toBe(75);
    expect(defaultViewFor("company")).toBe("hr");
    expect(defaultViewFor("personal")).toBe("employee");
  });
});
