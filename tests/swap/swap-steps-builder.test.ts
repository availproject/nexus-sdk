import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import type { Hex } from 'viem';
import { createSwapPlan } from '../../src/swap/swap-steps-builder';
import type { BridgeAsset, DestinationSwap, SwapRoute } from '../../src/swap/types';
import { SwapMode } from '../../src/swap/types';
import type { Aggregator, Holding, Quote } from '../../src/swap/aggregators/types';
import { makeChain, makeChainList } from '../helpers/chains';
import { quoteFixture } from '../helpers/quote';

const token = {
  contractAddress: '0x0000000000000000000000000000000000000001' as const,
  decimals: 6,
  logo: '',
  name: 'USD Coin',
  symbol: 'USDC',
};

const chainA = makeChain(42161, 'Arbitrum');
const chainB = makeChain(10, 'Optimism');
const chainDst = makeChain(8453, 'Base');
const chainList = makeChainList([chainA, chainB, chainDst], token);

const noSwap: DestinationSwap = { tokenSwap: null, gasSwap: null };
const withTokenSwap: DestinationSwap = {
  tokenSwap: {
    chainID: 8453,
    quote: quoteFixture({
      input: {
        contractAddress: token.contractAddress,
        amount: '100',
        amountRaw: 100000000n,
        decimals: 6,
        value: 100,
        symbol: 'USDC',
      },
      output: {
        contractAddress: '0x00000000000000000000000000000000000000ee' as Hex,
        amount: '0.05',
        amountRaw: 50000000000000000n,
        decimals: 18,
        value: 100,
        symbol: 'ETH',
      },
      txData: {
        approvalAddress: '0x1111111111111111111111111111111111111111' as Hex,
        tx: {
          to: '0x2222222222222222222222222222222222222222' as Hex,
          data: '0x1234' as Hex,
          value: '0x0' as Hex,
        },
      },
    }),
    holding: {} as Holding,
    aggregator: {} as Aggregator,
  },
  gasSwap: null,
};

const makeRoute = (overrides: Partial<SwapRoute> = {}): SwapRoute => ({
  type: SwapMode.EXACT_OUT,
  source: { swaps: [], creationTime: Date.now(), srcBuffer: new Decimal(0) },
  bridge: null,
  destination: {
    chainId: 8453,
    eoaToEphemeral: null,
    inputAmount: { min: new Decimal(0), max: new Decimal(0) },
    swap: noSwap,
    getDstSwap: async () => null,
  },
  buffer: { amount: '0' },
  dstTokenInfo: token,
  extras: { aggregators: [], oraclePrices: [], balances: [], assetsUsed: [] },
  sourceExecutionPaths: new Map(),
  ...overrides,
});

const makeQuoteResponse = (chainID: number) => ({
  chainID,
  quote: quoteFixture({
    input: {
      contractAddress: '0x00000000000000000000000000000000000000aa' as Hex,
      amount: '50000',
      amountRaw: 50000000000n,
      decimals: 6,
      value: 50,
      symbol: 'PEPE',
    },
    output: {
      contractAddress: token.contractAddress,
      amount: '1.1',
      amountRaw: 1100000n,
      decimals: 6,
      value: 1.1,
      symbol: 'USDC',
    },
    txData: {
      approvalAddress: '0x1111111111111111111111111111111111111111' as Hex,
      tx: {
        to: '0x2222222222222222222222222222222222222222' as Hex,
        data: '0x1234' as Hex,
        value: '0x0' as Hex,
      },
    },
  }),
  holding: {
    chainID,
    tokenAddress: '0x01' as Hex,
    amountRaw: 100n,
    decimals: 6,
    symbol: 'PEPE',
  },
  aggregator: {} as Aggregator,
});

const makeBridgeAsset = (chainID: number, eoaBalance: number): BridgeAsset => ({
  chainID,
  contractAddress: token.contractAddress,
  decimals: 6,
  eoaBalance: new Decimal(eoaBalance),
  ephemeralBalance: new Decimal(10),
});

describe('createSwapPlan', () => {
  it('returns source-only steps without synthetic lifecycle markers', () => {
    const route = makeRoute({
      source: { swaps: [makeQuoteResponse(42161)], creationTime: Date.now(), srcBuffer: new Decimal(0) },
      sourceExecutionPaths: new Map([[42161, 'ephemeral']]),
    });

    const plan = createSwapPlan(route, chainList);

    expect(plan.hasBridge).toBe(false);
    expect(plan.hasDestinationSwap).toBe(false);
    expect(plan.steps).toEqual([
      expect.objectContaining({
        type: 'source_swap',
        id: 'source_swap:42161',
        chain: expect.objectContaining({ id: 42161, name: 'Arbitrum' }),
        walletPath: 'ephemeral',
        swaps: [
          expect.objectContaining({
            input: expect.objectContaining({
              amount: '50000',
              amountRaw: 50000000000n,
              contractAddress: '0x00000000000000000000000000000000000000aa',
            }),
            output: expect.objectContaining({
              symbol: 'USDC',
              amount: '1.1',
              amountRaw: 1100000n,
            }),
          }),
        ],
      }),
    ]);
  });

  it('builds bridge and destination steps with deterministic ids', () => {
    const route = makeRoute({
      source: {
        swaps: [makeQuoteResponse(42161), makeQuoteResponse(10)],
        creationTime: Date.now(),
        srcBuffer: new Decimal(0),
        cotByChain: new Map([
          [42161, { contractAddress: token.contractAddress, decimals: 6, currencyId: 1 }],
          [10, { contractAddress: token.contractAddress, decimals: 6, currencyId: 1 }],
        ]),
      },
      bridge: {
        amount: new Decimal('2.2'),
        amounts: {
          tokenAmount: new Decimal('2.2'),
          gasInCot: new Decimal(0),
          totalAmount: new Decimal('2.2'),
        },
        assets: [makeBridgeAsset(42161, 5), makeBridgeAsset(10, 0)],
        chainID: 8453,
        decimals: 6,
        tokenAddress: token.contractAddress,
        estimatedFees: {
          collection: new Decimal(0),
          fulfilment: new Decimal(0),
          caGas: new Decimal(0),
          protocol: new Decimal(0),
          solver: new Decimal(0),
        },
      },
      destination: {
        chainId: 8453,
        eoaToEphemeral: null,
        inputAmount: { min: new Decimal(0), max: new Decimal(0) },
        swap: withTokenSwap,
        getDstSwap: async () => null,
      },
      sourceExecutionPaths: new Map([
        [42161, 'ephemeral'],
        [10, 'ephemeral'],
      ]),
    });

    const plan = createSwapPlan(route, chainList);

    expect(plan.hasBridge).toBe(true);
    expect(plan.hasDestinationSwap).toBe(true);
    expect(plan.steps.map((step) => step.id)).toEqual([
      'source_swap:10',
      'source_swap:42161',
      'bridge_intent_submission',
      'bridge_deposit:10',
      'eoa_to_ephemeral_transfer:42161',
      'bridge_deposit:42161',
      'bridge_fill:8453',
      'destination_swap:8453',
    ]);
  });

  it('includes eoa_to_ephemeral_transfer only for bridge assets with eoa balance', () => {
    const route = makeRoute({
      bridge: {
        amount: new Decimal(50),
        amounts: {
          tokenAmount: new Decimal(50),
          gasInCot: new Decimal(0),
          totalAmount: new Decimal(50),
        },
        assets: [makeBridgeAsset(42161, 5), makeBridgeAsset(10, 0)],
        chainID: 8453,
        decimals: 6,
        tokenAddress: token.contractAddress,
        estimatedFees: {
          collection: new Decimal(0),
          fulfilment: new Decimal(0),
          caGas: new Decimal(0),
          protocol: new Decimal(0),
          solver: new Decimal(0),
        },
      },
    });

    const plan = createSwapPlan(route, chainList);

    expect(plan.steps.filter((step) => step.type === 'eoa_to_ephemeral_transfer')).toEqual([
      expect.objectContaining({
        chain: expect.objectContaining({ id: 42161, name: 'Arbitrum' }),
        asset: expect.objectContaining({ amountRaw: 5000000n, amount: '5.000000' }),
      }),
    ]);
  });

  it('omits any public sweep step even for ephemeral destination execution', () => {
    const route = makeRoute({
      destination: {
        chainId: 8453,
        eoaToEphemeral: null,
        inputAmount: { min: new Decimal(0), max: new Decimal(0) },
        swap: withTokenSwap,
        getDstSwap: async () => null,
      },
    });

    const plan = createSwapPlan(route, chainList);

    expect(plan.steps.map((step) => step.type)).not.toContain('sweep');
  });

  it('omits bridge steps when no bridge is required', () => {
    const route = makeRoute({
      source: { swaps: [makeQuoteResponse(8453)], creationTime: Date.now(), srcBuffer: new Decimal(0) },
      destination: {
        chainId: 8453,
        eoaToEphemeral: null,
        inputAmount: { min: new Decimal(0), max: new Decimal(0) },
        swap: withTokenSwap,
        getDstSwap: async () => null,
      },
      sourceExecutionPaths: new Map([[8453, 'ephemeral']]),
    });

    const plan = createSwapPlan(route, chainList);

    expect(plan.hasBridge).toBe(false);
    expect(plan.steps.map((step) => step.type)).toEqual(['source_swap', 'destination_swap']);
  });
});
