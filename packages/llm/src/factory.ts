import { ClaudeLlmClient } from "./claude";
import { HeuristicLlmClient } from "./heuristic";
import type { LlmClient } from "./types";

/**
 * Picks the analyser from the environment:
 * - LLM_PROVIDER=heuristic: the offline analyser, even when an API key is set.
 * - LLM_PROVIDER=claude: Claude; throws if ANTHROPIC_API_KEY is missing.
 * - LLM_PROVIDER unset (or "auto"): Claude when ANTHROPIC_API_KEY is set, offline otherwise.
 * LLM_MODEL overrides the pinned Claude model. LLM_STRUCTURED_OUTPUT=off turns off structured
 * outputs for a model that does not support them.
 */
export function createLlmClient(env: NodeJS.ProcessEnv = process.env): LlmClient {
  const provider = (env.LLM_PROVIDER ?? "").trim().toLowerCase();
  const apiKey = env.ANTHROPIC_API_KEY?.trim() || undefined;

  switch (provider) {
    case "heuristic":
      return new HeuristicLlmClient();
    case "claude":
      if (!apiKey) {
        throw new Error(
          "LLM_PROVIDER is 'claude' but ANTHROPIC_API_KEY is not set. Set the key, or set LLM_PROVIDER=heuristic to run offline.",
        );
      }
      return claudeClient(env, apiKey);
    case "":
    case "auto":
      return apiKey ? claudeClient(env, apiKey) : new HeuristicLlmClient();
    default:
      throw new Error(
        `Unknown LLM_PROVIDER '${env.LLM_PROVIDER}'. Use 'claude', 'heuristic' or 'auto'.`,
      );
  }
}

function claudeClient(env: NodeJS.ProcessEnv, apiKey: string): ClaudeLlmClient {
  return new ClaudeLlmClient({
    apiKey,
    model: env.LLM_MODEL?.trim() || undefined,
    baseURL: env.ANTHROPIC_BASE_URL?.trim() || undefined,
    structuredOutput: env.LLM_STRUCTURED_OUTPUT?.trim().toLowerCase() !== "off",
  });
}
