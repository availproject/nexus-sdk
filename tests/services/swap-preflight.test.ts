import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hex } from 'viem';
import type { ChainListType, TokenInfo } from '../../src/domain';
import { CurrencyID } from '../../src/swap/cot';
import { SwapMode, type SwapData } from '../../src/swap/types';
import { makeMiddlewareClient as makeBaseMiddlewareClient } from '../helpers/middleware-client';

const hoisted = vi.hoisted(() => ({
  debug: vi.fn(),
}));

vi.mock('../../src/domain', async () => {
  const actual = await vi.importActual<typeof import('../../src/domain')>('../../src/domain');
  return {
    ...actual,
    getLogger: () => ({
      debug: hoisted.debug,
    }),
  };
});

vi.mock('../../src/swap/aggregators', () => ({
  createAggregators: vi.fn().mockReturnValue(['aggregator']),
}));

vi.mock('../../src/swap/balance/swap-balances', () => ({
  getBalancesForSwap: vi.fn(),
}));

vi.mock('../../src/services/token-metadata', () => ({
  fetchErc20TokenMetadata: vi.fn().mockResolvedValue({
    contractAddress: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    decimals: 18,
    symbol: 'WETH',
  }),
}));

import { createAggregators } from '../../src/swap/aggregators';
import { getBalancesForSwap } from '../../src/swap/balance/swap-balances';
import { buildSwapPreflight } from '../../src/swap/preflight';
import { fetchErc20TokenMetadata } from '../../src/services/token-metadata';
import { EADDRESS } from '../../src/swap/constants';

const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' as Hex;
const USDC = '0xaf88d065e77c8cc2239327c5edb3a432268e5831' as Hex;
const USDC_OP = '0x0b2c639c533813f4aa9d7837caf62653d097ff85' as Hex;
const ARB_CHAIN = 42161;
const BASE_CHAIN = 8453;
const OP_CHAIN = 10;

const makeChainList = (): ChainListType =>
  ({
    chains: [
      {
        id: ARB_CHAIN,
        name: `Chain ${ARB_CHAIN}`,
        rpcUrls: { default: { http: [`https://rpc-${ARB_CHAIN}.example.com`] } },
        nativeCurrency: { decimals: 18, symbol: 'ETH', name: 'Ether', logo: '' },
        custom: { icon: '', knownTokens: [] },
        supports7702: true,
      },
      {
        id: BASE_CHAIN,
        name: `Chain ${BASE_CHAIN}`,
        rpcUrls: { default: { http: [`https://rpc-${BASE_CHAIN}.example.com`] } },
        nativeCurrency: { decimals: 18, symbol: 'ETH', name: 'Ether', logo: '' },
        custom: { icon: '', knownTokens: [] },
        supports7702: true,
      },
      {
        id: OP_CHAIN,
        name: `Chain ${OP_CHAIN}`,
        rpcUrls: { default: { http: [`https://rpc-${OP_CHAIN}.example.com`] } },
        nativeCurrency: { decimals: 18, symbol: 'ETH', name: 'Ether', logo: '' },
        custom: { icon: '', knownTokens: [] },
        supports7702: true,
      },
    ],
    getChainByID: vi.fn().mockImplementation((chainId: number) => ({
      id: chainId,
      name: `Chain ${chainId}`,
      rpcUrls: { default: { http: [`https://rpc-${chainId}.example.com`] } },
      nativeCurrency: { decimals: 18, symbol: 'ETH', name: 'Ether', logo: '', currencyId: CurrencyID.ETH },
      custom: { icon: '', knownTokens: [] },
      supports7702: true,
    })),
    getNativeToken: vi.fn().mockImplementation((_chainId: number) => ({
      contractAddress: EADDRESS as Hex,
      decimals: 18,
      symbol: 'ETH',
      name: 'Ether',
      currencyId: CurrencyID.ETH,
    })),
    getTokenByCurrencyId: vi.fn().mockImplementation((chainId: number, currencyId: number) => {
      if (currencyId !== CurrencyID.USDC) {
        throw new Error(`unknown currency ${currencyId}`);
      }
      return {
        contractAddress:
          chainId === OP_CHAIN
            ? '0x0b2c639c533813f4aa9d7837caf62653d097ff85'
            : USDC,
        decimals: 6,
        symbol: 'USDC',
        name: 'USD Coin',
      };
    }),
    getTokenByAddress: vi.fn().mockReturnValue(undefined),
  }) as unknown as ChainListType;

const makeMiddlewareClient = (
  overrides?: Partial<
    Parameters<typeof buildSwapPreflight>[1]['middlewareClient']
  >
): Parameters<typeof buildSwapPreflight>[1]['middlewareClient'] =>
  makeBaseMiddlewareClient({
    getSwapBalances: vi.fn().mockResolvedValue([]),
    getOraclePrices: vi.fn().mockResolvedValue([]),
    getQuote: vi.fn().mockResolvedValue({
      fulfillmentBps: 100,
      sources: [],
      destination: {
        chainId: OP_CHAIN,
        tokenAddress: USDC,
        fulfillmentFeeUsd: '1.5',
        fulfillmentFeeToken: '1500000',
      },
    }),
    ...overrides,
  });

const makeInput = (): SwapData => ({
  mode: SwapMode.EXACT_OUT,
  data: {
    toChainId: OP_CHAIN,
    toTokenAddress: WETH,
    toAmountRaw: 1000000000000000000n,
    sources: [{ chainId: BASE_CHAIN, tokenAddress: USDC }],
  },
});

const sortedBalances = [
  {
    amount: '100',
    chainID: ARB_CHAIN,
    decimals: 6,
    symbol: 'USDC',
    tokenAddress: USDC,
    value: 100,
    logo: '',
    name: 'USDC'
  },
  {
    amount: '50',
    chainID: BASE_CHAIN,
    decimals: 6,
    symbol: 'USDC',
    tokenAddress: USDC,
    value: 50,
    logo: '',
    name: 'USDC'
  },
];

describe('buildSwapPreflight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getBalancesForSwap).mockResolvedValue(sortedBalances);
  });

  it('loads oracle prices and balances in parallel before sorting balances', async () => {
    let resolveBalances: (value: unknown[]) => void;
    let resolveOraclePrices: (value: unknown[]) => void;

    const balancesPromise = new Promise<unknown[]>((resolve) => {
      resolveBalances = resolve;
    });
    const oraclePricesPromise = new Promise<unknown[]>((resolve) => {
      resolveOraclePrices = resolve;
    });

    const middlewareClient = makeMiddlewareClient({
      getSwapBalances: vi.fn().mockReturnValue(balancesPromise),
      getOraclePrices: vi.fn().mockReturnValue(oraclePricesPromise),
    });

    const preflightPromise = buildSwapPreflight(makeInput(), {
      chainList: makeChainList(),
      cotCurrencyId: CurrencyID.USDC,
      eoaAddress: '0xaaaa' as Hex,
      middlewareClient,
    });

    expect(middlewareClient.getSwapBalances).toHaveBeenCalledTimes(1);
    expect(middlewareClient.getOraclePrices).toHaveBeenCalledTimes(1);
    expect(getBalancesForSwap).not.toHaveBeenCalled();

    resolveOraclePrices!([]);
    resolveBalances!([]);

    await preflightPromise;

    expect(getBalancesForSwap).toHaveBeenCalledTimes(1);
  });

  it('reuses preloaded balances instead of refetching swap balances', async () => {
    const rawBalances = [
      {
        amount: '100',
        chainID: ARB_CHAIN,
        decimals: 6,
        symbol: 'USDC',
        tokenAddress: USDC,
        value: 100,
        logo: '',
        name: 'USDC'
      },
    ];
    const middlewareClient = makeMiddlewareClient();

    await buildSwapPreflight(makeInput(), {
      chainList: makeChainList(),
      cotCurrencyId: CurrencyID.USDC,
      eoaAddress: '0xaaaa' as Hex,
      middlewareClient,
      preloadedBalances: rawBalances,
    });

    expect(middlewareClient.getSwapBalances).not.toHaveBeenCalled();
    expect(getBalancesForSwap).toHaveBeenCalledWith({
      balances: rawBalances,
      dstChainId: OP_CHAIN,
      dstTokenAddress: WETH,
    });
  });

  it('builds wallet path hints from each chain\'s 7702 support', async () => {
    // Preflight no longer reads wallet capabilities; the hint is driven purely by
    // chainSupports7702 — 'ephemeral' for 7702 chains, 'safe' for non-7702.
    const chainList = makeChainList();

    const preflight = await buildSwapPreflight(makeInput(), {
      chainList,
      cotCurrencyId: CurrencyID.USDC,
      eoaAddress: '0xaaaa' as Hex,
      middlewareClient: makeMiddlewareClient(),
    });

    expect(preflight.walletPathHints.get(ARB_CHAIN)).toBe('ephemeral');
    expect(preflight.walletPathHints.get(BASE_CHAIN)).toBe('ephemeral');
    expect(preflight.walletPathHints.get(OP_CHAIN)).toBe('ephemeral');
  });

  it('fetches a bridge quote in preflight and returns it', async () => {
    const middlewareClient = makeMiddlewareClient();

    const preflight = await buildSwapPreflight(makeInput(), {
      chainList: makeChainList(),
      cotCurrencyId: CurrencyID.USDC,
      eoaAddress: '0xaaaa' as Hex,
      middlewareClient,
    });

    expect(middlewareClient.getQuote).toHaveBeenCalledTimes(1);
    expect((preflight as { bridgeQuoteResponse?: unknown }).bridgeQuoteResponse).toEqual(
      expect.objectContaining({
        fulfillmentBps: 100,
      })
    );
  });

  it('logs preflight start and completion', async () => {
    await buildSwapPreflight(makeInput(), {
      chainList: makeChainList(),
      cotCurrencyId: CurrencyID.USDC,
      eoaAddress: '0xaaaa' as Hex,
      middlewareClient: makeMiddlewareClient(),
    });

    expect(hoisted.debug).toHaveBeenNthCalledWith(
      1,
      'buildSwapPreflight:start',
      expect.objectContaining({
        mode: SwapMode.EXACT_OUT,
        toChainId: OP_CHAIN,
        hasPreloadedBalances: false,
      })
    );
    expect(hoisted.debug).toHaveBeenNthCalledWith(
      2,
      'buildSwapPreflight:complete',
      expect.objectContaining({
        toChainId: OP_CHAIN,
        balanceCount: sortedBalances.length,
        candidateChainIds: expect.arrayContaining([ARB_CHAIN, BASE_CHAIN, OP_CHAIN]),
      })
    );
  });

  // Bridge-quote branches (merged from the former tests/swap/preflight.test.ts). The positive
  // "fetches a bridge quote and returns it" case is covered above; these cover the null paths.
  describe('bridge quote', () => {
    it('quotes the destination token (not COT) when it is a non-COT bridgeable mesh token', async () => {
      const USDT = '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2' as Hex;
      const chainList = makeChainList();
      chainList.getTokenByAddress = vi
        .fn()
        .mockImplementation((_chainId: number, tokenAddress: Hex) =>
          tokenAddress.toLowerCase() === USDT.toLowerCase()
            ? {
                contractAddress: USDT,
                decimals: 6,
                symbol: 'USDT',
                name: 'Tether USD',
                currencyId: CurrencyID.USDT,
              }
            : undefined
        );
      const middlewareClient = makeMiddlewareClient();

      await buildSwapPreflight(
        {
          mode: SwapMode.EXACT_IN,
          data: {
            toChainId: OP_CHAIN,
            toTokenAddress: USDT,
            sources: [{ chainId: BASE_CHAIN, tokenAddress: USDT }],
          },
        },
        {
          chainList,
          cotCurrencyId: CurrencyID.USDC,
          eoaAddress: '0xaaaa' as Hex,
          middlewareClient,
        }
      );

      // The bridge fee quote must target USDT (so the same-token bridge gets correct fees),
      // not the COT (USDC).
      expect(middlewareClient.getQuote).toHaveBeenCalledWith(
        expect.objectContaining({
          destination: expect.objectContaining({ contract_address: USDT }),
        })
      );
    });
    it('quotes the native destination token when it is a non-COT bridgeable mesh token', async () => {
      const middlewareClient = makeMiddlewareClient();

      await buildSwapPreflight(
        {
          mode: SwapMode.EXACT_IN,
          data: {
            toChainId: OP_CHAIN,
            toTokenAddress: EADDRESS as Hex,
            sources: [{ chainId: BASE_CHAIN, tokenAddress: EADDRESS as Hex }],
          },
        },
        {
          chainList: makeChainList(),
          cotCurrencyId: CurrencyID.USDC,
          eoaAddress: '0xaaaa' as Hex,
          middlewareClient,
        }
      );

      // Native ETH is a mesh asset (currencyId=ETH) → quote native, not COT.
      expect(middlewareClient.getQuote).toHaveBeenCalledWith(
        expect.objectContaining({
          destination: expect.objectContaining({ contract_address: EADDRESS }),
        })
      );
    });
    it('quotes the COT (not the destination token) when EXACT_IN sources are mixed families', async () => {
      // Repro: Base ETH + OP USDC -> Arbitrum native ETH. The same-token direct bridge needs every
      // source to be the destination's family; these are mixed, so the router does the USDC COT
      // round-trip. The fee quote must therefore be denominated in the COT (USDC), not ETH — else
      // the ETH-denominated fee (18 dec) is later scaled by the COT's 6 decimals and inflates 1e12x.
      const chainList = makeChainList();
      chainList.getTokenByAddress = vi
        .fn()
        .mockImplementation((_chainId: number, tokenAddress: Hex) =>
          tokenAddress.toLowerCase() === USDC_OP.toLowerCase()
            ? {
                contractAddress: USDC_OP,
                decimals: 6,
                symbol: 'USDC',
                name: 'USD Coin',
                currencyId: CurrencyID.USDC,
              }
            : undefined
        );
      const middlewareClient = makeMiddlewareClient();

      await buildSwapPreflight(
        {
          mode: SwapMode.EXACT_IN,
          data: {
            toChainId: ARB_CHAIN,
            toTokenAddress: EADDRESS as Hex,
            sources: [
              { chainId: BASE_CHAIN, tokenAddress: EADDRESS as Hex },
              { chainId: OP_CHAIN, tokenAddress: USDC_OP },
            ],
          },
        },
        { chainList, cotCurrencyId: CurrencyID.USDC, eoaAddress: '0xaaaa' as Hex, middlewareClient }
      );

      expect(middlewareClient.getQuote).toHaveBeenCalledWith(
        expect.objectContaining({
          destination: expect.objectContaining({ contract_address: USDC }),
        })
      );
    });
    it('quotes the COT for a mesh destination when EXACT_IN has no explicit sources', async () => {
      // Source families are only known after balances load (they race the quote), so without
      // explicit sources we cannot confirm same-token bridging — default to the COT, the path the
      // router takes for anything but an all-same-family swap.
      const middlewareClient = makeMiddlewareClient();

      await buildSwapPreflight(
        {
          mode: SwapMode.EXACT_IN,
          data: { toChainId: ARB_CHAIN, toTokenAddress: EADDRESS as Hex },
        },
        {
          chainList: makeChainList(),
          cotCurrencyId: CurrencyID.USDC,
          eoaAddress: '0xaaaa' as Hex,
          middlewareClient,
        }
      );

      expect(middlewareClient.getQuote).toHaveBeenCalledWith(
        expect.objectContaining({
          destination: expect.objectContaining({ contract_address: USDC }),
        })
      );
    });
    it('quotes the COT for a mesh destination in EXACT_OUT (no same-token fast-path exists)', async () => {
      // Even with all-ETH sources, EXACT_OUT never takes the same-token direct bridge, so the
      // fee quote must be the COT.
      const middlewareClient = makeMiddlewareClient();

      await buildSwapPreflight(
        {
          mode: SwapMode.EXACT_OUT,
          data: {
            toChainId: ARB_CHAIN,
            toTokenAddress: EADDRESS as Hex,
            toAmountRaw: 1_000_000_000_000_000_000n,
            sources: [{ chainId: BASE_CHAIN, tokenAddress: EADDRESS as Hex }],
          },
        },
        {
          chainList: makeChainList(),
          cotCurrencyId: CurrencyID.USDC,
          eoaAddress: '0xaaaa' as Hex,
          middlewareClient,
        }
      );

      expect(middlewareClient.getQuote).toHaveBeenCalledWith(
        expect.objectContaining({
          destination: expect.objectContaining({ contract_address: USDC }),
        })
      );
    });
    it('returns null without calling getQuote when the destination COT is native', async () => {
      const chainList = makeChainList();
      chainList.getTokenByCurrencyId = vi.fn().mockReturnValue({
        contractAddress: EADDRESS as Hex,
        decimals: 18,
        symbol: 'ETH',
        name: 'Ether',
      });
      const middlewareClient = makeMiddlewareClient();

      const preflight = await buildSwapPreflight(makeInput(), {
        chainList,
        cotCurrencyId: CurrencyID.USDC,
        eoaAddress: '0xaaaa' as Hex,
        middlewareClient,
      });

      expect(middlewareClient.getQuote).not.toHaveBeenCalled();
      expect(preflight.bridgeQuoteResponse).toBeNull();
    });

    it('returns null without calling getQuote when the destination chain has no COT', async () => {
      const chainList = makeChainList();
      chainList.getTokenByCurrencyId = vi.fn().mockImplementation(() => {
        throw new Error('No COT with currencyId=1 on chain 10');
      });
      const middlewareClient = makeMiddlewareClient();

      const preflight = await buildSwapPreflight(makeInput(), {
        chainList,
        cotCurrencyId: CurrencyID.USDC,
        eoaAddress: '0xaaaa' as Hex,
        middlewareClient,
      });

      expect(middlewareClient.getQuote).not.toHaveBeenCalled();
      expect(preflight.bridgeQuoteResponse).toBeNull();
    });

    it('returns null when getQuote rejects', async () => {
      const middlewareClient = makeMiddlewareClient({
        getQuote: vi.fn().mockRejectedValue(new Error('bridge quote upstream down')),
      });

      const preflight = await buildSwapPreflight(makeInput(), {
        chainList: makeChainList(),
        cotCurrencyId: CurrencyID.USDC,
        eoaAddress: '0xaaaa' as Hex,
        middlewareClient,
      });

      expect(middlewareClient.getQuote).toHaveBeenCalledTimes(1);
      expect(preflight.bridgeQuoteResponse).toBeNull();
    });
  });

  it('resolves a native destination token from chain native currency without an on-chain read', async () => {
    const preflight = await buildSwapPreflight(
      {
        mode: SwapMode.EXACT_OUT,
        data: {
          toChainId: OP_CHAIN,
          toTokenAddress: EADDRESS as Hex,
          toAmountRaw: 1000000000000000000n,
          sources: [{ chainId: BASE_CHAIN, tokenAddress: USDC }],
        },
      },
      {
        chainList: makeChainList(),
        cotCurrencyId: CurrencyID.USDC,
        eoaAddress: '0xaaaa' as Hex,
        middlewareClient: makeMiddlewareClient(),
      }
    );

    expect(fetchErc20TokenMetadata).not.toHaveBeenCalled();
    expect(preflight.dstTokenInfo).toEqual({
      contractAddress: EADDRESS,
      decimals: 18,
      symbol: 'ETH',
    });
  });

  it('maps a non-7702 candidate chain to the safe wallet path', async () => {
    const chainList = makeChainList();
    const baseGetChainByID = chainList.getChainByID;
    chainList.getChainByID = vi.fn((id: number) => ({
      ...(baseGetChainByID(id) as Record<string, unknown>),
      supports7702: id !== BASE_CHAIN,
    })) as unknown as ChainListType['getChainByID'];

    const preflight = await buildSwapPreflight(makeInput(), {
      chainList,
      cotCurrencyId: CurrencyID.USDC,
      eoaAddress: '0xaaaa' as Hex,
      middlewareClient: makeMiddlewareClient(),
    });

    expect(preflight.walletPathHints.get(BASE_CHAIN)).toBe('safe');
    expect(preflight.walletPathHints.get(OP_CHAIN)).toBe('ephemeral');
    expect(preflight.walletPathHints.get(ARB_CHAIN)).toBe('ephemeral');
  });
});
