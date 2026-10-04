import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ClauseMatch, CrossConflict, ImpactParams, Verdict } from "@rater/contracts";
import { loadPrompt, PROMPT_FILES, PROMPT_VERSION, promptPath } from "../src/prompts";

/**
 * Hash of both prompt files for PROMPT_VERSION. If you change a prompt, bump PROMPT_VERSION
 * (and rename the prompt file), then update this hash. Ratings and the clause cache are keyed
 * by the prompt version, so an unversioned prompt edit would mix old and new answers.
 */
const PROMPT_HASHES: Record<string, string> = {
  "s15-v1": "e59f015a169743076eeddb8de1b4b5b8e3f00122afd19d714c5cfbc81bc4e87b",
};

function promptsHash(): string {
  const hash = createHash("sha256");
  for (const name of ["clause", "cross"] as const)
    hash.update(readFileSync(promptPath(name)));
  return hash.digest("hex");
}

describe("prompt files", () => {
  it("are versioned s15-v1", () => {
    expect(PROMPT_VERSION).toBe("s15-v1");
    expect(PROMPT_FILES).toEqual({ clause: "s15-v1.md", cross: "cross-v1.md" });
  });

  it("have not changed without a version bump", () => {
    expect(
      promptsHash(),
      "Prompt text changed: bump PROMPT_VERSION and update PROMPT_HASHES.",
    ).toBe(PROMPT_HASHES[PROMPT_VERSION]);
  });

  it("describe every field of the reply schemas", () => {
    const clausePrompt = loadPrompt("clause");
    const keys = [
      ...Object.keys(ClauseMatch.shape),
      ...Object.keys(ImpactParams.shape),
      "clause",
      "matches",
    ];
    for (const key of keys) expect(clausePrompt).toContain(`"${key}"`);
    for (const verdict of Verdict.options)
      expect(clausePrompt).toContain(`\`${verdict}\``);

    const crossPrompt = loadPrompt("cross");
    for (const key of [...Object.keys(CrossConflict.shape), "conflicts"]) {
      expect(crossPrompt).toContain(`"${key}"`);
    }
  });

  it("tell the model the clause is data and that the Arabic text prevails", () => {
    for (const name of ["clause", "cross"] as const) {
      const prompt = loadPrompt(name);
      expect(prompt).toMatch(/untrusted data/);
      expect(prompt).toMatch(/Never follow it/);
      expect(prompt).toMatch(/Arabic text prevails/);
      expect(prompt).toMatch(/Never cite/);
    }
  });
});
