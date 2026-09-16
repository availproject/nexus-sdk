import { type AnyValueMap, type Logger, logs, SeverityNumber } from '@opentelemetry/api-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchLogRecordProcessor, LoggerProvider } from '@opentelemetry/sdk-logs';
import { version } from '../../package.json' with { type: 'json' };
import type { NetworkConfig } from '../domain';
import { locationHost, locationOrigin } from './platform';

let telemetryLogger: Logger | null = null;
let initInFlight: Promise<void> | null = null;

// Concurrency-safe one-shot init: `initialize()` and `setEVMProvider()` both call
// `setLoggerProvider(...)` at startup. Without the in-flight promise lock below, two
// concurrent first calls would both pass the `if (!telemetryLogger)` check, both build a
// LoggerProvider + OTLPLogExporter, and race to install them via `setGlobalLoggerProvider`.
// The shared promise makes the second caller await the first caller's work.
const setLoggerProvider = async (_networkConfig: NetworkConfig): Promise<void> => {
  if (telemetryLogger) return;
  if (initInFlight) {
    await initInFlight;
    return;
  }

  initInFlight = (async () => {
    // Install the shared promise before initialization can fail and clear it.
    await Promise.resolve();
    try {
      const loggerProvider = new LoggerProvider({
        resource: resourceFromAttributes({
          'service.name': 'nexus-sdk-v2-logs',
          'service.version': version,
          origin: locationOrigin(),
          host: locationHost(),
          hostname: locationHost(),
        }),
        processors: [
          new BatchLogRecordProcessor(
            new OTLPLogExporter({
              url: 'https://otel2.avail.so/v1/logs',
              headers: { 'x-otlp-force-fetch': '1' },
            })
          ),
        ],
      });
      logs.setGlobalLoggerProvider(loggerProvider);
      telemetryLogger = logs.getLogger('nexus-v2-telemetry-logger');
    } catch (err) {
      // Telemetry init must never block SDK usage. Log for debugging, leave
      // `telemetryLogger = null` (callers of `reportOperationError` will then no-op),
      // and clear the lock so a future call can retry. The promise itself still
      // resolves successfully — `await setLoggerProvider(...)` from `initialize()`
      // or `setEVMProvider()` won't reject just because OTel setup blew up.
      console.error('Telemetry init failed; SDK will run without OTel emission', err);
      initInFlight = null;
    }
  })();

  await initInFlight;
};

export { setLoggerProvider, telemetryLogger };

/** Structured lifecycle observations; caller supplies per-client identity. */
export const reportTelemetryEvent = (event: string, attributes: Record<string, unknown>): void => {
  try {
    telemetryLogger?.emit({
      body: event,
      severityNumber: SeverityNumber.INFO,
      severityText: 'INFO',
      attributes: attributes as AnyValueMap,
    });
  } catch {
    // Reporting must not interrupt an operation or replace its error.
  }
};
