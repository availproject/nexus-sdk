import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/swap/algorithms/auto-select', () => ({
  autoSelectSources: vi.fn(),
}));
vi.mock('../../src/swap/algorithms/liquidate', () => ({
  liquidateInputHoldings: vi.fn(),
}));
vi.mock('../../src/swap/algorithms/destination', () => ({
  determineDestinationSwaps: vi.fn(),
  destinationSwapWithExactIn: vi.fn(),
}));

import type { Hex } from 'viem';
import { determineSwapRoute, type RouteOptions } from '../../src/swap/route';
import { SwapMode, type SwapData } from '../../src/swap/types';
import type { ChainListType } from '../../src/domain';
import type { OraclePriceResponse, PublicClientList } from '../../src/swap/types';
import { CurrencyID } from '../../src/swap/cot';
import type { Aggregator } from '../../src/swap/aggregators/types';
import {
  ARB_CHAIN,
  BASE_CHAIN,
  EPHEMERAL_EXECUTOR,
  USDC_ARB,
  USDC_BASE,
  WETH,
  makeDstTokenInfo,
  makePublicClientList,
  makeSwapChainList,
} from '../helpers/swap';

const aggregators: Aggregator[] = [{ supportsChain: () => true, getQuotes: vi.fn().mockResolvedValue([]) }];

const makeOptions = (overrides?: Partial<RouteOptions>): RouteOptions => ({
  aggregators,
  bridgeQuoteResponse: {
    fulfillmentBps: 0,
    sources: [
      { chainId: ARB_CHAIN, tokenAddress: USDC_ARB, depositFeeUsd: '0', depositFeeToken: '0' },
    ],
    destination: {
      chainId: BASE_CHAIN,
      tokenAddress: USDC_BASE,
      fulfillmentFeeUsd: '0',
      fulfillmentFeeToken: '0',
    },
  } as never,
  chainList: makeSwapChainList() as unknown as ChainListType,
  cotCurrencyId: CurrencyID.USDC,
  publicClientList: makePublicClientList() as unknown as PublicClientList,
  oraclePrices: [] as OraclePriceResponse,
  dstTokenInfo: makeDstTokenInfo(),
  eoaAddress: '0xaaaa' as Hex,
  ephemeralAddress: EPHEMERAL_EXECUTOR,
  balances: [],
  walletPathHints: new Map([
    [ARB_CHAIN, 'ephemeral'],
    [BASE_CHAIN, 'ephemeral'],
  ]),
  ...overrides,
});

describe('determineSwapRoute rejects non-swapSupported destination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when destination chain has swapSupported=false', async () => {
    const chainList = makeSwapChainList() as unknown as ChainListType;
    const originalGetChainByID = chainList.getChainByID;
    chainList.getChainByID = vi.fn((id: number) => {
      const chain = originalGetChainByID(id);
      if (id === ARB_CHAIN) {
        return { ...chain, swapSupported: false };
      }
      return chain;
    }) as ChainListType['getChainByID'];

    const input: SwapData = {
      mode: SwapMode.EXACT_IN,
      data: { sources: [{ chainId: BASE_CHAIN, tokenAddress: USDC_BASE, amountRaw: 1_000_000n }], toChainId: ARB_CHAIN, toTokenAddress: WETH },
    };

    await expect(determineSwapRoute(input, makeOptions({ chainList }))).rejects.toThrow(
      /does not support swap/i
    );
  });

  it('allows destination chain when swapSupported is undefined (backwards compatible)', async () => {
    // By default, makeSwapChainList chains don't set swapSupported.
    // Routing should NOT reject — only an explicit false should block.
    const input: SwapData = {
      mode: SwapMode.EXACT_IN,
      data: { sources: [{ chainId: BASE_CHAIN, tokenAddress: USDC_BASE, amountRaw: 1_000_000n }], toChainId: ARB_CHAIN, toTokenAddress: WETH },
    };

    // Should not throw the swap-support error. (Will reject for other reasons,
    // e.g. no balances; we just assert the error is NOT about swap support.)
    await expect(determineSwapRoute(input, makeOptions())).rejects.not.toThrow(
      /does not support swap/i
    );
  });
});
