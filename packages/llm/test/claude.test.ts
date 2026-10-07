import { readFileSync } from "node:fs";
import type {
  MessageCreateParamsNonStreaming,
  TextBlockParam,
} from "@anthropic-ai/sdk/resources/messages";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ClaudeLlmClient,
  ClaudeReplyError,
  DEFAULT_CLAUDE_MODEL,
  replyJsonSchema,
  toLlmUsage,
} from "../src/claude";
import { ClauseAnalysis } from "@rater/contracts";
import { PROMPT_VERSION, promptPath } from "../src/prompts";
import { clauseRequest, crossRequest, FIXED_TERM_SUMMARY } from "./fixtures";

// The SDK is replaced by a fake: these tests never touch the network.
const sdk = vi.hoisted(() => ({ create: vi.fn(), options: [] as unknown[] }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class FakeAnthropic {
    messages = { create: sdk.create };
    constructor(options: unknown) {
      sdk.options.push(options);
    }
  },
}));

const VALID_REPLY = {
  clause: "15.6",
  matches: [
    {
      ruleId: "EOS-BASE-01",
      verdict: "likely_void",
      severity: "high",
      confidence: "high",
      articles: ["Art. 84"],
      explanation: "Calculated on basic salary only.",
      impactParams: { eosBase: "basic" },
    },
  ],
};

function apiMessage(text: string, stopReason = "end_turn") {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: DEFAULT_CLAUDE_MODEL,
    content: [
      { type: "thinking", thinking: "", signature: "sig" },
      { type: "text", text, citations: null },
    ],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: 120,
      output_tokens: 80,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 3000,
      cache_creation: null,
      inference_geo: null,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: "standard",
    },
  };
}

const EOS_CLAUSE =
  "The end-of-service award shall be calculated on the basis of the basic salary only.";

/** The params of the last messages.create call. */
function sentParams(): MessageCreateParamsNonStreaming {
  return sdk.create.mock.lastCall?.[0];
}

function sentSystem(): TextBlockParam[] {
  return sentParams().system as TextBlockParam[];
}

/** The user message's blocks: the cached candidate rules, then the request. */
function sentUserBlocks(): TextBlockParam[] {
  return sentParams().messages[0]?.content as TextBlockParam[];
}

function sentSchema(): Record<string, unknown> | undefined {
  return sentParams().output_config?.format?.schema;
}

beforeEach(() => {
  sdk.create.mockReset();
  sdk.options.length = 0;
  sdk.create.mockResolvedValue(apiMessage(JSON.stringify(VALID_REPLY)));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ClaudeLlmClient request", () => {
  it("pins the default model and configures timeouts and two SDK retries", () => {
    const client = new ClaudeLlmClient({ apiKey: "test-key" });
    expect(client.model).toBe(DEFAULT_CLAUDE_MODEL);
    expect(client.promptVersion).toBe(PROMPT_VERSION);
    expect(sdk.options[0]).toMatchObject({
      apiKey: "test-key",
      timeout: 120_000,
      maxRetries: 2,
      logLevel: "warn",
    });
  });

  it("sends the model, a token limit and a JSON schema for the reply", async () => {
    await new ClaudeLlmClient({ model: "claude-opus-5-5" }).analyzeClause(
      clauseRequest({ en: EOS_CLAUSE }),
    );
    const params = sentParams();
    expect(params.model).toBe("claude-opus-5-5");
    expect(params.max_tokens).toBe(16_000);
    expect(params.output_config?.format?.type).toBe("json_schema");
    expect(sentSchema()?.required).toEqual(["clause", "matches"]);
  });

  it("caches the system prompt and the candidate rules", async () => {
    const request = clauseRequest({ en: EOS_CLAUSE });
    await new ClaudeLlmClient().analyzeClause(request);

    expect(sentSystem()).toEqual([
      {
        type: "text",
        text: readFileSync(promptPath("clause"), "utf8"),
        cache_control: { type: "ephemeral" },
      },
    ]);
    const [rulesBlock, requestBlock] = sentUserBlocks();
    expect(rulesBlock?.cache_control).toEqual({ type: "ephemeral" });
    expect(rulesBlock?.text).toContain(
      JSON.stringify({ candidateRules: request.candidateRules }),
    );
    expect(requestBlock?.cache_control).toBeUndefined();
  });

  it("sends the clause, field summary, articles and previous error as JSON data", async () => {
    const request = {
      ...clauseRequest({ en: EOS_CLAUSE, ar: "نص عربي" }),
      previousError: "Cited Art. 99.",
    };
    await new ClaudeLlmClient().analyzeClause(request);
    const requestBlock = sentUserBlocks()[1];
    const sent: unknown = JSON.parse(requestBlock?.text.replace(/^Request:\n/, "") ?? "");
    expect(sent).toEqual({
      clause: request.clause,
      fieldSummary: request.fieldSummary,
      articles: request.articles,
      previousError: "Cited Art. 99.",
    });
  });

  it("uses the cross-check prompt and schema for crossCheck", async () => {
    sdk.create.mockResolvedValue(apiMessage('{"conflicts": []}'));
    const reply = await new ClaudeLlmClient().crossCheck(
      crossRequest(
        [{ number: "15.1", en: "This contract is for an unlimited period." }],
        FIXED_TERM_SUMMARY,
      ),
    );
    expect(sentSystem()[0]?.text).toBe(readFileSync(promptPath("cross"), "utf8"));
    expect(sentSchema()?.required).toEqual(["conflicts"]);
    expect(reply.json).toEqual({ conflicts: [] });
  });

  it("never logs the clause", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    await new ClaudeLlmClient().analyzeClause(clauseRequest({ en: EOS_CLAUSE }));
    sdk.create.mockResolvedValue(apiMessage("no json"));
    await expect(
      new ClaudeLlmClient().analyzeClause(clauseRequest({ en: EOS_CLAUSE })),
    ).rejects.toThrow();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

describe("ClaudeLlmClient reply", () => {
  const ask = () =>
    new ClaudeLlmClient().analyzeClause(clauseRequest({ en: EOS_CLAUSE }));

  it("returns the parsed JSON and maps usage, counting cached input tokens", async () => {
    const reply = await ask();
    expect(ClauseAnalysis.parse(reply.json)).toEqual(VALID_REPLY);
    expect(reply.usage).toEqual({ inputTokens: 3120, outputTokens: 80 });
  });

  it("rejects a refusal with the usage it cost", async () => {
    sdk.create.mockResolvedValue(apiMessage("", "refusal"));
    const error = await ask().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ClaudeReplyError);
    expect((error as ClaudeReplyError).message).toMatch(/refusal/);
    expect((error as ClaudeReplyError).usage).toEqual({
      inputTokens: 3120,
      outputTokens: 80,
    });
  });

  it("rejects a reply cut off at max_tokens", async () => {
    sdk.create.mockResolvedValue(
      apiMessage('{"clause": "15.6", "matches": [', "max_tokens"),
    );
    await expect(ask()).rejects.toThrow(/max_tokens/);
  });

  it("rejects a reply with no JSON object", async () => {
    sdk.create.mockResolvedValue(apiMessage("I cannot help with that."));
    await expect(ask()).rejects.toThrow(/did not contain a JSON object/);
  });

  it("passes SDK errors through for the engine to retry", async () => {
    sdk.create.mockRejectedValue(new Error("Connection error."));
    await expect(ask()).rejects.toThrow("Connection error.");
  });
});

describe("replyJsonSchema", () => {
  const schema = JSON.stringify(replyJsonSchema(ClauseAnalysis));

  it("keeps enums as real constraints", () => {
    expect(schema).toContain(
      '"enum":["likely_void","worse_than_default","conflict","compliant","better_than_law","unclear"]',
    );
    expect(schema).toContain('"enum":["basic","actual","other"]');
  });

  it("closes every object and drops keywords structured outputs does not accept", () => {
    expect(schema).toContain('"additionalProperties":false');
    expect(schema).not.toMatch(/"\$schema"|"minLength"|"minimum"/);
  });
});

describe("toLlmUsage", () => {
  it("treats missing cache counts as zero", () => {
    expect(
      toLlmUsage({
        input_tokens: 10,
        output_tokens: 5,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
        cache_creation: null,
        inference_geo: null,
        output_tokens_details: null,
        server_tool_use: null,
        service_tier: null,
      }),
    ).toEqual({ inputTokens: 10, outputTokens: 5 });
  });
});
