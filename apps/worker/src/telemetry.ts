import { SpanStatusCode, trace } from "@opentelemetry/api";
import type { Attributes, Span } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { NodeSDK } from "@opentelemetry/sdk-node";

export interface Telemetry {
  enabled: boolean;
  /** Flushes pending spans. Call once on shutdown. */
  shutdown(): Promise<void>;
}

/**
 * Starts OpenTelemetry tracing when an OTLP endpoint is configured
 * (OTEL_EXPORTER_OTLP_ENDPOINT or OTEL_EXPORTER_OTLP_TRACES_ENDPOINT). Without one, nothing is
 * started and every span below is a no-op, so local runs and tests need no collector.
 */
export function startTelemetry(env: NodeJS.ProcessEnv = process.env): Telemetry {
  const endpoint =
    env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim() ||
    env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!endpoint) {
    return { enabled: false, shutdown: async () => {} };
  }
  // The exporter reads the endpoint and headers from the same OTEL_* variables.
  const sdk = new NodeSDK({
    serviceName: env.OTEL_SERVICE_NAME?.trim() || "contract-rater-worker",
    traceExporter: new OTLPTraceExporter(),
  });
  sdk.start();
  return { enabled: true, shutdown: () => sdk.shutdown() };
}

const tracer = trace.getTracer("contract-rater-worker");

/**
 * Runs `work` inside a span. A thrown error is recorded on the span and rethrown.
 * Spans nest: a span started inside `work` becomes a child of this one.
 */
export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  work: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await work(span);
    } catch (error) {
      span.recordException(error instanceof Error ? error : String(error));
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}
