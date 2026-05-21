// Regression coverage for the EXACT_OUT destination requote budget guard.
//
// Setup: user wants `toAmount` of a non-COT token on Arbitrum. Source funds on Base.
// The route's getDstSwap closure (route.ts, _exactOutRoute) is the only place that
// enforces a budget on dst-input growth across requotes. The bridge funds `originalMax`
// (= initial inputMin + dstBuffer of min(10%, $2)) worth of COT at the destination
// wrapper; on a requote the new inputMin must fit inside that budget, leftover gets
// swept. The dst buffer is NOT re-added to newInputMin on the requote check — doing so
// would double-count it and reject requotes that actually fit.

import {
  type Aggregator,
  OmniversalChainID,
  type QuoteResponse,
  Universe,
} from '@avail-project/ca-common';
import Decimal from 'decimal.js';
import { type Hex, toHex } from 'viem';
import { describe, expect, it, vi } from 'vitest';

const getDestinationExactOutSwapMock = vi.hoisted(() => vi.fn());

vi.mock('@avail-project/ca-common', async () => {
  const actual = await vi.importActual<typeof import('@avail-project/ca-common')>(
    '@avail-project/ca-common'
  );
  return {
    ...actual,
    getDestinationExactOutSwap: getDestinationExactOutSwapMock,
  };
});

import { SUPPORTED_CHAINS } from '../../src/commons';
import {
  exactOutInput,
  makeBalance,
  makeOraclePrice,
  runDetermineSwapRoute,
} from '../helpers/swap-route-fixtures';

const USDC_BASE: Hex = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const USDC_ARBITRUM: Hex = '0xaf88d065e77c8cc2239327c5edb3a432268e5831';
const NONCOT_BASE: Hex = '0xeeee0000000000000000000000000000babe0001';
const NONCOT_ARBITRUM: Hex = '0xeeee00000000000000000000000000000abb0001';

const oraclePrices = [
  makeOraclePrice(SUPPORTED_CHAINS.BASE, USDC_BASE),
  makeOraclePrice(SUPPORTED_CHAINS.BASE, NONCOT_BASE),
  makeOraclePrice(SUPPORTED_CHAINS.ARBITRUM, USDC_ARBITRUM),
  makeOraclePrice(SUPPORTED_CHAINS.ARBITRUM, NONCOT_ARBITRUM),
];

// Build a fake aggregator that won't be used for the dst quote (mocked above) but is
// still required as a value by the route + source-side calls.
const stubAggregator: Aggregator = {
  getQuotes: async (requests) =>
    requests.map((r) => {
      const inputRaw = r.type === 0 ? r.inputAmount : r.outputAmount;
      const amountStr = new Decimal(inputRaw.toString()).div(Decimal.pow(10, 6)).toFixed(6);
      return {
        expiry: Math.floor(Date.now() / 1000) + 600,
        input: {
          contractAddress: '0x0000000000000000000000000000000000000001' as Hex,
          amount: amountStr,
          amountRaw: inputRaw,
          decimals: 6,
          value: Number(amountStr),
          symbol: 'TST',
        },
        output: {
          contractAddress: '0x0000000000000000000000000000000000000002' as Hex,
          amount: amountStr,
          amountRaw: inputRaw,
          decimals: 6,
          value: Number(amountStr),
          symbol: 'TST',
        },
        txData: {
          approvalAddress: '0x0000000000000000000000000000000000000003' as Hex,
          tx: {
            to: '0x0000000000000000000000000000000000000004' as Hex,
            data: '0x' as Hex,
            value: '0x0' as Hex,
          },
        },
      };
    }),
};

// Build a dst-side QuoteResponse with a given USDC input amount (raw) and the original
// requirement as output. The rest of the fields are stubs — only quote.input.amount and
// quote.output.amountRaw matter to the buffer-guard logic in _exactOutRoute.
const makeDstQuoteResponse = (inputUSDCRaw: bigint, outputDstTokenRaw: bigint): QuoteResponse => {
  const inputStr = new Decimal(inputUSDCRaw.toString()).div(Decimal.pow(10, 6)).toFixed(6);
  const outputStr = new Decimal(outputDstTokenRaw.toString()).div(Decimal.pow(10, 6)).toFixed(6);
  const tokenAddress32 = (hex: Hex) =>
    toHex(Buffer.concat([Buffer.alloc(12, 0), Buffer.from(hex.slice(2), 'hex')]));
  return {
    chainID: SUPPORTED_CHAINS.ARBITRUM,
    aggregator: stubAggregator,
    holding: {
      amountRaw: outputDstTokenRaw,
      chainID: new OmniversalChainID(Universe.ETHEREUM, SUPPORTED_CHAINS.ARBITRUM),
      tokenAddress: tokenAddress32(NONCOT_ARBITRUM),
    } as never,
    quote: {
      expiry: Math.floor(Date.now() / 1000) + 600,
      input: {
        contractAddress: USDC_ARBITRUM,
        amount: inputStr,
        amountRaw: inputUSDCRaw,
        decimals: 6,
        value: Number(inputStr),
        symbol: 'USDC',
      },
      output: {
        contractAddress: NONCOT_ARBITRUM,
        amount: outputStr,
        amountRaw: outputDstTokenRaw,
        decimals: 6,
        value: Number(outputStr),
        symbol: 'TST',
      },
      txData: {
        approvalAddress: '0x0000000000000000000000000000000000000003' as Hex,
        tx: {
          to: '0x0000000000000000000000000000000000000004' as Hex,
          data: '0x' as Hex,
          value: '0x0' as Hex,
        },
      },
    } as never,
  };
};

describe('EXACT_OUT destination requote (buffer headroom)', () => {
  it('accepts requote when newInputMin fits within originalMax (leftover swept)', async () => {
    // toAmount = 50 NONCOT_ARBITRUM (50_000_000n raw at 6 decimals).
    //
    // First dst quote: input = 50 USDC, output = 50 NONCOT.
    //   inputMin = 50, dstBuffer = min(10%·50, $2) = $2, max = 52. originalMax = 52.
    //   Bridge brings 52 USDC to dst wrapper.
    //
    // Requote: input = 51 USDC (51 < 52 — fits inside the bridged budget).
    //   Swap consumes 51 of the 52 bridged COT. Leftover 1 USDC swept to EOA by the
    //   destination sweeper. inputAmount.max stays pinned at originalMax (the bridge
    //   budget — it does not get re-bumped on requote).
    getDestinationExactOutSwapMock
      .mockResolvedValueOnce(makeDstQuoteResponse(50_000_000n, 50_000_000n))
      .mockResolvedValueOnce(makeDstQuoteResponse(51_000_000n, 50_000_000n));

    const { route } = await runDetermineSwapRoute({
      input: exactOutInput({
        fromSources: [{ chainId: SUPPORTED_CHAINS.BASE, tokenAddress: NONCOT_BASE }],
        toChainId: SUPPORTED_CHAINS.ARBITRUM,
        toTokenAddress: NONCOT_ARBITRUM,
        toAmount: 50_000_000n,
      }),
      preloadedBalances: [makeBalance(SUPPORTED_CHAINS.BASE, NONCOT_BASE, '500')],
      oraclePrices,
    });

    // After first dst quote, originalMax = inputMin (50) + buffer (2) = 52.
    expect(route.destination.inputAmount.max.toFixed()).toBe('52');
    expect(route.destination.inputAmount.min.toFixed()).toBe('50');

    const result = await route.destination.getDstSwap();
    expect(result).not.toBeNull();
    expect(result!.tokenSwap?.quote.input.amountRaw).toBe(51_000_000n);

    // inputAmount.max stays pinned at originalMax (52) — the bridge funded that, and
    // re-bumping it on requote would be meaningless (the bridge already happened).
    expect(route.destination.inputAmount.max.toFixed()).toBe('52');
    // inputAmount.min reflects the latest quote's actual COT requirement.
    expect(route.destination.inputAmount.min.toFixed()).toBe('51');
  });

  it('rejects requote when newInputMin exceeds originalMax (bridge budget genuinely insufficient)', async () => {
    // First quote: input = 50 USDC → originalMax = 52.
    // Requote: input = 60 USDC. 60 > 52 — bridge funded only 52 of COT, swap genuinely
    // can't be paid for. Must throw.
    getDestinationExactOutSwapMock
      .mockResolvedValueOnce(makeDstQuoteResponse(50_000_000n, 50_000_000n))
      .mockResolvedValueOnce(makeDstQuoteResponse(60_000_000n, 50_000_000n));

    const { route } = await runDetermineSwapRoute({
      input: exactOutInput({
        fromSources: [{ chainId: SUPPORTED_CHAINS.BASE, tokenAddress: NONCOT_BASE }],
        toChainId: SUPPORTED_CHAINS.ARBITRUM,
        toTokenAddress: NONCOT_ARBITRUM,
        toAmount: 50_000_000n,
      }),
      preloadedBalances: [makeBalance(SUPPORTED_CHAINS.BASE, NONCOT_BASE, '500')],
      oraclePrices,
    });

    expect(route.destination.inputAmount.max.toFixed()).toBe('52');

    await expect(route.destination.getDstSwap()).rejects.toThrow(
      /ratesChangedBeyondTolerance|max budget/
    );
  });

  it('accepts requote at the originalMax boundary (newInputMin == originalMax)', async () => {
    // First: input = 50 → originalMax = 52.
    // Requote: input = 52 (exactly equals originalMax). Should pass — bridge has 52,
    // swap consumes all 52, no leftover but also no shortfall.
    getDestinationExactOutSwapMock
      .mockResolvedValueOnce(makeDstQuoteResponse(50_000_000n, 50_000_000n))
      .mockResolvedValueOnce(makeDstQuoteResponse(52_000_000n, 50_000_000n));

    const { route } = await runDetermineSwapRoute({
      input: exactOutInput({
        fromSources: [{ chainId: SUPPORTED_CHAINS.BASE, tokenAddress: NONCOT_BASE }],
        toChainId: SUPPORTED_CHAINS.ARBITRUM,
        toTokenAddress: NONCOT_ARBITRUM,
        toAmount: 50_000_000n,
      }),
      preloadedBalances: [makeBalance(SUPPORTED_CHAINS.BASE, NONCOT_BASE, '500')],
      oraclePrices,
    });

    expect(route.destination.inputAmount.max.toFixed()).toBe('52');

    const result = await route.destination.getDstSwap();
    expect(result).not.toBeNull();
    expect(result!.tokenSwap?.quote.input.amountRaw).toBe(52_000_000n);
    expect(route.destination.inputAmount.max.toFixed()).toBe('52');
  });
});
