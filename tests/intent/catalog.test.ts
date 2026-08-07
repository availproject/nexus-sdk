import { describe, expect, it } from 'vitest';
import type { Chain } from '../../src/domain';
import { Universe } from '../../src/domain/chain-abstraction';
import {
  createIntentCatalog,
  intentNetworkEnabled,
  mergeSupportedChains,
} from '../../src/intent/catalog';
import type { IntentChain, IntentTokenCatalogEntry } from '../../src/intent/types';

const ETHEREUM_TOKEN = '0x0000000000000000000000000000000000000001' as const;
const BASE_TOKEN = '0x0000000000000000000000000000000000000002' as const;

const intentChain = (id: number, tokenAddress: `0x${string}`): IntentChain => ({
  id,
  name: `Intent ${id}`,
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  providers: ['nexus-v2'],
  tokens: [
    {
      chainId: id,
      address: tokenAddress,
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      isNative: false,
      providers: [{ id: 'nexus-v2', currencyId: 1 }],
    },
  ],
  capabilities: { intent: true, execute: false },
});

const executeChain = (id: number): Chain => ({
  id,
  name: `Execute ${id}`,
  universe: Universe.ETHEREUM,
  multicallAddress: '0x00000000000000000000000000000000000000aa',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18, logo: '' },
  custom: { icon: '', knownTokens: [] },
  rpcUrls: { default: { http: [`https://rpc-${id}.example`], webSocket: [] } },
});

const tokens: IntentTokenCatalogEntry[] = [
  {
    assetId: 'usd-coin',
    symbol: 'USDC',
    name: 'USD Coin',
    chains: [
      {
        universe: 'EVM',
        chainId: 1,
        address: ETHEREUM_TOKEN,
        name: 'USD Coin',
        decimals: 6,
        isNative: false,
        providers: [{ id: 'nexus-v2', currencyId: 1 }],
      },
      {
        universe: 'EVM',
        chainId: 8453,
        address: BASE_TOKEN,
        name: 'USD Coin',
        decimals: 6,
        isNative: false,
        providers: [{ id: 'nexus-v2', currencyId: 1 }],
      },
    ],
  },
];

describe('Better Intent catalog', () => {
  it('enables intent operations only for mainnet and canary', () => {
    expect(intentNetworkEnabled('mainnet')).toBe(true);
    expect(intentNetworkEnabled('canary')).toBe(true);
    expect(intentNetworkEnabled('testnet')).toBe(false);
  });

  it('resolves same-asset source filters for bridge quotes', () => {
    const catalog = createIntentCatalog(
      [intentChain(1, ETHEREUM_TOKEN), intentChain(8453, BASE_TOKEN)],
      tokens
    );

    expect(catalog.bridgeSources(1, ETHEREUM_TOKEN, [8453])).toEqual([
      { chainId: 'EVM_8453', tokens: [BASE_TOKEN] },
    ]);
    expect(() => catalog.bridgeSources(1, ETHEREUM_TOKEN, [10])).toThrow(
      /USDC is not available on source chain 10/
    );
  });

  it('unions intent and execute chains with explicit capabilities', () => {
    const result = mergeSupportedChains(
      [intentChain(1, ETHEREUM_TOKEN), intentChain(8453, BASE_TOKEN)],
      [executeChain(1), executeChain(10)]
    );

    expect(result.map(({ id, capabilities }) => ({ id, capabilities }))).toEqual([
      { id: 1, capabilities: { intent: true, execute: true } },
      { id: 10, capabilities: { intent: false, execute: true } },
      { id: 8453, capabilities: { intent: true, execute: false } },
    ]);
  });
});
