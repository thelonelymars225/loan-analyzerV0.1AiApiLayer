import { readFileSync } from "node:fs";

/**
 * Version of the analyser prompts, stored on every rating and part of the clause cache key.
 * The cross-check prompt is released together with the clause prompt, so one version covers
 * both files: any change to either file must bump this (test/prompts.test.ts checks it).
 */
export const PROMPT_VERSION = "s15-v1";

/** The prompt files in packages/llm/prompts, one per analyser call. */
export const PROMPT_FILES = {
  clause: "s15-v1.md",
  cross: "cross-v1.md",
} as const;

export type PromptName = keyof typeof PROMPT_FILES;

const loaded = new Map<PromptName, string>();

/** The system prompt for one analyser call, read once from disk. */
export function loadPrompt(name: PromptName): string {
  const cached = loaded.get(name);
  if (cached !== undefined) return cached;
  const text = readFileSync(promptPath(name), "utf8");
  loaded.set(name, text);
  return text;
}

export function promptPath(name: PromptName): URL {
  return new URL(`../prompts/${PROMPT_FILES[name]}`, import.meta.url);
}
