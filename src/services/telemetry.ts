import { type Logger, logs } from '@opentelemetry/api-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchLogRecordProcessor, LoggerProvider } from '@opentelemetry/sdk-logs';
import { toHex } from 'viem/utils';
import type { NetworkConfig } from '../domain';
import {
  cryptoGetRandomValues,
  isBrowser,
  locationHost,
  locationOrigin,
  storageGetItem,
  storageSetItem,
} from './platform';

let telemetryLogger: Logger | null = null;
let initInFlight: Promise<void> | null = null;

async function getOrGenerateClientId(): Promise<string> {
  const KEY = 'nexus-client-id';
  let clientId = storageGetItem(KEY);

  if (!clientId) {
    const bytes = new Uint8Array(32);
    clientId = toHex(await cryptoGetRandomValues(bytes));
    storageSetItem(KEY, clientId);
  }
  return clientId;
}

function getNetworkName(networkConfig: NetworkConfig): string {
  return networkConfig.NETWORK_HINT;
}

// Concurrency-safe one-shot init: `initialize()` and `setEVMProvider()` both call
// `setLoggerProvider(...)` at startup. Without the in-flight promise lock below, two
// concurrent first calls would both pass the `if (!telemetryLogger)` check, both build a
// LoggerProvider + OTLPLogExporter, and race to install them via `setGlobalLoggerProvider`.
// The shared promise makes the second caller await the first caller's work.
const setLoggerProvider = async (networkConfig: NetworkConfig): Promise<void> => {
  if (telemetryLogger) return;
  if (initInFlight) {
    await initInFlight;
    return;
  }

  initInFlight = (async () => {
    try {
      // TODO Check if window.origin is what we actually want because ChatGPT said:
      // There is no standard window.origin property.
      // In older browsers, window.origin might even be undefined.
      const loggerProvider = new LoggerProvider({
        resource: resourceFromAttributes({
          'service.name': 'nexus-sdk-v2-logs',
          'client.id': await getOrGenerateClientId(),
          origin: isBrowser() ? window.origin : locationOrigin(),
          host: locationHost(),
          hostname: locationHost(),
          network: getNetworkName(networkConfig),
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
      // biome-ignore lint/suspicious/noConsole: production fallback for telemetry failure
      console.error('Telemetry init failed; SDK will run without OTel emission', err);
      initInFlight = null;
    }
  })();

  await initInFlight;
};

export { setLoggerProvider, telemetryLogger };
