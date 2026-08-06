import { describe, expect, it } from 'vitest';
import { deploymentResponseSchema } from '../../src/transport/middleware';

const wireChain = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  chainId: 999,
  universe: 'EVM',
  name: 'HyperEVM',
  rpcUrl: 'https://rpc.hyperliquid.xyz/evm',
  vaultAddress: '0x0000000000000000000000000000000000000001',
  multicallAddress: '0x00000000000000000000000000000000000000aa',
  nativeCurrency: {
    name: 'Hype',
    symbol: 'HYPE',
    decimals: 18,
    logo: 'https://example.com/hype.png',
    currencyId: 100,
  },
  sponsored: false,
  swapSupported: true,
  explorerUrl: 'https://hyperliquid.cloud.blockscout.com',
  logo: 'https://example.com/chain.png',
  tokens: [],
  ...overrides,
});

const wirePayload = (chainOverrides: Record<string, unknown> = {}) => ({
  network: 'mainnet',
  statekeeperUrl: 'https://statekeeper.example',
  fulfillmentBps: 0,
  mayanThresholdUsd: 0,
  mayanCancelRefundMaxPercentage: 0,
  chains: [wireChain(chainOverrides)],
});

describe('deploymentResponseSchema parses swapSupported independently of execution mode', () => {
  it('maps wire field swapSupported=true to chain.swapSupported=true', () => {
    const parsed = deploymentResponseSchema.parse(wirePayload({ swapSupported: true }));

    expect(parsed.chains[0].swapSupported).toBe(true);
  });

  it('maps wire field swapSupported=false to chain.swapSupported=false', () => {
    const parsed = deploymentResponseSchema.parse(wirePayload({ swapSupported: false }));

    expect(parsed.chains[0].swapSupported).toBe(false);
  });

  it('leaves swapSupported undefined when wire field omitted', () => {
    const parsed = deploymentResponseSchema.parse(wirePayload({ swapSupported: undefined }));

    expect(parsed.chains[0].swapSupported).toBeUndefined();
  });

  it('normalizes the EIP-7702 flag and configured Calibur address', () => {
    const caliburAddress = '0x00000000000000000000000000000000000000cc';
    const parsed = deploymentResponseSchema.parse(
      wirePayload({ eip7702Enabled: true, caliburAddress })
    );

    expect(parsed.chains[0]).toMatchObject({
      supports7702: true,
      caliburAddress,
    });
    expect(parsed.chains[0]).not.toHaveProperty('eip7702Enabled');
  });
});
