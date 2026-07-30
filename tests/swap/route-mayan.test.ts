import { describe, expect, it, vi } from 'vitest';
import Decimal from 'decimal.js';
import { type Hex } from 'viem';
import type { MayanQuote } from '@avail-project/nexus-types';
import {
  determineSwapRoute,
  enrichMayanBridge,
  type RouteOptions,
} from '../../src/swap/route';
import { CurrencyID } from '../../src/swap/cot';
import { SwapMode } from '../../src/swap/types';
import type {
  BridgeAsset,
  OraclePriceResponse,
  PublicClientList,
  SwapData,
  SwapRoute,
} from '../../src/swap/types';
import type { ChainListType } from '../../src/domain';
import {
  EPHEMERAL_EXECUTOR,
  makeDstTokenInfo,
  makePublicClientList,
  makeSwapChainList,
} from '../helpers/swap';

const USDC_ARB = '0xaf88d065e77c8cc2239327c5edb3a432268e5831' as Hex;
const USDC_BASE = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' as Hex;
const ARB_CHAIN = 42161;
const BASE_CHAIN = 8453;

const makeMayanQuote = (minReceived: number): MayanQuote =>
  ({ minReceived, protocolBps: 3 }) as unknown as MayanQuote;

const makeBridgeAsset = (chainId: number, address: Hex, balance = '3000'): BridgeAsset => ({
  chainID: chainId,
  contractAddress: address,
  decimals: 6,
  eoaBalance: new Decimal(0),
  ephemeralBalance: new Decimal(balance),
});

const makeBridge = (
  assets: BridgeAsset[],
  overrides?: Partial<NonNullable<SwapRoute['bridge']>>
): NonNullable<SwapRoute['bridge']> => ({
  amount: new Decimal('6000'),
  amounts: {
    tokenAmount: new Decimal('6000'),
    gasInCot: new Decimal(0),
    totalAmount: new Decimal('6000'),
  },
  assets,
  chainID: BASE_CHAIN,
  decimals: 6,
  tokenAddress: USDC_BASE,
  estimatedFees: {
    collection: new Decimal(0),
    fulfilment: new Decimal(0),
    caGas: new Decimal(0),
    protocol: new Decimal(0),
    solver: new Decimal(0),
  },
  provider: 'nexus',
  ...overrides,
});

type ChainListOverrides = {
  destChain?: { mayanDisabled?: boolean };
  destToken?: { mayanDisabled?: boolean };
  srcByChain?: Record<number, { mayanDisabled?: boolean; tokenMayanDisabled?: boolean }>;
};

const makeChainList = (overrides: ChainListOverrides = {}): ChainListType =>
  ({
    getChainByID: (id: number) => {
      if (id === BASE_CHAIN) {
        return { id, mayanEnabled: !(overrides.destChain?.mayanDisabled ?? false) };
      }
      const cfg = overrides.srcByChain?.[id];
      return { id, mayanEnabled: !(cfg?.mayanDisabled ?? false) };
    },
    getTokenByAddress: (chainId: number, _address: Hex) => {
      if (chainId === BASE_CHAIN) {
        return { mayanEnabled: !(overrides.destToken?.mayanDisabled ?? false) };
      }
      const cfg = overrides.srcByChain?.[chainId];
      return { mayanEnabled: !(cfg?.tokenMayanDisabled ?? false) };
    },
  }) as unknown as ChainListType;

const makeMiddleware = (opts: { quotesByChain?: Record<number, MayanQuote> } = {}) => ({
  getMayanQuotes: async (req: {
    sources: { chain_id: string; contract_address: Hex; amount: string }[];
    destination: { chain_id: string; contract_address: Hex };
  }) => ({
    destination: { chainId: BASE_CHAIN, tokenAddress: USDC_BASE },
    quotes: req.sources.map((s) => {
      const chainId = Number(BigInt(s.chain_id));
      const quote = opts.quotesByChain?.[chainId];
      if (!quote) throw new Error(`no quote stubbed for chain ${chainId}`);
      return {
        source: { chainId, tokenAddress: s.contract_address, amount: s.amount },
        mayanQuote: quote,
      };
    }),
  }),
});

const makeBridgeQuoteResponse = () => ({
  fulfillmentBps: 0,
  sources: [
    {
      chainId: ARB_CHAIN,
      tokenAddress: USDC_ARB,
      depositFeeUsd: '0',
      depositFeeToken: '0',
    },
  ],
  destination: {
    chainId: BASE_CHAIN,
    tokenAddress: USDC_BASE,
    fulfillmentFeeUsd: '0',
    fulfillmentFeeToken: '0',
  },
});

const makeProviderMiddleware = () => ({
  getBridgeProvider: vi.fn().mockResolvedValue({ provider: 'mayan' }),
  getMayanQuotes: vi.fn().mockImplementation(
    async (req: {
      sources: { chain_id: Hex; contract_address: Hex; amount: string }[];
      destination: { chain_id: Hex; contract_address: Hex };
    }) => ({
      destination: req.destination,
      quotes: req.sources.map((source) => ({
        source: {
          chainId: Number(BigInt(source.chain_id)),
          tokenAddress: source.contract_address,
          amount: source.amount,
        },
        mayanQuote: { minReceived: source.amount, protocolBps: 3 },
      })),
    })
  ),
  getQuote: vi.fn().mockResolvedValue(makeBridgeQuoteResponse()),
});

const makeProviderChainList = (mayanEnabled: boolean): ChainListType => {
  const chainList = makeSwapChainList();
  if (mayanEnabled) return chainList;

  return {
    ...chainList,
    getTokenByAddress: vi.fn().mockImplementation((chainId: number, address: Hex) => {
      const token = chainList.getTokenByAddress(chainId, address);
      return chainId === ARB_CHAIN && token ? { ...token, mayanEnabled: false } : token;
    }),
  } as ChainListType;
};

const makeProviderRouteOptions = ({
  chainList,
  middlewareClient,
}: {
  chainList: ChainListType;
  middlewareClient: ReturnType<typeof makeProviderMiddleware>;
}): RouteOptions => ({
  aggregators: [],
  balances: [
    {
      amount: '5',
      chainID: ARB_CHAIN,
      decimals: 6,
      symbol: 'USDC',
      tokenAddress: USDC_ARB,
      value: 5,
      logo: '',
      name: 'USD Coin',
    },
  ],
  bridgeQuoteResponse: makeBridgeQuoteResponse() as never,
  chainList,
  cotCurrencyId: CurrencyID.USDC,
  dstTokenInfo: makeDstTokenInfo({
    contractAddress: USDC_BASE,
    decimals: 6,
    symbol: 'USDC',
    name: 'USD Coin',
  }),
  eoaAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  ephemeralAddress: EPHEMERAL_EXECUTOR,
  forceMayan: false,
  middlewareClient: middlewareClient as never,
  oraclePrices: [] as OraclePriceResponse,
  publicClientList: makePublicClientList() as unknown as PublicClientList,
  quoteAddressHints: new Map([
    [ARB_CHAIN, EPHEMERAL_EXECUTOR],
    [BASE_CHAIN, EPHEMERAL_EXECUTOR],
  ]),
  walletPathHints: new Map([
    [ARB_CHAIN, 'ephemeral'],
    [BASE_CHAIN, 'ephemeral'],
  ]),
});

describe('enrichMayanBridge', () => {
  it('populates mayanQuotesBySource per source when bridge.provider is mayan', async () => {
    const arbQuote = makeMayanQuote(100);
    const bridge = makeBridge([makeBridgeAsset(ARB_CHAIN, USDC_ARB)], { provider: 'mayan' });
    const middleware = makeMiddleware({ quotesByChain: { [ARB_CHAIN]: arbQuote } });

    const result = await enrichMayanBridge(bridge, {
      chainList: makeChainList(),
      middlewareClient: middleware as never,
    });

    expect(result.provider).toBe('mayan');
    expect(result.mayanQuotesBySource?.get(`${ARB_CHAIN}:${USDC_ARB.toLowerCase()}`)).toBe(arbQuote);
  });

  it('records the Mayan haircut (gross bridged − Σ minReceived) as estimatedFees, not the Nexus fee', async () => {
    // 3000 USDC bridged, Mayan guarantees 2900 on the destination → a 100 USDC haircut. The route's
    // recorded fee must reflect that, not the Nexus fulfilment/protocol the call site stubbed (0 here).
    const bridge = makeBridge([makeBridgeAsset(ARB_CHAIN, USDC_ARB, '3000')], { provider: 'mayan' });
    const middleware = makeMiddleware({ quotesByChain: { [ARB_CHAIN]: makeMayanQuote(2900) } });

    const result = await enrichMayanBridge(bridge, {
      chainList: makeChainList(),
      middlewareClient: middleware as never,
    });

    expect(result.estimatedFees.protocol.toString()).toBe('100');
    expect(result.estimatedFees.fulfilment.toString()).toBe('0');
    expect(result.estimatedFees.collection.toString()).toBe('0');
  });

  it.each([
    {
      boundary: 'source chain',
      chainList: makeChainList({
        srcByChain: { [ARB_CHAIN]: { mayanDisabled: true } },
      }),
      error: /source chain 42161.*disabled for mayan/i,
    },
    {
      boundary: 'source token',
      chainList: makeChainList({
        srcByChain: { [ARB_CHAIN]: { tokenMayanDisabled: true } },
      }),
      error: /disabled for mayan/i,
    },
    {
      boundary: 'destination chain',
      chainList: makeChainList({ destChain: { mayanDisabled: true } }),
      error: /destination chain.*disabled for mayan/i,
    },
  ])('throws when the $boundary is disabled', async ({ chainList, error }) => {
    const bridge = makeBridge([makeBridgeAsset(ARB_CHAIN, USDC_ARB)], { provider: 'mayan' });
    const middleware = makeMiddleware();

    await expect(
      enrichMayanBridge(bridge, { chainList, middlewareClient: middleware as never })
    ).rejects.toThrow(error);
  });
});

describe('determineSwapRoute — Mayan provider matrix', () => {
  it.each([
    {
      label: 'EXACT_IN enabled',
      mode: SwapMode.EXACT_IN,
      mayanEnabled: true,
      expectedProvider: 'mayan' as const,
    },
    {
      label: 'EXACT_IN disabled',
      mode: SwapMode.EXACT_IN,
      mayanEnabled: false,
      expectedProvider: 'nexus' as const,
    },
    {
      label: 'EXACT_OUT enabled',
      mode: SwapMode.EXACT_OUT,
      mayanEnabled: true,
      expectedProvider: 'mayan' as const,
    },
    {
      label: 'EXACT_OUT disabled',
      mode: SwapMode.EXACT_OUT,
      mayanEnabled: false,
      expectedProvider: 'nexus' as const,
    },
  ])('$label selects $expectedProvider', async ({
    expectedProvider,
    mayanEnabled,
    mode,
  }) => {
    const middlewareClient = makeProviderMiddleware();
    const input: SwapData =
      mode === SwapMode.EXACT_IN
        ? {
            mode,
            data: {
              sources: [
                {
                  chainId: ARB_CHAIN,
                  tokenAddress: USDC_ARB,
                  amountRaw: 5_000_000n,
                },
              ],
              toChainId: BASE_CHAIN,
              toTokenAddress: USDC_BASE,
            },
          }
        : {
            mode,
            data: {
              sources: [{ chainId: ARB_CHAIN, tokenAddress: USDC_ARB }],
              toAmountRaw: 2_000_000n,
              toChainId: BASE_CHAIN,
              toTokenAddress: USDC_BASE,
            },
          };

    const route = await determineSwapRoute(
      input,
      makeProviderRouteOptions({
        chainList: makeProviderChainList(mayanEnabled),
        middlewareClient,
      })
    );

    expect(route.bridge?.provider).toBe(expectedProvider);
    if (expectedProvider === 'mayan') {
      expect(route.bridge?.mayanQuotesBySource?.size).toBe(1);
    } else {
      expect(route.bridge?.mayanQuotesBySource).toBeUndefined();
    }
  });
});
