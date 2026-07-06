import Decimal from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';
import type { Hex } from 'viem';
import {
  destinationGasSwapExactIn,
  determineDestinationSwaps,
  destinationSwapWithExactIn,
} from '../../../src/swap/algorithms/destination';
import type { Aggregator, Quote, QuoteRequest } from '../../../src/swap/aggregators/types';
import { QuoteType } from '../../../src/swap/aggregators/types';
import { SAFETY_MULTIPLIER } from '../../../src/swap/algorithms/convergence';
import { EADDRESS } from '../../../src/swap/constants';
import { CurrencyID } from '../../../src/swap/cot';
import { BASE_CHAIN, USDC_BASE, WETH, makeSwapChainList } from '../../helpers/swap';

const makeQuote = (
  outputAmountRaw: bigint,
  inputAmountRaw: bigint,
  inputContract = USDC_BASE as `0x${string}`,
  outputContract = WETH as `0x${string}`,
): Quote => {
  const inputIsUsdc = inputContract === USDC_BASE;
  const outputIsUsdc = outputContract === USDC_BASE;

  return {
    input: {
      contractAddress: inputContract,
      amount: new Decimal(inputAmountRaw.toString())
        .div(new Decimal(10).pow(inputIsUsdc ? 6 : 18))
        .toString(),
      amountRaw: inputAmountRaw,
      decimals: inputIsUsdc ? 6 : 18,
      value: inputIsUsdc ? Number(inputAmountRaw) / 1e6 : Number(inputAmountRaw) / 1e18,
      symbol: inputIsUsdc ? 'USDC' : 'WETH',
    },
    output: {
      contractAddress: outputContract,
      amount: new Decimal(outputAmountRaw.toString())
        .div(new Decimal(10).pow(outputIsUsdc ? 6 : 18))
        .toString(),
      amountRaw: outputAmountRaw,
      decimals: outputIsUsdc ? 6 : 18,
      value: outputIsUsdc ? Number(outputAmountRaw) / 1e6 : Number(outputAmountRaw) / 1e18,
      symbol: outputIsUsdc ? 'USDC' : 'WETH',
    },
  txData: {
    approvalAddress: '0x03' as `0x${string}`,
    tx: { to: '0x04' as `0x${string}`, data: '0x05' as `0x${string}`, value: '0x0' as `0x${string}` },
  },
  };
};

// First (uncapped) convergence step = ceil(seed × SAFETY_MULTIPLIER), mirroring convergence.ts.
// Derived from the constant so the assertion tracks it instead of pinning a magic number.
const firstConvergenceStep = (seedRaw: bigint): bigint =>
  BigInt(new Decimal(seedRaw.toString()).mul(SAFETY_MULTIPLIER).toFixed(0, Decimal.ROUND_CEIL));

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Request-aware mock: dispatches by request type/direction so tests don't depend on
// fragile call ordering between the EXACT_OUT direct attempt and the EXACT_IN
// convergence loop (which now run in parallel).
const makeRequestAwareAggregator = (
  handlers: {
    exactOutDirect?: (req: QuoteRequest) => Quote | null;
    reverseExactIn?: (req: QuoteRequest) => Quote | null;
    convergenceExactIn?: (req: QuoteRequest) => Quote | null;
  } = {}
): Aggregator => ({
  supportsChain: () => true,
  getQuotes: vi.fn(async (reqs: QuoteRequest[]) =>
    reqs.map((req) => {
      if (req.type === QuoteType.EXACT_OUT) {
        return handlers.exactOutDirect?.(req) ?? null;
      }
      // EXACT_IN: distinguish reverse (input=requirement token, output=COT) from
      // convergence (input=COT, output=requirement token).
      if (req.inputToken === USDC_BASE) {
        return handlers.convergenceExactIn?.(req) ?? null;
      }
      return handlers.reverseExactIn?.(req) ?? null;
    })
  ),
});

describe('determineDestinationSwaps', () => {
  it('returns the EXACT_OUT direct quote when it settles first', async () => {
    // Convergence quotes are delayed so the precise EXACT_OUT input deterministically
    // settles first and wins the race.
    const agg: Aggregator = {
      supportsChain: () => true,
      getQuotes: vi.fn(async (reqs: QuoteRequest[]) =>
        Promise.all(
          reqs.map(async (req) => {
            if (req.type === QuoteType.EXACT_OUT) {
              return makeQuote(1000000000000000000n, 1985000000n);
            }
            await delay(30);
            if (req.inputToken === USDC_BASE) return makeQuote(1000000000000000000n, 2050000000n);
            return makeQuote(2000000000n, 1000000000000000000n, WETH, USDC_BASE);
          })
        )
      ),
    };

    const result = await determineDestinationSwaps({
      dst: {
        chainId: BASE_CHAIN,
        token: { contractAddress: WETH, amountRaw: 1000000000000000000n },
      },
      options: {
        chainList: makeSwapChainList(),
        aggregators: [agg],
        cotCurrencyID: CurrencyID.USDC,
        userAddress: '0xexec00000000000000000000000000000000ec01' as Hex,
        recipientAddress: '0xe0a0000000000000000000000000000000000a02' as Hex,
      },
    });

    expect(result).not.toBeNull();
    expect(result!.quote.input.amountRaw).toBe(1985000000n);
    expect(result!.quote.output.amountRaw).toBe(1000000000000000000n);
  });

  it('returns the convergence quote when EXACT_OUT settles later — first success wins the race', async () => {
    // EXACT_OUT is slow; the reverse quote + first convergence attempt succeed instantly.
    // The race must NOT wait for the more precise EXACT_OUT input (1985 vs 2020 USDC).
    const agg: Aggregator = {
      supportsChain: () => true,
      getQuotes: vi.fn(async (reqs: QuoteRequest[]) =>
        Promise.all(
          reqs.map(async (req) => {
            if (req.type === QuoteType.EXACT_OUT) {
              await delay(30);
              return makeQuote(1000000000000000000n, 1985000000n);
            }
            if (req.inputToken === USDC_BASE) return makeQuote(1000000000000000000n, 2020000000n);
            return makeQuote(2000000000n, 1000000000000000000n, WETH, USDC_BASE);
          })
        )
      ),
    };

    const result = await determineDestinationSwaps({
      dst: {
        chainId: BASE_CHAIN,
        token: { contractAddress: WETH, amountRaw: 1000000000000000000n },
      },
      options: {
        chainList: makeSwapChainList(),
        aggregators: [agg],
        cotCurrencyID: CurrencyID.USDC,
        userAddress: '0xexec00000000000000000000000000000000ec01' as Hex,
        recipientAddress: '0xe0a0000000000000000000000000000000000a02' as Hex,
      },
    });

    expect(result).not.toBeNull();
    expect(result!.quote.input.amountRaw).toBe(2020000000n);
  });

  it('falls back to convergence when EXACT_OUT direct is unsupported', async () => {
    const agg = makeRequestAwareAggregator({
      exactOutDirect: () => null,
      reverseExactIn: () => makeQuote(2000000000n, 1000000000000000000n, WETH, USDC_BASE),
      convergenceExactIn: () => makeQuote(1000000000000000000n, 2020000000n),
    });

    const result = await determineDestinationSwaps({
      dst: {
        chainId: BASE_CHAIN,
        token: { contractAddress: WETH, amountRaw: 1000000000000000000n },
      },
      options: {
        chainList: makeSwapChainList(),
        aggregators: [agg],
        cotCurrencyID: CurrencyID.USDC,
        userAddress: '0xexec00000000000000000000000000000000ec01' as Hex,
        recipientAddress: '0xe0a0000000000000000000000000000000000a02' as Hex,
      },
    });

    expect(result).not.toBeNull();
    expect(result!.quote.input.amountRaw).toBe(2020000000n);
  });

  it('stops convergence input growth at the per-COT USD cap (initial + 0.5 USDC)', async () => {
    // Reverse quote suggests 1000 USDC needed for 1e18 WETH. With 1% safety the
    // first attempt requests ~1.01 USDC over the estimate; the cap is 0.5 USDC
    // above the initial estimate, so attempts must never request more than
    // 1000.5 USDC of input regardless of how stubbornly the convergence under-delivers.
    const requestedInputs: bigint[] = [];
    const agg = makeRequestAwareAggregator({
      exactOutDirect: () => null,
      reverseExactIn: () => makeQuote(1000000000n, 1000000000000000000n, WETH, USDC_BASE),
      convergenceExactIn: (req) => {
        if (req.type !== QuoteType.EXACT_IN) return null;
        requestedInputs.push(req.inputAmount);
        // Always under-deliver so convergence keeps retrying until capped.
        return makeQuote(900000000000000000n, req.inputAmount);
      },
    });

    const result = await determineDestinationSwaps({
      dst: {
        chainId: BASE_CHAIN,
        token: { contractAddress: WETH, amountRaw: 1000000000000000000n },
      },
      options: {
        chainList: makeSwapChainList(),
        aggregators: [agg],
        cotCurrencyID: CurrencyID.USDC,
        userAddress: '0xexec00000000000000000000000000000000ec01' as Hex,
        recipientAddress: '0xe0a0000000000000000000000000000000000a02' as Hex,
      },
    });

    expect(result).toBeNull();
    expect(requestedInputs.length).toBeGreaterThan(0);
    // Initial estimate 1000 USDC + 0.5 USDC cap = 1_000_500_000 raw maximum.
    const maxAllowed = 1_000_500_000n;
    for (const input of requestedInputs) {
      expect(input).toBeLessThanOrEqual(maxAllowed);
    }
  });

  it('finds COT input for exact output requirement via convergence', async () => {
    // Convergence-only path (EXACT_OUT direct not supported by aggregator):
    // Indicative reverse quote: 1e18 WETH → 2000e6 USDC.
    // Serious convergence quote: 2020e6 USDC → 1e18 WETH (with 1% safety multiplier).
    const agg = makeRequestAwareAggregator({
      exactOutDirect: () => null,
      reverseExactIn: () => makeQuote(2000000000n, 1000000000000000000n, WETH, USDC_BASE),
      convergenceExactIn: () => makeQuote(1000000000000000000n, 2020000000n),
    });

    const result = await determineDestinationSwaps({
      dst: {
        chainId: BASE_CHAIN,
        token: {
          contractAddress: WETH,
          amountRaw: 1000000000000000000n,
        },
      },
      options: {
        chainList: makeSwapChainList(),
        aggregators: [agg],
        cotCurrencyID: CurrencyID.USDC,
        userAddress: '0xexec00000000000000000000000000000000ec01' as Hex,
        recipientAddress: '0xe0a0000000000000000000000000000000000a02' as Hex,
      },
    });

    expect(result).not.toBeNull();
    expect(result!.quote.output.amountRaw).toBe(1000000000000000000n);
  });

  it('sends destination swap output to the EOA receiver, distinct from the taker', async () => {
    const taker = '0xexec00000000000000000000000000000000ec01' as Hex;
    const eoa = '0xe0a0000000000000000000000000000000000a02' as Hex;
    const agg = makeRequestAwareAggregator({
      exactOutDirect: () => makeQuote(1000000000000000000n, 1985000000n),
      reverseExactIn: () => makeQuote(2000000000n, 1000000000000000000n, WETH, USDC_BASE),
      convergenceExactIn: () => makeQuote(1000000000000000000n, 2020000000n),
    });

    await determineDestinationSwaps({
      dst: {
        chainId: BASE_CHAIN,
        token: { contractAddress: WETH, amountRaw: 1000000000000000000n },
      },
      options: {
        chainList: makeSwapChainList(),
        aggregators: [agg],
        cotCurrencyID: CurrencyID.USDC,
        userAddress: taker,
        recipientAddress: eoa,
      },
    });

    const requests = (agg.getQuotes as ReturnType<typeof vi.fn>).mock.calls.flatMap((c) => c[0]);
    expect(requests.length).toBeGreaterThan(0);
    for (const r of requests) {
      expect(r.userAddress).toBe(taker);
      expect(r.recipientAddress).toBe(eoa);
    }
  });

  it('returns null when destination token IS COT (no swap needed)', async () => {
    const agg: Aggregator = { supportsChain: () => true, getQuotes: vi.fn() };

    const result = await determineDestinationSwaps({
      dst: {
        chainId: BASE_CHAIN,
        token: {
          contractAddress: USDC_BASE,
          amountRaw: 5000000n,
        },
      },
      options: {
        chainList: makeSwapChainList(),
        aggregators: [agg],
        cotCurrencyID: CurrencyID.USDC,
        userAddress: '0xexec00000000000000000000000000000000ec01' as Hex,
        recipientAddress: '0xe0a0000000000000000000000000000000000a02' as Hex,
      },
    });

    expect(result).toBeNull();
    expect(agg.getQuotes).not.toHaveBeenCalled();
  });

  it('returns null when no aggregator can provide quotes', async () => {
    const agg: Aggregator = {
      supportsChain: () => true,
      getQuotes: vi.fn().mockResolvedValue([null]),
    };

    const result = await determineDestinationSwaps({
      dst: {
        chainId: BASE_CHAIN,
        token: {
          contractAddress: WETH,
          amountRaw: 1000000000000000000n,
        },
      },
      options: {
        chainList: makeSwapChainList(),
        aggregators: [agg],
        cotCurrencyID: CurrencyID.USDC,
        userAddress: '0xexec00000000000000000000000000000000ec01' as Hex,
        recipientAddress: '0xe0a0000000000000000000000000000000000a02' as Hex,
      },
    });

    expect(result).toBeNull();
  });

  it('rounds estimated COT input up via mulDecimals semantics', async () => {
    // The first convergence iteration asks for ceil(reverseSeed × SAFETY_MULTIPLIER) raw USDC.
    const convergenceRequests: bigint[] = [];
    const agg = makeRequestAwareAggregator({
      exactOutDirect: () => null,
      reverseExactIn: () => makeQuote(1000001n, 1000000000000000000n, WETH, USDC_BASE),
      convergenceExactIn: (req) => {
        if (req.type !== QuoteType.EXACT_IN) return null;
        convergenceRequests.push(req.inputAmount);
        return makeQuote(1000000000000000000n, req.inputAmount);
      },
    });

    const result = await determineDestinationSwaps({
      dst: {
        chainId: BASE_CHAIN,
        token: {
          contractAddress: WETH,
          amountRaw: 1000000000000000000n,
        },
      },
      options: {
        chainList: makeSwapChainList(),
        aggregators: [agg],
        cotCurrencyID: CurrencyID.USDC,
        userAddress: '0xexec00000000000000000000000000000000ec01' as Hex,
        recipientAddress: '0xe0a0000000000000000000000000000000000a02' as Hex,
      },
    });

    expect(result).not.toBeNull();
    expect(convergenceRequests[0]).toBe(firstConvergenceStep(1000001n));
  });
});

describe('destinationSwapWithExactIn', () => {
  it('returns single EXACT_IN quote: COT → output token', async () => {
    const agg: Aggregator = {
      supportsChain: () => true,
      getQuotes: vi.fn().mockResolvedValue([makeQuote(500000000000000000n, 1000000000n)]),
    };

    const result = await destinationSwapWithExactIn({
      chainId: BASE_CHAIN,
      outputToken: WETH,
      input: {
        amountRaw: 1000000000n,
        tokenAddress: USDC_BASE,
      },
      options: {
        aggregators: [agg],
        userAddress: '0xaaaa000000000000000000000000000000000001' as Hex,
        recipientAddress: '0xe0a0000000000000000000000000000000000a02' as Hex,
        chainList: makeSwapChainList(),
      },
    });

    expect(result).not.toBeNull();
    expect(result!.quote.output.amountRaw).toBe(500000000000000000n);
    expect(result!.chainID).toBe(BASE_CHAIN);
  });

  it('returns null when quote fails', async () => {
    const agg: Aggregator = {
      supportsChain: () => true,
      getQuotes: vi.fn().mockResolvedValue([null]),
    };

    const result = await destinationSwapWithExactIn({
      chainId: BASE_CHAIN,
      outputToken: WETH,
      input: {
        amountRaw: 1000000000n,
        tokenAddress: USDC_BASE,
      },
      options: {
        aggregators: [agg],
        userAddress: '0xaaaa000000000000000000000000000000000001' as Hex,
        recipientAddress: '0xe0a0000000000000000000000000000000000a02' as Hex,
        chainList: makeSwapChainList(),
      },
    });

    expect(result).toBeNull();
  });
});

describe('destinationGasSwapExactIn', () => {
  it('quotes COT → EADDRESS using the dst-chain COT address as input', async () => {
    // 1 USDC -> 0.0005 ETH at $2000/ETH
    const agg: Aggregator = {
      supportsChain: () => true,
      getQuotes: vi.fn().mockResolvedValue([
        {
          input: {
            contractAddress: USDC_BASE,
            amount: '1',
            amountRaw: 1_000_000n,
            decimals: 6,
            value: 1,
            symbol: 'USDC',
          },
          output: {
            contractAddress: EADDRESS,
            amount: '0.0005',
            amountRaw: 500_000_000_000_000n,
            decimals: 18,
            value: 1,
            symbol: 'ETH',
          },
          txData: {
            approvalAddress: '0x03' as Hex,
            tx: { to: '0x04' as Hex, data: '0x05' as Hex, value: '0x0' as Hex },
          },
        },
      ]),
    };

    const result = await destinationGasSwapExactIn({
      chainId: BASE_CHAIN,
      gasAmountInCotRaw: 1_000_000n,
      options: {
        aggregators: [agg],
        userAddress: '0xaaaa000000000000000000000000000000000001' as Hex,
        recipientAddress: '0xe0a0000000000000000000000000000000000a02' as Hex,
        chainList: makeSwapChainList(),
        cotCurrencyID: CurrencyID.USDC,
      },
    });

    expect(result).not.toBeNull();
    expect(result!.quote.output.contractAddress).toBe(EADDRESS);
    expect(result!.quote.output.amountRaw).toBe(500_000_000_000_000n);
    expect(result!.chainID).toBe(BASE_CHAIN);

    const requests = (agg.getQuotes as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(requests).toHaveLength(1);
    expect(requests[0].inputToken).toBe(USDC_BASE);
    expect(requests[0].outputToken).toBe(EADDRESS);
    expect(requests[0].type).toBe(QuoteType.EXACT_IN);
    expect(requests[0].inputAmount).toBe(1_000_000n);
  });

  it('returns null when no aggregator can quote', async () => {
    const agg: Aggregator = {
      supportsChain: () => true,
      getQuotes: vi.fn().mockResolvedValue([null]),
    };

    const result = await destinationGasSwapExactIn({
      chainId: BASE_CHAIN,
      gasAmountInCotRaw: 1_000_000n,
      options: {
        aggregators: [agg],
        userAddress: '0xaaaa000000000000000000000000000000000001' as Hex,
        recipientAddress: '0xe0a0000000000000000000000000000000000a02' as Hex,
        chainList: makeSwapChainList(),
        cotCurrencyID: CurrencyID.USDC,
      },
    });

    expect(result).toBeNull();
  });
});
