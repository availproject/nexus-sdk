import { beforeEach, describe, expect, it, vi } from 'vitest';
import { liquidateInputHoldings } from '../../../src/swap/algorithms/liquidate';
import type { Aggregator, Holding, Quote } from '../../../src/swap/aggregators/types';
import { CurrencyID } from '../../../src/swap/cot';
import { ARB_CHAIN, OP_CHAIN, USDC_ARB, USDC_OP, WETH, DAI, makeSwapChainList } from '../../helpers/swap';

const makeHolding = (chainID: number, tokenAddress: `0x${string}`, amountRaw: bigint, decimals: number, symbol: string): Holding => ({
  chainID,
  tokenAddress,
  amountRaw,
  decimals,
  symbol,
});

const makeQuote = (outputAmountRaw: bigint, inputContract: `0x${string}` = WETH): Quote => ({
  input: {
    contractAddress: inputContract,
    amount: '1000000',
    amountRaw: 1000000n,
    decimals: 18,
    value: 1,
    symbol: 'WETH',
  },
  output: {
    contractAddress: USDC_ARB,
    amount: outputAmountRaw.toString(),
    amountRaw: outputAmountRaw,
    decimals: 6,
    value: 1,
    symbol: 'USDC',
  },
  txData: {
    approvalAddress: '0x03' as `0x${string}`,
    tx: { to: '0x04' as `0x${string}`, data: '0x05' as `0x${string}`, value: '0x0' as `0x${string}` },
  },
});

// Taker + receiver are required, deliberately-passed per-chain maps.
const requestAddresses = {
  userAddressByChain: new Map<number, `0x${string}`>([
    [ARB_CHAIN, '0xUser000000000000000000000000000000000001'],
    [OP_CHAIN, '0xUser000000000000000000000000000000000001'],
  ]),
  recipientAddressByChain: new Map<number, `0x${string}`>([
    [ARB_CHAIN, '0xRecv000000000000000000000000000000000002'],
    [OP_CHAIN, '0xRecv000000000000000000000000000000000002'],
  ]),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('liquidateInputHoldings', () => {
  it('liquidates non-COT holdings to COT per chain', async () => {
    const holdings = [
      makeHolding(42161, WETH, 500000000000000000n, 18, 'WETH'), // 0.5 WETH on Arb
    ];
    const agg: Aggregator = {
      supportsChain: () => true,
      getQuotes: vi.fn().mockResolvedValue([makeQuote(5000000n)]),
    };

    const result = await liquidateInputHoldings({
      holdings,
      aggregators: [agg],
      chainList: makeSwapChainList(),
      cotCurrencyId: CurrencyID.USDC,
      ...requestAddresses,
    });

    expect(result).toHaveLength(1);
    expect(result[0].chainID).toBe(42161);
    expect(result[0].quote.output.amountRaw).toBe(5000000n);
  });

  it('skips COT holdings — they are direct transfers, not swaps', async () => {
    const holdings = [
      makeHolding(42161, USDC_ARB, 5000000n, 6, 'USDC'),       // COT — skip
      makeHolding(42161, WETH, 500000000000000000n, 18, 'WETH'), // non-COT — liquidate
    ];
    const agg: Aggregator = {
      supportsChain: () => true,
      getQuotes: vi.fn().mockResolvedValue([makeQuote(5000000n)]),
    };

    const result = await liquidateInputHoldings({
      holdings,
      aggregators: [agg],
      chainList: makeSwapChainList(),
      cotCurrencyId: CurrencyID.USDC,
      ...requestAddresses,
    });

    // Only the WETH holding should be liquidated
    expect(result).toHaveLength(1);
    expect(result[0].holding.tokenAddress).toBe(WETH);
  });

  it('returns empty array when all holdings are COT', async () => {
    const holdings = [
      makeHolding(42161, USDC_ARB, 5000000n, 6, 'USDC'),
      makeHolding(10, USDC_OP, 3000000n, 6, 'USDC'),
    ];
    const agg: Aggregator = {
      supportsChain: () => true,
      getQuotes: vi.fn().mockResolvedValue([]),
    };

    const result = await liquidateInputHoldings({
      holdings,
      aggregators: [agg],
      chainList: makeSwapChainList(),
      cotCurrencyId: CurrencyID.USDC,
      ...requestAddresses,
    });

    expect(result).toHaveLength(0);
    // Should not even call aggregator
    expect(agg.getQuotes).not.toHaveBeenCalled();
  });

  it('filters out null quotes', async () => {
    const holdings = [
      makeHolding(42161, WETH, 500000000000000000n, 18, 'WETH'),
      makeHolding(42161, DAI, 1000000000000000000n, 18, 'DAI'),
    ];
    const agg: Aggregator = {
      supportsChain: () => true,
      getQuotes: vi.fn().mockResolvedValue([makeQuote(5000000n), null]),
    };

    const result = await liquidateInputHoldings({
      holdings,
      aggregators: [agg],
      chainList: makeSwapChainList(),
      cotCurrencyId: CurrencyID.USDC,
      ...requestAddresses,
    });

    // Only the first (non-null) quote
    expect(result).toHaveLength(1);
    expect(result[0].holding.tokenAddress).toBe(WETH);
  });

  it('handles multiple non-COT holdings across chains', async () => {
    const holdings = [
      makeHolding(42161, WETH, 500000000000000000n, 18, 'WETH'),
      makeHolding(10, DAI, 1000000000000000000n, 18, 'DAI'),
    ];
    const agg: Aggregator = {
      supportsChain: () => true,
      getQuotes: vi.fn().mockResolvedValue([makeQuote(5000000n), makeQuote(990000n, DAI)]),
    };

    const result = await liquidateInputHoldings({
      holdings,
      aggregators: [agg],
      chainList: makeSwapChainList(),
      cotCurrencyId: CurrencyID.USDC,
      ...requestAddresses,
    });

    expect(result).toHaveLength(2);
    expect(result[0].chainID).toBe(42161);
    expect(result[1].chainID).toBe(10);
  });

  it('liquidates to a fixed destination token when outputToken is set (Path A), skipping identity holdings', async () => {
    const PEPE = '0x00000000000000000000000000000000000pepe01' as `0x${string}`;
    const holdings = [
      makeHolding(ARB_CHAIN, WETH, 500000000000000000n, 18, 'WETH'), // swap → PEPE
      makeHolding(ARB_CHAIN, PEPE, 1000000000000000000n, 18, 'PEPE'), // identity → skipped
    ];
    const getQuotes = vi.fn().mockResolvedValue([makeQuote(5000000n)]);
    const agg: Aggregator = { getQuotes, supportsChain: () => true };

    const result = await liquidateInputHoldings({
      holdings,
      aggregators: [agg],
      chainList: makeSwapChainList(),
      cotCurrencyId: CurrencyID.USDC,
      outputToken: { contractAddress: PEPE },
      ...requestAddresses,
    });

    // Only the non-identity WETH holding is swapped, and its request targets the destination token
    // directly — NOT the per-chain COT.
    expect(result).toHaveLength(1);
    expect(result[0].holding.tokenAddress).toBe(WETH);
    const [requests] = getQuotes.mock.calls[0];
    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual(
      expect.objectContaining({ inputToken: WETH, outputToken: PEPE })
    );
  });

  it('passes recipientAddressByChain through to liquidation quotes', async () => {
    const holdings = [makeHolding(ARB_CHAIN, WETH, 500000000000000000n, 18, 'WETH')];
    const getQuotes = vi.fn().mockResolvedValue([makeQuote(5000000n)]);
    const agg: Aggregator = { getQuotes, supportsChain: () => true };
    const recipient = '0xRecipient00000000000000000000000000000001' as `0x${string}`;

    await liquidateInputHoldings({
      holdings,
      aggregators: [agg],
      chainList: makeSwapChainList(),
      cotCurrencyId: CurrencyID.USDC,
      userAddressByChain: new Map([
        [ARB_CHAIN, '0xUser000000000000000000000000000000000001' as `0x${string}`],
      ]),
      recipientAddressByChain: new Map([[ARB_CHAIN, recipient]]),
    });

    const [requests] = getQuotes.mock.calls[0];
    expect(requests[0]).toEqual(
      expect.objectContaining({
        recipientAddress: recipient,
      })
    );
  });
});
