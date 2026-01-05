import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { Logger, logs } from '@opentelemetry/api-logs';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { Environment } from '@avail-project/ca-common';
import { toHex } from 'viem/utils';
import { NetworkConfig } from '../../commons';
import { PlatformUtils } from './utils/platform.utils';


let telemetryLogger: Logger | null = null;

async function getOrGenerateClientId(): Promise<string> {
  const KEY = 'nexus-client-id';
  let clientId = PlatformUtils.storageGetItem(KEY);

  if (!clientId) {
    const bytes = new Uint8Array(32);
    clientId = toHex(await PlatformUtils.cryptoGetRandomValues(bytes));
    PlatformUtils.storageSetItem(KEY, clientId);
  }
  return clientId;
}

function getNetworkName(networkConfig: NetworkConfig): string {
  return Environment[networkConfig.NETWORK_HINT];
}

const setLoggerProvider = async (networkConfig: NetworkConfig) => {
  if (!telemetryLogger) {
    // TODO Check if window.origin is what we actually want because ChatGPT said:
    // There is no standard window.origin property.
    // In older browsers, window.origin might even be undefined.
    const loggerProvider = new LoggerProvider({
      resource: resourceFromAttributes({
        'service.name': 'nexus-sdk-internal-logs',
        'client.id': await getOrGenerateClientId(),
        'origin': PlatformUtils.isBrowser() ? window.origin : PlatformUtils.locationOrigin(),
        'host': PlatformUtils.locationHost(),
        'hostname': PlatformUtils.locationHost(),
        'network': getNetworkName(networkConfig),
      }),
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
    telemetryLogger = logs.getLogger('nexus-telemetry-logger');
  }
};

export { setLoggerProvider, telemetryLogger };
