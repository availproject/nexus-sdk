import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { logs } from '@opentelemetry/api-logs';
import { resourceFromAttributes } from '@opentelemetry/resources';

function getOrGenerateClientId(): string {
  const KEY = 'nexus-client-id';
  let clientId = localStorage.getItem(KEY);

  if (!clientId) {
    clientId = crypto.randomUUID();
    localStorage.setItem(KEY, clientId);
  }
  return clientId;
}

const resource = resourceFromAttributes({
  'service.name': 'nexus-sdk-internal-logs',
  'client.id': getOrGenerateClientId(),
});

const loggerProvider = new LoggerProvider({
  resource: resource,
  processors: [
    new BatchLogRecordProcessor(
      new OTLPLogExporter({
        url: 'https://otel.avail.so/v1/logs',
        headers: { 'x-otlp-force-fetch': '1' },
      }),
    ),
  ],
});

logs.setGlobalLoggerProvider(loggerProvider);
const telemetryLogger = logs.getLogger('nexus-telemetry-logger');

export default telemetryLogger;
