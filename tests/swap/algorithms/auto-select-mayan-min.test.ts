import Decimal from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';
import type { Hex } from 'viem';
import { quoteFixture } from '../../helpers/quote';
import { autoSelectSources, type SourceHolding } from '../../../src/swap/algorithms/auto-select';
import type {
  Aggregator,
  Quote,
  QuoteRequest,
} from '../../../src/swap/aggregators/types';
import { QuoteSeriousness, QuoteType } from '../../../src/swap/aggregators/types';
import { CurrencyID } from '../../../src/swap/cot';
import {
  ARB_CHAIN,
  BASE_CHAIN,
  OP_CHAIN,
  USDC_ARB,
  USDC_BASE,
  USDC_OP,
  WETH,
  makeSwapChainList,
} from '../../helpers/swap';

const EOA = '0xaaaa000000000000000000000000000000000001' as Hex;

const makeHolding = (
  chainID: number,
  tokenAddress: Hex,
  amountRaw: bigint,
  value: number
): SourceHolding => ({
  chainID,
  tokenAddress,
  amountRaw,
  decimals: 6,
  symbol: 'USDC',
  value,
});

const baseInput = () => {
  const chainList = makeSwapChainList();
  const addressByChain = new Map<number, Hex>([
    [ARB_CHAIN, EOA],
    [BASE_CHAIN, EOA],
    [OP_CHAIN, EOA],
  ]);
  return {
    aggregators: [],
    chainList,
    cotCurrencyId: CurrencyID.USDC,
    userAddressByChain: addressByChain,
    recipientAddressByChain: addressByChain,
  };
};

describe('autoSelectSources — Mayan per-source USD minimum', () => {
  it('uses all chains when every chain is above the minimum', async () => {
    const holdings = [
      makeHolding(ARB_CHAIN, USDC_ARB, 5_000_000n, 5), // $5
      makeHolding(BASE_CHAIN, USDC_BASE, 4_000_000n, 4), // $4
    ];

    const result = await autoSelectSources({
      ...baseInput(),
      holdings,
      outputRequired: new Decimal(6),
      minOutputUsdPerSource: new Decimal(1.1),
    });

    const chainsUsed = new Set(result.usedCOTs.map((entry) => entry.holding.chainID));
    expect(chainsUsed.has(ARB_CHAIN)).toBe(true);
    expect(chainsUsed.has(BASE_CHAIN)).toBe(true);
  });

  it('excludes a chain whose aggregate USD value is below the minimum, even when its holding would otherwise be needed', async () => {
    // ARB alone ($1.50) does not cover the requested $1.80. Without the filter the algorithm
    // would also pick BASE ($0.50) and the requirement is met. With the filter, BASE is dropped
    // and the algorithm cannot cover — should throw rather than silently under-deliver.
    const holdings = [
      makeHolding(ARB_CHAIN, USDC_ARB, 1_500_000n, 1.5), // $1.50 — eligible
      makeHolding(BASE_CHAIN, USDC_BASE, 500_000n, 0.5), // $0.50 — below 1.10
    ];

    await expect(
      autoSelectSources({
        ...baseInput(),
        holdings,
        outputRequired: new Decimal(1.8),
        minOutputUsdPerSource: new Decimal(1.1),
      })
    ).rejects.toThrow(/mayan/i);
  });

  it('uses only eligible chains when the target fits within them', async () => {
    const holdings = [
      makeHolding(ARB_CHAIN, USDC_ARB, 5_000_000n, 5), // $5 — eligible
      makeHolding(BASE_CHAIN, USDC_BASE, 500_000n, 0.5), // $0.50 — below min
    ];

    const result = await autoSelectSources({
      ...baseInput(),
      holdings,
      outputRequired: new Decimal(3),
      minOutputUsdPerSource: new Decimal(1.1),
    });

    const chainsUsed = new Set(result.usedCOTs.map((entry) => entry.holding.chainID));
    expect(chainsUsed.has(ARB_CHAIN)).toBe(true);
    expect(chainsUsed.has(BASE_CHAIN)).toBe(false);
  });

  it('combines multiple sub-minimum holdings on the same chain when their sum clears the minimum', async () => {
    // Same chain, two small holdings; their sum ($1.30) clears $1.10 so the chain stays.
    const holdings = [
      makeHolding(ARB_CHAIN, USDC_ARB, 800_000n, 0.8), // $0.80
      makeHolding(ARB_CHAIN, USDC_ARB, 500_000n, 0.5), // $0.50
    ];

    const result = await autoSelectSources({
      ...baseInput(),
      holdings,
      outputRequired: new Decimal(1),
      minOutputUsdPerSource: new Decimal(1.1),
    });

    expect(result.usedCOTs.length).toBeGreaterThan(0);
    expect(result.usedCOTs.every((entry) => entry.holding.chainID === ARB_CHAIN)).toBe(true);
  });

  it('throws naming the dropped chains when the eligible set cannot cover the requirement', async () => {
    const holdings = [
      makeHolding(BASE_CHAIN, USDC_BASE, 500_000n, 0.5), // $0.50 — dropped
      makeHolding(OP_CHAIN, USDC_OP, 700_000n, 0.7), // $0.70 — dropped
      makeHolding(ARB_CHAIN, USDC_ARB, 2_000_000n, 2), // $2 — eligible but not enough alone
    ];

    await expect(
      autoSelectSources({
        ...baseInput(),
        holdings,
        outputRequired: new Decimal(10),
        minOutputUsdPerSource: new Decimal(1.1),
      })
    ).rejects.toThrow(/mayan/i);
  });

  it('preserves existing behavior when no minimum is provided', async () => {
    // Small chain stays usable when the min is not set.
    const holdings = [
      makeHolding(BASE_CHAIN, USDC_BASE, 500_000n, 0.5), // $0.50
      makeHolding(ARB_CHAIN, USDC_ARB, 5_000_000n, 5),
    ];

    const result = await autoSelectSources({
      ...baseInput(),
      holdings,
      outputRequired: new Decimal(5.4),
    });

    const chainsUsed = new Set(result.usedCOTs.map((entry) => entry.holding.chainID));
    expect(chainsUsed.has(BASE_CHAIN)).toBe(true);
  });

  it('lifts the convergence target to the per-leg minimum so partial fills never produce a sub-$1.10 leg', async () => {
    // ARB USDC ($5) fully covers the easy chunk; BASE WETH only needs to top up
    // $0.30. Without the floor, convergence would target a $0.30 BASE output and
    // Mayan would reject the quote. With the floor, convergence targets ≥ $1.10.
    const wethHolding: SourceHolding = {
      chainID: BASE_CHAIN,
      tokenAddress: WETH,
      amountRaw: 1_000_000_000_000_000_000n, // 1 WETH
      decimals: 18,
      symbol: 'WETH',
      value: 5,
    };
    const usdcArb = makeHolding(ARB_CHAIN, USDC_ARB, 5_000_000n, 5);

    // 1 WETH = 5 USDC linear rate. Aggregator always returns this rate.
    const wethToUsdcRate = new Decimal(5);
    const makeQuote = (inputAmountRaw: bigint, inputDecimals: number): Quote => {
      const inputHuman = new Decimal(inputAmountRaw.toString()).div(
        new Decimal(10).pow(inputDecimals)
      );
      const outputHuman = inputHuman.mul(wethToUsdcRate);
      const outputAmountRaw = BigInt(outputHuman.mul(new Decimal(10).pow(6)).toFixed(0, 1));
      return quoteFixture({
        input: {
          contractAddress: WETH,
          amount: inputHuman.toString(),
          amountRaw: inputAmountRaw,
          decimals: inputDecimals,
          value: Number(inputHuman.mul(wethToUsdcRate)),
          symbol: 'WETH',
        },
        output: {
          contractAddress: USDC_BASE,
          amount: outputHuman.toString(),
          amountRaw: outputAmountRaw,
          decimals: 6,
          value: Number(outputHuman),
          symbol: 'USDC',
        },
        txData: {
          approvalAddress: '0x0000000000000000000000000000000000000001' as Hex,
          tx: {
            to: '0x0000000000000000000000000000000000000002' as Hex,
            data: '0x' as Hex,
            value: '0x0' as Hex,
          },
        },
      });
    };
    const seriousInputs: bigint[] = [];
    const aggregator: Aggregator = {
      supportsChain: () => true,
      getQuotes: vi.fn(async (requests: QuoteRequest[]) =>
        requests.map((req) => {
          if (req.type !== QuoteType.EXACT_IN) return null;
          if (req.seriousness === QuoteSeriousness.SERIOUS) {
            seriousInputs.push(req.inputAmount);
          }
          return makeQuote(req.inputAmount, 18);
        })
      ),
    };

    await autoSelectSources({
      ...baseInput(),
      aggregators: [aggregator],
      holdings: [usdcArb, wethHolding],
      outputRequired: new Decimal(5.3),
      minOutputUsdPerSource: new Decimal(1.1),
    });

    // At least one serious (convergence) quote was issued.
    expect(seriousInputs.length).toBeGreaterThan(0);

    // The first convergence request must have asked for at least ~$1.10 worth
    // of WETH input (== 0.22 WETH at our 1:5 rate). Without the fix the target
    // would be ~$0.30 (0.06 WETH).
    const firstInputWeth = new Decimal(seriousInputs[0]!.toString()).div(
      new Decimal(10).pow(18)
    );
    const firstInputUsdc = firstInputWeth.mul(wethToUsdcRate);
    expect(firstInputUsdc.gte(new Decimal(1.1))).toBe(true);
  });
});
