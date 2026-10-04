import { describe, expect, it } from "vitest";
import { ClaudeLlmClient, DEFAULT_CLAUDE_MODEL } from "../src/claude";
import { createLlmClient } from "../src/factory";
import { HeuristicLlmClient } from "../src/heuristic";

const KEY = "test-key-not-real";

describe("createLlmClient", () => {
  it("runs offline when no API key is set", () => {
    expect(createLlmClient({})).toBeInstanceOf(HeuristicLlmClient);
    expect(createLlmClient({ ANTHROPIC_API_KEY: "  " })).toBeInstanceOf(
      HeuristicLlmClient,
    );
  });

  it("uses Claude when an API key is set", () => {
    const client = createLlmClient({ ANTHROPIC_API_KEY: KEY });
    expect(client).toBeInstanceOf(ClaudeLlmClient);
    expect(client.model).toBe(DEFAULT_CLAUDE_MODEL);
  });

  it("uses the offline analyser when LLM_PROVIDER=heuristic, even with a key", () => {
    expect(
      createLlmClient({ ANTHROPIC_API_KEY: KEY, LLM_PROVIDER: "heuristic" }),
    ).toBeInstanceOf(HeuristicLlmClient);
  });

  it("uses Claude for LLM_PROVIDER=claude or auto with a key, honouring LLM_MODEL", () => {
    const claude = createLlmClient({
      ANTHROPIC_API_KEY: KEY,
      LLM_PROVIDER: "Claude",
      LLM_MODEL: "claude-sonnet-5-5",
    });
    expect(claude).toBeInstanceOf(ClaudeLlmClient);
    expect(claude.model).toBe("claude-sonnet-5-5");
    expect(
      createLlmClient({ ANTHROPIC_API_KEY: KEY, LLM_PROVIDER: "auto" }),
    ).toBeInstanceOf(ClaudeLlmClient);
  });

  it("throws a clear error for LLM_PROVIDER=claude without a key", () => {
    expect(() => createLlmClient({ LLM_PROVIDER: "claude" })).toThrow(
      /ANTHROPIC_API_KEY is not set/,
    );
  });

  it("throws for an unknown provider instead of silently running offline", () => {
    expect(() => createLlmClient({ LLM_PROVIDER: "heurstic" })).toThrow(
      /Unknown LLM_PROVIDER/,
    );
  });
});
