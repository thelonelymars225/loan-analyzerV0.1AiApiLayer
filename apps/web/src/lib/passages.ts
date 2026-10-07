import type { PageBox, Passage } from "@rater/contracts";

/*
 * Geometry for passage previews. The API renders exactly `passage.crop` as the image, so the
 * clause's `box` can be placed over it in percentages, whatever size the image is shown at.
 */

/** CSS percentages that place `box` over an image that shows `crop`. */
export interface Inset {
  left: string;
  top: string;
  width: string;
  height: string;
}

export function highlightInset({ box, crop }: Pick<Passage, "box" | "crop">): Inset {
  const cropWidth = width(crop);
  const cropHeight = height(crop);
  const percent = (part: number, whole: number) =>
    `${whole > 0 ? Math.min(100, Math.max(0, (part / whole) * 100)) : 0}%`;
  return {
    left: percent(box.xMin - crop.xMin, cropWidth),
    top: percent(box.yMin - crop.yMin, cropHeight),
    width: percent(width(box), cropWidth),
    height: percent(height(box), cropHeight),
  };
}

/** The crop's width over its height, so the frame keeps its shape while the image loads. */
export function cropAspectRatio({ crop }: Pick<Passage, "crop">): number {
  return height(crop) > 0 ? width(crop) / height(crop) : 1;
}

/** "7" is a whole section; "7.1" or "15.4.2" is a clause inside one. */
export function isSectionNumber(clause: string): boolean {
  return !clause.includes(".");
}

function width(box: PageBox): number {
  return box.xMax - box.xMin;
}

function height(box: PageBox): number {
  return box.yMax - box.yMin;
}
