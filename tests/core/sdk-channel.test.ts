import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNexusClient } from '../../src';
import { createMiddlewareClient } from '../../src/transport/middleware';
import { getSupportedChains } from '../../src/utils';

vi.mock('../../src/services/telemetry', () => ({
  setLoggerProvider: vi.fn().mockResolvedValue(undefined),
  telemetryLogger: null,
}));

const originalAdapter = axios.defaults.adapter;
const requests: URL[] = [];
const channels = [undefined, 'stable', 'preview'] as const;
const address = '0x0000000000000000000000000000000000000001';
const deployment = {
  network: 'mainnet',
  statekeeperUrl: 'https://statekeeper.example',
  fulfillmentBps: 0,
  mayanThresholdUsd: 0,
  mayanCancelRefundMaxPercentage: 0,
  chains: [],
};

beforeEach(() => {
  requests.length = 0;
  // Keep Axios serialization and the SDK transport real; replace only the network adapter.
  axios.defaults.adapter = async (config) => {
    requests.push(new URL(axios.getUri(config)));
    const data =
      config.url === '/deployment'
        ? deployment
        : config.url === '/api/v1/oracle'
          ? { priceData: [] }
          : {};
    return { config, data, headers: {}, status: 200, statusText: 'OK' };
  };
});

afterEach(() => {
  axios.defaults.adapter = originalAdapter;
});

describe('chain release channels', () => {
  it.each(channels)('initializes the SDK with channel %s', async (channel) => {
    const client = createNexusClient({
      network: 'mainnet',
      channel,
      analytics: { enabled: false },
      devTiming: { enabled: false },
    });
    try {
      await client.initialize();
      expect(requests.map((url) => url.pathname + url.search)).toEqual([
        `/middleware/deployment?channel=${channel ?? 'stable'}`,
      ]);
      expect(client.getSupportedChains()).toEqual([]);
    } finally {
      client.destroy();
    }
  });

  it.each(channels)('fetches standalone supported chains with channel %s', async (channel) => {
    await getSupportedChains('mainnet', channel === undefined ? undefined : { channel });
    expect(requests.map((url) => url.pathname + url.search)).toEqual([
      `/middleware/deployment?channel=${channel ?? 'stable'}`,
    ]);
  });

  it.each(channels)('scopes channel %s to middleware catalogue requests', async (channel) => {
    const middleware = createMiddlewareClient(
      'https://mw.example',
      channel === undefined ? undefined : { channel }
    );
    try {
      await middleware.getDeployment();
      await middleware.getBalances(address, 0);
      await middleware.getSwapBalances(address);
      await middleware.getOraclePrices();
      await middleware.getLiFiQuote({ fromChain: '1', toChain: '8453' });

      const query = `?channel=${channel ?? 'stable'}`;
      expect(requests.map((url) => url.pathname + url.search)).toEqual([
        `/deployment${query}`,
        `/api/v1/balance/evm/${address}${query}`,
        `/api/v1/swap-balance/EVM/${address}${query}`,
        `/api/v1/oracle${query}`,
        '/api/v1/proxy/lifi/quote?fromChain=1&toChain=8453',
      ]);
    } finally {
      middleware.destroy();
    }
  });
});
