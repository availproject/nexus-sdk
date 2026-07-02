import process from 'node:process';
import type { NexusNetworkHint } from '../../../../src/domain/types';
import { normalizePrivateKey } from '../stress-test/private-key';

export type CronEnv = {
  privateKey: `0x${string}`;
  network: NexusNetworkHint;
  usdcAmount: string;
  ethAmount: string;
  sdkDir: string;
  slackWebhookUrl?: string;
  settleLookbackHours: number;
  otelMetricsEndpoint?: string;
};

export const readEnv = (): CronEnv => {
  const raw = process.env.NEXUS_STRESS_PRIVATE_KEY;
  if (!raw) throw new Error('NEXUS_STRESS_PRIVATE_KEY is required');
  const privateKey = normalizePrivateKey(raw);
  if (!privateKey) {
    throw new Error('Invalid NEXUS_STRESS_PRIVATE_KEY (expected 0x-prefixed 32-byte hex)');
  }
  const settleLookbackRaw = Number(process.env.SETTLE_LOOKBACK_HOURS ?? '4');
  const settleLookbackHours =
    Number.isFinite(settleLookbackRaw) && settleLookbackRaw > 0 ? settleLookbackRaw : 4;
  // Validate inline against the literal NexusNetworkHint members. We don't
  // pull the SDK's switch fallback (getNetworkConfig silently defaults
  // unknown values to mainnet), so a `NETWORK=cnary` typo would otherwise
  // run against prod-mainnet without warning.
  const networkRaw = process.env.NETWORK ?? 'testnet';
  if (networkRaw !== 'mainnet' && networkRaw !== 'testnet' && networkRaw !== 'canary') {
    throw new Error(`NETWORK must be one of mainnet, testnet, canary; got "${networkRaw}"`);
  }
  return {
    privateKey,
    network: networkRaw,
    usdcAmount: process.env.USDC_AMOUNT ?? process.env.AMOUNT ?? '0.1',
    ethAmount: process.env.ETH_AMOUNT ?? '0.001',
    sdkDir: process.env.SDK_DIR ?? '/app/nexus-sdk',
    slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
    settleLookbackHours,
    // Optional OTLP/HTTP metrics endpoint. OTEL_METRICS_ENDPOINT is our own
    // var; OTEL_EXPORTER_OTLP_METRICS_ENDPOINT is the OTel-standard name other
    // Avail services use — accept either. Unset → metrics emission is skipped.
    otelMetricsEndpoint:
      process.env.OTEL_METRICS_ENDPOINT ?? process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT,
  };
};
