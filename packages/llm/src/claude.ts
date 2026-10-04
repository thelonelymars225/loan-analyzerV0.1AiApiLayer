import Anthropic from "@anthropic-ai/sdk";
import type {
  Message,
  MessageCreateParamsNonStreaming,
  Usage,
} from "@anthropic-ai/sdk/resources/messages";
import { z } from "zod";
import { ClauseAnalysis, CrossCheckResult } from "@rater/contracts";
import { extractJsonObject } from "./json";
import { loadPrompt, PROMPT_VERSION } from "./prompts";
import type { PromptName } from "./prompts";
import type {
  ClauseAnalysisRequest,
  CrossCheckRequest,
  LlmClient,
  LlmReply,
  LlmUsage,
} from "./types";

export { PROMPT_FILES, PROMPT_VERSION } from "./prompts";

/**
 * Model used when LLM_MODEL is not set. Pinned: every rating stores the model ID, and the
 * clause cache is keyed by it, so changing it is a deliberate release, not an upgrade.
 */
export const DEFAULT_CLAUDE_MODEL = "claude-opus-5-5";

/** Per-attempt timeout. A clause reply is short; this leaves room for the model's thinking. */
const DEFAULT_TIMEOUT_MS = 120_000;
/** SDK retries on 408/409/429/5xx and connection errors, with backoff. */
const DEFAULT_MAX_RETRIES = 2;
/** Thinking counts against max_tokens on current models, so leave headroom above the JSON. */
const DEFAULT_MAX_TOKENS = 16_000;

export interface ClaudeLlmClientOptions {
  /** Defaults to the SDK's own lookup (ANTHROPIC_API_KEY). */
  apiKey?: string;
  model?: string;
  baseURL?: string;
  timeoutMs?: number;
  maxRetries?: number;
  maxTokens?: number;
  /**
   * Constrain replies to the reply schema with structured outputs (default true). Turn it off
   * for a model that does not support `output_config.format`; replies are then parsed from text.
   */
  structuredOutput?: boolean;
}

/** A reply that holds no usable JSON. The engine retries once, then flags the clause for review. */
export class ClaudeReplyError extends Error {
  constructor(
    message: string,
    /** Tokens the failed call still used, for cost accounting. */
    readonly usage: LlmUsage,
  ) {
    super(message);
    this.name = "ClaudeReplyError";
  }
}

/** One analyser call: which prompt, which reply schema, and the request split for caching. */
interface Call {
  prompt: PromptName;
  schema: Record<string, unknown>;
  /** Identical for every clause of every contract under one ruleset, so it is cached. */
  candidateRules: ClauseAnalysisRequest["candidateRules"];
  /** Everything specific to this clause or contract. */
  request: Record<string, unknown>;
}

/**
 * LlmClient backed by Claude. Sends the versioned prompt as a cached system block and the
 * request as JSON, and returns the parsed JSON reply; the engine validates it against the
 * reply schema and the request's own rules and citations. Clause text is never logged.
 */
export class ClaudeLlmClient implements LlmClient {
  readonly model: string;
  readonly promptVersion = PROMPT_VERSION;
  private readonly client: Anthropic;
  private readonly maxTokens: number;
  private readonly structuredOutput: boolean;

  constructor(options: ClaudeLlmClientOptions = {}) {
    this.model = options.model ?? DEFAULT_CLAUDE_MODEL;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.structuredOutput = options.structuredOutput ?? true;
    this.client = new Anthropic({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
      // Fixed so that ANTHROPIC_LOG=debug cannot make the SDK log request bodies (clause text).
      logLevel: "warn",
    });
  }

  analyzeClause(req: ClauseAnalysisRequest): Promise<LlmReply> {
    const { candidateRules, ...request } = req;
    return this.ask({
      prompt: "clause",
      schema: CLAUSE_ANALYSIS_SCHEMA,
      candidateRules,
      request,
    });
  }

  crossCheck(req: CrossCheckRequest): Promise<LlmReply> {
    const { candidateRules, ...request } = req;
    return this.ask({
      prompt: "cross",
      schema: CROSS_CHECK_SCHEMA,
      candidateRules,
      request,
    });
  }

  private async ask(call: Call): Promise<LlmReply> {
    const message = await this.client.messages.create(this.params(call));
    const usage = toLlmUsage(message.usage);
    return { json: readReplyJson(message, usage), usage };
  }

  private params(call: Call): MessageCreateParamsNonStreaming {
    return {
      model: this.model,
      max_tokens: this.maxTokens,
      // The prompt is long and identical for every call of its kind, so it is cached.
      system: [
        {
          type: "text",
          text: loadPrompt(call.prompt),
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Candidate rules:\n${JSON.stringify({ candidateRules: call.candidateRules })}`,
              // Second cache breakpoint: the candidate rules repeat across clauses and contracts.
              cache_control: { type: "ephemeral" },
            },
            { type: "text", text: `Request:\n${JSON.stringify(call.request)}` },
          ],
        },
      ],
      ...(acceptsTemperature(this.model) ? { temperature: 0 } : {}),
      ...(this.structuredOutput
        ? { output_config: { format: { type: "json_schema", schema: call.schema } } }
        : {}),
    };
  }
}

/**
 * The spec asks for temperature 0. Claude Opus 4.7 and every later model reject sampling
 * parameters with a 400, so temperature 0 is only sent to the older models that accept it.
 * On the newer models repeatability comes from the pinned model, the reply schema and the
 * clause cache.
 */
const MODELS_ACCEPTING_TEMPERATURE = [
  "claude-3",
  "claude-haiku-4-5",
  "claude-sonnet-4-0",
  "claude-sonnet-4-2025",
  "claude-sonnet-4-5",
  "claude-sonnet-4-6",
  "claude-opus-4-0",
  "claude-opus-4-1",
  "claude-opus-4-2025",
  "claude-opus-4-5",
  "claude-opus-4-6",
];

export function acceptsTemperature(model: string): boolean {
  return MODELS_ACCEPTING_TEMPERATURE.some((prefix) => model.startsWith(prefix));
}

/**
 * The reply schemas as JSON Schema for structured outputs. Built with Zod's own converter
 * rather than the SDK's zod helper, because the helper turns enums into descriptions and so
 * would not constrain verdicts and severities. Keywords structured outputs does not accept
 * are dropped here; the engine still checks them with the Zod schema.
 */
const UNSUPPORTED_SCHEMA_KEYWORDS = new Set([
  "$schema",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
]);

export function replyJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return withoutUnsupportedKeywords(z.toJSONSchema(schema, { io: "output" })) as Record<
    string,
    unknown
  >;
}

function withoutUnsupportedKeywords(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutUnsupportedKeywords);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !UNSUPPORTED_SCHEMA_KEYWORDS.has(key))
      .map(([key, child]) => [key, withoutUnsupportedKeywords(child)]),
  );
}

const CLAUSE_ANALYSIS_SCHEMA = replyJsonSchema(ClauseAnalysis);
const CROSS_CHECK_SCHEMA = replyJsonSchema(CrossCheckResult);

/** The JSON object in the reply's text blocks (thinking blocks are skipped). */
function readReplyJson(message: Message, usage: LlmUsage): unknown {
  if (message.stop_reason === "refusal") {
    throw new ClaudeReplyError(
      "The model declined to answer (stop_reason refusal).",
      usage,
    );
  }
  const text = message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("");
  const json = extractJsonObject(text);
  if (json !== undefined) return json;
  if (message.stop_reason === "max_tokens") {
    throw new ClaudeReplyError(
      "The reply hit max_tokens before the JSON object was complete.",
      usage,
    );
  }
  throw new ClaudeReplyError("The reply did not contain a JSON object.", usage);
}

/**
 * Input tokens include cached ones: the API reports cache reads and writes separately from
 * `input_tokens`, but all of them were part of the prompt the model read.
 */
export function toLlmUsage(usage: Usage): LlmUsage {
  return {
    inputTokens:
      usage.input_tokens +
      (usage.cache_creation_input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0),
    outputTokens: usage.output_tokens,
  };
}
