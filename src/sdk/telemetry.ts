import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { logs } from '@opentelemetry/api-logs';
import { resourceFromAttributes } from '@opentelemetry/resources';

const resource = resourceFromAttributes({ 'service.name': 'nexus-sdk-internal-logs' });

const loggerProvider = new LoggerProvider({
  resource: resource,
  processors: [
    new BatchLogRecordProcessor(new OTLPLogExporter({
      url: 'https://otel.avail.so/v1/logs',
    }))
  ]
});

logs.setGlobalLoggerProvider(loggerProvider);
const telemetryLogger = logs.getLogger('nexus-telemetry-logger');

export default telemetryLogger;