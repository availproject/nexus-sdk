import Decimal from 'decimal.js';
import type { Hex } from 'viem';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ZERO_ADDRESS } from '../../../src/domain/constants/addresses';
import { selectDirectDestinationSwaps } from '../../../src/swap/algorithms/auto-select';
import {
  makeConvergenceExtraRaw,
  sizeDirectDestinationExactOut,
} from '../../../src/swap/algorithms/direct-destination-size';
import type { Aggregator, QuoteResponse } from '../../../src/swap/aggregators/types';
import { EADDRESS } from '../../../src/swap/constants';
import type { OraclePriceResponse } from '../../../src/swap/types';

vi.mock('../../../src/swap/algorithms/auto-select', () => ({
  selectDirectDestinationSwaps: vi.fn(),
}));

const CHAIN_ID = 42161;
const INPUT_TOKEN = '0x0000000000000000000000000000000000000011' as Hex;
const OUTPUT_TOKEN = '0x0000000000000000000000000000000000000022' as Hex;
const USER = '0x0000000000000000000000000000000000000033' as Hex;
const RECIPIENT = '0x0000000000000000000000000000000000000044' as Hex;

const holding = {
  chainID: CHAIN_ID,
  tokenAddress: INPUT_TOKEN,
  amountRaw: 1_000_000n,
  decimals: 6,
  symbol: 'IN',
  value: 1,
};

const quote = (
  outputAmountRaw: bigint,
  overrides: {
    holding?: typeof holding;
    inputAmountRaw?: bigint;
    outputToken?: Hex;
    outputDecimals?: number;
  } = {}
): QuoteResponse => ({
  chainID: CHAIN_ID,
  holding: overrides.holding ?? holding,
  aggregator: {} as Aggregator,
  quote: {
    input: {
      contractAddress: INPUT_TOKEN,
      amount: '1',
      amountRaw: overrides.inputAmountRaw ?? 1_000_000n,
      decimals: 6,
      value: 1,
      symbol: 'IN',
    },
    output: {
      contractAddress: overrides.outputToken ?? OUTPUT_TOKEN,
      amount: new Decimal(outputAmountRaw.toString())
        .div(new Decimal(10).pow(overrides.outputDecimals ?? 6))
        .toFixed(),
      amountRaw: outputAmountRaw,
      decimals: overrides.outputDecimals ?? 6,
      value: 1,
      symbol: 'OUT',
    },
    txData: {
      approvalAddress: USER,
      tx: { to: RECIPIENT, data: '0x', value: '0x0' },
    },
  },
});

describe('sizeDirectDestinationExactOut', () => {
  beforeEach(() => {
    vi.mocked(selectDirectDestinationSwaps).mockReset();
  });

  it('tags the token pass and skips gas selection when the gas target is zero', async () => {
    vi.mocked(selectDirectDestinationSwaps).mockResolvedValue({
      quoteResponses: [quote(100_000_000n)],
      usedCOTs: [],
    });

    const swaps = await sizeDirectDestinationExactOut({
      holdings: [holding],
      tokenAddress: OUTPUT_TOKEN,
      tokenDecimals: 6,
      tokenTargetRaw: 100_000_000n,
      nativeDecimals: 18,
      gasTargetRaw: 0n,
      aggregators: [],
      userAddressByChain: new Map([[CHAIN_ID, USER]]),
      recipientAddressByChain: new Map([[CHAIN_ID, RECIPIENT]]),
      convergenceExtraRaw: () => undefined,
    });

    expect(selectDirectDestinationSwaps).toHaveBeenCalledTimes(1);
    expect(vi.mocked(selectDirectDestinationSwaps).mock.calls[0][0].outputRequired.toFixed()).toBe(
      '100'
    );
    expect(swaps).toEqual([expect.objectContaining({ outputRole: 'token' })]);
  });

  it('sizes gas from the proportional remainder and tags the gas leg', async () => {
    const remainder = { ...holding, amountRaw: 400_000n, value: 0.4 };
    vi.mocked(selectDirectDestinationSwaps)
      .mockResolvedValueOnce({
        quoteResponses: [quote(100_000_000n, { inputAmountRaw: 600_000n })],
        usedCOTs: [],
      })
      .mockResolvedValueOnce({
        quoteResponses: [
          quote(1_000_000_000_000_000_000n, {
            holding: remainder,
            inputAmountRaw: 400_000n,
            outputToken: EADDRESS,
            outputDecimals: 18,
          }),
        ],
        usedCOTs: [],
      });

    const swaps = await sizeDirectDestinationExactOut({
      holdings: [holding],
      tokenAddress: OUTPUT_TOKEN,
      tokenDecimals: 6,
      tokenTargetRaw: 100_000_000n,
      nativeDecimals: 18,
      gasTargetRaw: 1_000_000_000_000_000_000n,
      aggregators: [],
      userAddressByChain: new Map([[CHAIN_ID, USER]]),
      recipientAddressByChain: new Map([[CHAIN_ID, RECIPIENT]]),
      convergenceExtraRaw: () => undefined,
    });

    expect(selectDirectDestinationSwaps).toHaveBeenCalledTimes(2);
    expect(vi.mocked(selectDirectDestinationSwaps).mock.calls[1][0]).toEqual(
      expect.objectContaining({
        holdings: [remainder],
        outputRequired: new Decimal(1),
        target: { contractAddress: EADDRESS, decimals: 18 },
      })
    );
    expect(swaps.map((swap) => swap.outputRole)).toEqual(['token', 'gas']);
  });
});

describe('makeConvergenceExtraRaw', () => {
  it('uses the requested chain price and normalizes native aliases', () => {
    const oraclePrices = [
      {
        universe: 'EVM' as const,
        chainId: 1,
        tokenAddress: ZERO_ADDRESS,
        tokenSymbol: 'ETH',
        tokenDecimals: 18,
        priceUsd: new Decimal(1),
        timestamp: 1,
      },
      {
        universe: 'EVM' as const,
        chainId: CHAIN_ID,
        tokenAddress: ZERO_ADDRESS,
        tokenSymbol: 'ETH',
        tokenDecimals: 18,
        priceUsd: new Decimal(2500),
        timestamp: 1,
      },
    ] as OraclePriceResponse;

    const convergenceExtraRaw = makeConvergenceExtraRaw(oraclePrices, CHAIN_ID);

    expect(convergenceExtraRaw(EADDRESS, 18)?.toFixed()).toBe('200000000000000');
  });
});
