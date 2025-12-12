import { Environment } from '@avail-project/ca-common';
import { type Logger, logs } from '@opentelemetry/api-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchLogRecordProcessor, LoggerProvider } from '@opentelemetry/sdk-logs';
import { toHex } from 'viem/utils';
import type { NetworkConfig } from '../../commons';

let telemetryLogger: Logger | null = null;

function getOrGenerateClientId(): string {
  const KEY = 'nexus-client-id';
  let clientId = window.localStorage.getItem(KEY);

  if (!clientId) {
    const bytes = new Uint8Array(32);
    clientId = toHex(window.crypto.getRandomValues(bytes));
    window.localStorage.setItem(KEY, clientId);
  }
  return clientId;
}

function getNetworkName(networkConfig: NetworkConfig): string {
  return Environment[networkConfig.NETWORK_HINT];
}

const setLoggerProvider = (networkConfig: NetworkConfig) => {
  if (!telemetryLogger) {
    const loggerProvider = new LoggerProvider({
      resource: resourceFromAttributes({
        'service.name': 'nexus-sdk-internal-logs',
        'client.id': getOrGenerateClientId(),
        origin: window.origin,
        host: window.location.host,
        hostname: window.location.hostname,
        network: getNetworkName(networkConfig),
      }),
      processors: [
        new BatchLogRecordProcessor(
          new OTLPLogExporter({
            url: 'https://otel.avail.so/v1/logs',
            headers: { 'x-otlp-force-fetch': '1' },
          })
        ),
      ],
    });
    logs.setGlobalLoggerProvider(loggerProvider);
    telemetryLogger = logs.getLogger('nexus-telemetry-logger');
  }
};

export { setLoggerProvider, telemetryLogger };
