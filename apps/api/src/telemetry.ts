import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { NodeSDK } from "@opentelemetry/sdk-node";

/**
 * OpenTelemetry traces, exported over OTLP/HTTP. Off unless OTEL_EXPORTER_OTLP_ENDPOINT is
 * set; the exporter reads that and the other standard OTEL_* variables itself.
 * Returns a function that flushes and stops the SDK (a no-op when telemetry is off).
 */
export function startTelemetry(
  env: NodeJS.ProcessEnv = process.env,
): () => Promise<void> {
  if (!env.OTEL_EXPORTER_OTLP_ENDPOINT) return async () => {};

  const sdk = new NodeSDK({
    serviceName: env.OTEL_SERVICE_NAME ?? "contract-rater-api",
    traceExporter: new OTLPTraceExporter(),
  });
  sdk.start();
  return () => sdk.shutdown();
}
