import { describe, expect, it } from "vitest";
import { cropAspectRatio, highlightInset, isSectionNumber } from "./passages";

const passage = {
  box: { xMin: 50, yMin: 120, xMax: 550, yMax: 160 },
  crop: { xMin: 0, yMin: 100, xMax: 600, yMax: 200 },
};

describe("highlightInset", () => {
  it("places the clause box over the crop in percentages", () => {
    expect(highlightInset(passage)).toEqual({
      left: `${(50 / 600) * 100}%`,
      top: "20%",
      width: `${(500 / 600) * 100}%`,
      height: "40%",
    });
  });

  it("never leaves the image, even with a box outside the crop", () => {
    const inset = highlightInset({
      box: { xMin: -10, yMin: 90, xMax: 700, yMax: 300 },
      crop: passage.crop,
    });
    expect(inset).toEqual({ left: "0%", top: "0%", width: "100%", height: "100%" });
  });

  it("copes with an empty crop", () => {
    const empty = { xMin: 0, yMin: 0, xMax: 0, yMax: 0 };
    expect(highlightInset({ box: empty, crop: empty })).toEqual({
      left: "0%",
      top: "0%",
      width: "0%",
      height: "0%",
    });
    expect(cropAspectRatio({ crop: empty })).toBe(1);
  });
});

describe("cropAspectRatio", () => {
  it("is width over height", () => {
    expect(cropAspectRatio(passage)).toBe(6);
  });
});

describe("isSectionNumber", () => {
  it("tells a section from a clause", () => {
    expect(isSectionNumber("7")).toBe(true);
    expect(isSectionNumber("7.1")).toBe(false);
    expect(isSectionNumber("15.4.2")).toBe(false);
  });
});
