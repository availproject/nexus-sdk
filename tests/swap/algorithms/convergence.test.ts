import Decimal from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';
import type { Hex } from 'viem';
import {
  convergeExactIn,
  firstSuccess,
  SAFETY_MULTIPLIER,
} from '../../../src/swap/algorithms/convergence';
import type { Aggregator, Quote, QuoteRequest } from '../../../src/swap/aggregators';
import { QuoteSeriousness, QuoteType } from '../../../src/swap/aggregators';
import { quoteFixture } from '../../helpers/quote';

const later = <T>(ms: number, value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));
const rejectLater = (ms: number): Promise<never> =>
  new Promise((_, reject) => setTimeout(() => reject(new Error('boom')), ms));

describe('firstSuccess', () => {
  it('resolves with the first candidate to settle non-null, regardless of array order', async () => {
    await expect(firstSuccess([later(50, 'slow'), Promise.resolve('fast')])).resolves.toBe('fast');
  });

  it('does not wait for a slow losing candidate', async () => {
    const start = Date.now();
    await firstSuccess([later(1000, 'slow'), Promise.resolve('fast')]);
    expect(Date.now() - start).toBeLessThan(500);
  });

  it('waits past an early null for a later non-null', async () => {
    await expect(firstSuccess([Promise.resolve(null), later(10, 'value')])).resolves.toBe('value');
  });

  it('resolves null when every candidate settles null', async () => {
    await expect(firstSuccess([Promise.resolve(null), later(10, null)])).resolves.toBeNull();
  });

  it('treats a rejection as null and keeps waiting for the other candidate', async () => {
    await expect(firstSuccess([rejectLater(5), later(20, 'value')])).resolves.toBe('value');
  });

  it('resolves null when every candidate rejects', async () => {
    await expect(firstSuccess([rejectLater(5), rejectLater(10)])).resolves.toBeNull();
  });

  it('resolves null for an empty candidate list', async () => {
    await expect(firstSuccess([])).resolves.toBeNull();
  });
});

const TOKEN_IN = '0x1111111111111111111111111111111111111111' as Hex;
const TOKEN_OUT = '0x2222222222222222222222222222222222222222' as Hex;
const USER = '0x3333333333333333333333333333333333333333' as Hex;

const makeQuote = (inputAmountRaw: bigint, outputAmountRaw: bigint): Quote => quoteFixture({
  input: {
    contractAddress: TOKEN_IN,
    amount: inputAmountRaw.toString(),
    amountRaw: inputAmountRaw,
    decimals: 0,
    value: Number(inputAmountRaw),
    symbol: 'IN',
  },
  output: {
    contractAddress: TOKEN_OUT,
    amount: outputAmountRaw.toString(),
    amountRaw: outputAmountRaw,
    decimals: 0,
    value: Number(outputAmountRaw),
    symbol: 'OUT',
  },
  txData: {
    approvalAddress: '0x4444444444444444444444444444444444444444',
    tx: {
      to: '0x5555555555555555555555555555555555555555',
      data: '0x',
      value: '0x0',
    },
  },
});

const makeRequest = (inputAmount: bigint): QuoteRequest & { type: QuoteType.EXACT_IN } => ({
  userAddress: USER,
  recipientAddress: USER,
  chainId: 1,
  inputToken: TOKEN_IN,
  outputToken: TOKEN_OUT,
  seriousness: QuoteSeriousness.SERIOUS,
  type: QuoteType.EXACT_IN,
  inputAmount,
});

describe('convergeExactIn', () => {
  it('jumps by the observed under-delivery ratio before applying the safety margin', async () => {
    const requestedInputs: bigint[] = [];
    const aggregator: Aggregator = {
      supportsChain: () => true,
      getQuotes: vi.fn(async (requests: QuoteRequest[]) =>
        requests.map((request) => {
          if (request.type !== QuoteType.EXACT_IN) return null;
          requestedInputs.push(request.inputAmount);
          return requestedInputs.length === 1
            ? makeQuote(request.inputAmount, 500n)
            : makeQuote(request.inputAmount, 1000n);
        })
      ),
    };

    const result = await convergeExactIn({
      initialInputAmountRaw: new Decimal(1000),
      requiredOutputAmountRaw: 1000n,
      maxExtraInputAmountRaw: new Decimal(5000),
      maxAttempts: 3,
      aggregators: [aggregator],
      makeRequest,
    });

    const expectedSecond = BigInt(
      new Decimal(requestedInputs[0].toString())
        .mul(1000)
        .div(500)
        .mul(SAFETY_MULTIPLIER)
        .toFixed(0, Decimal.ROUND_CEIL)
    );
    expect(result).not.toBeNull();
    expect(requestedInputs).toEqual([requestedInputs[0], expectedSecond]);
  });

  it('uses a lazy fallback seed after the first request returns no quote', async () => {
    const requestedInputs: bigint[] = [];
    const getFallbackInitialInputAmountRaw = vi.fn().mockResolvedValue(new Decimal(200));
    const aggregator: Aggregator = {
      supportsChain: () => true,
      getQuotes: vi.fn(async (requests: QuoteRequest[]) =>
        requests.map((request) => {
          if (request.type !== QuoteType.EXACT_IN) return null;
          requestedInputs.push(request.inputAmount);
          return requestedInputs.length === 1 ? null : makeQuote(request.inputAmount, 1000n);
        })
      ),
    };

    const result = await convergeExactIn({
      initialInputAmountRaw: new Decimal(100),
      getFallbackInitialInputAmountRaw,
      requiredOutputAmountRaw: 1000n,
      maxExtraInputAmountRaw: new Decimal(1000),
      maxAttempts: 3,
      aggregators: [aggregator],
      makeRequest,
    });

    expect(result).not.toBeNull();
    expect(getFallbackInitialInputAmountRaw).toHaveBeenCalledTimes(1);
    expect(requestedInputs).toEqual([
      BigInt(new Decimal(100).mul(SAFETY_MULTIPLIER).toFixed(0, Decimal.ROUND_CEIL)),
      BigInt(new Decimal(200).mul(SAFETY_MULTIPLIER).toFixed(0, Decimal.ROUND_CEIL)),
    ]);
  });

  it('uses the fallback seed when the observed correction exceeds the price-seed cap', async () => {
    const requestedInputs: bigint[] = [];
    const getFallbackInitialInputAmountRaw = vi.fn().mockResolvedValue(new Decimal(200));
    const aggregator: Aggregator = {
      supportsChain: () => true,
      getQuotes: vi.fn(async (requests: QuoteRequest[]) =>
        requests.map((request) => {
          if (request.type !== QuoteType.EXACT_IN) return null;
          requestedInputs.push(request.inputAmount);
          return requestedInputs.length === 1
            ? makeQuote(request.inputAmount, 50n)
            : makeQuote(request.inputAmount, 100n);
        })
      ),
    };

    const result = await convergeExactIn({
      initialInputAmountRaw: new Decimal(100),
      getFallbackInitialInputAmountRaw,
      requiredOutputAmountRaw: 100n,
      maxExtraInputAmountRaw: new Decimal(1),
      maxAttempts: 3,
      aggregators: [aggregator],
      makeRequest,
    });

    expect(result).not.toBeNull();
    expect(getFallbackInitialInputAmountRaw).toHaveBeenCalledTimes(1);
    expect(requestedInputs).toEqual([101n, 201n]);
  });

  it('keeps ratio correction inside the existing absolute cap', async () => {
    const requestedInputs: bigint[] = [];
    const aggregator: Aggregator = {
      supportsChain: () => true,
      getQuotes: vi.fn(async (requests: QuoteRequest[]) =>
        requests.map((request) => {
          if (request.type !== QuoteType.EXACT_IN) return null;
          requestedInputs.push(request.inputAmount);
          return makeQuote(request.inputAmount, 1n);
        })
      ),
    };

    await expect(
      convergeExactIn({
        initialInputAmountRaw: new Decimal(100),
        requiredOutputAmountRaw: 1000n,
        maxExtraInputAmountRaw: new Decimal(10),
        maxAttempts: 3,
        aggregators: [aggregator],
        makeRequest,
      })
    ).resolves.toBeNull();

    expect(requestedInputs.length).toBeGreaterThan(0);
    expect(requestedInputs.every((input) => input <= 110n)).toBe(true);
  });
});
