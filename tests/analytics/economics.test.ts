import { describe, expect, it, vi } from 'vitest';
import { AnalyticsManager } from '../../src/analytics/AnalyticsManager';
import { NexusAnalyticsEvents } from '../../src/analytics/events';
import { buildEconomics, extractBridgeProperties } from '../../src/analytics/utils';
import { trackSwapExactIn } from '../../src/core/sdk/operation-boundary';
import type { BridgeIntent } from '../../src/domain';
import type { SwapIntent, SwapResult } from '../../src/swap/types';

const ZERO = '0x0000000000000000000000000000000000000000' as const;
const USDC = '0x0000000000000000000000000000000000000002' as const;
const ETH_TOKEN = '0x0000000000000000000000000000000000000001' as const;

// A cross-chain swap (USDC Arbitrum -> ETH Base) with a Nexus bridge leg, so
// the bridge fees (including protocol) are present.
const swapIntent: SwapIntent = {
  destination: {
    amount: '0.0298',
    value: '99.80',
    chain: { id: 8453, logo: '', name: 'Base' },
    token: { contractAddress: ETH_TOKEN, decimals: 18, symbol: 'ETH' },
    gas: { amount: '0', token: { contractAddress: ZERO, decimals: 18, symbol: 'ETH' } },
  },
  feesAndBuffer: {
    buffer: '0.30',
    bridge: { caGas: '0.10', protocol: '0.05', solver: '0', total: '0.15' },
  },
  bridgeProvider: 'nexus',
  sources: [
    {
      amount: '100.0',
      value: '100.00',
      chain: { id: 42161, logo: '', name: 'Arbitrum' },
      token: { contractAddress: USDC, decimals: 6, symbol: 'USDC' },
    },
  ],
};

const swapResult: SwapResult = {
  sourceSwaps: [],
  intentExplorerUrl: '',
  destinationSwap: null,
  intent: swapIntent,
};

const bridgeIntent: BridgeIntent = {
  provider: 'nexus',
  availableSources: [],
  destination: {
    amount: '99.90',
    amountRaw: 0n,
    chain: { id: 8453, name: 'Base', logo: '' },
    token: { decimals: 6, symbol: 'USDC', logo: '', contractAddress: USDC },
    value: '99.90',
    nativeAmount: '0',
    nativeAmountRaw: 0n,
    nativeAmountValue: '0',
    nativeAmountInToken: '0',
    nativeToken: { decimals: 18, symbol: 'ETH', logo: '', contractAddress: ZERO },
  },
  fees: { caGas: '0.10', protocol: '0.05', solver: '0', total: '0.15', totalValue: '0.15' },
  selectedSources: [
    {
      amount: '100.05',
      amountRaw: 0n,
      chain: { id: 42161, name: 'Arbitrum', logo: '' },
      token: { decimals: 6, symbol: 'USDC', logo: '', contractAddress: USDC },
      value: '100.05',
    },
  ],
  sourcesTotal: '100.05',
  sourcesTotalValue: '100.05',
};

describe('analytics economics block', () => {
  it('buildEconomics wraps the input under an `economics` key', () => {
    const out = buildEconomics({
      provider: 'nexus',
      valueUsd: '10.12999',
      tokenSymbol: 'ETH',
      amount: '1.23456789',
      fees: { protocol: '0.001234', caGas: '0.2', solver: '0', total: '0.3' },
      buffer: '0',
      sources: [{ symbol: 'USDC', chainId: 1, chainName: 'Ethereum', amount: '11', valueUsd: '11.009' }],
    });
    expect(out).toEqual({
      economics: {
        provider: 'nexus',
        valueUsd: '10.13', // USD rounded to cents
        tokenSymbol: 'ETH',
        amount: '1.23456789', // token amount keeps full precision
        fees: { protocol: '0.001234', caGas: '0.2', solver: '0', total: '0.3' }, // fees keep precision
        buffer: '0',
        sources: [{ symbol: 'USDC', chainId: 1, chainName: 'Ethereum', amount: '11', valueUsd: '11.01' }],
      },
    });
  });

  it('extractBridgeProperties emits the normalized economics block', () => {
    const props = extractBridgeProperties(bridgeIntent) as {
      bridge: unknown;
      economics: Record<string, unknown>;
    };

    expect(props.bridge).toBeDefined(); // existing nested object left intact
    expect(props.economics).toMatchObject({
      provider: 'nexus',
      valueUsd: '99.90',
      tokenSymbol: 'USDC',
      amount: '99.90',
      fees: { protocol: '0.05', caGas: '0.10', solver: '0', total: '0.15' },
      sources: [{ symbol: 'USDC', chainId: 42161, chainName: 'Arbitrum', valueUsd: '100.05' }],
    });
  });

  it('emits the economics block on swap success', async () => {
    const manager = new AnalyticsManager('testnet', { enabled: true, mode: 'on' });
    const trackSpy = vi.spyOn(manager, 'track');

    await trackSwapExactIn(
      manager,
      { toChainId: 8453, toTokenAddress: ETH_TOKEN },
      undefined,
      async () => swapResult
    );

    const successCall = trackSpy.mock.calls.find(
      ([event]) => event === NexusAnalyticsEvents.SWAP_TRANSACTION_SUCCESS
    );
    expect(successCall).toBeDefined();

    const economics = (successCall?.[1] as { economics: Record<string, unknown> }).economics;
    expect(economics).toMatchObject({
      provider: 'nexus',
      valueUsd: '99.80',
      tokenSymbol: 'ETH',
      amount: '0.0298',
      buffer: '0.30',
      fees: { protocol: '0.05', caGas: '0.10', solver: '0', total: '0.15' },
    });
  });
});
