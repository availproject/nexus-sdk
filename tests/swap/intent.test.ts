import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import type { Hex } from 'viem';
import { createSwapIntent } from '../../src/swap/intent';
import { SwapMode } from '../../src/swap/types';
import type { SwapRoute, SwapData } from '../../src/swap/types';
import type { Aggregator, QuoteResponse } from '../../src/swap/aggregators/types';
import type { ChainListType, TokenInfo } from '../../src/domain';

const USDC_ARB = '0xaf88d065e77c8cc2239327c5edb3a432268e5831' as Hex;
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' as Hex;
const ARB_CHAIN = 42161;
const BASE_CHAIN = 8453;

const makeQuoteResponse = (overrides?: Partial<QuoteResponse>): QuoteResponse => ({
  chainID: ARB_CHAIN,
  quote: {
    input: { contractAddress: WETH, amount: '1.0', amountRaw: 1000000000000000000n, decimals: 18, value: 3000, symbol: 'WETH' },
    output: { contractAddress: USDC_ARB, amount: '3000', amountRaw: 3000000000n, decimals: 6, value: 3000, symbol: 'USDC' },
    txData: {
      approvalAddress: '0x1111111111111111111111111111111111111111' as Hex,
      tx: { to: '0x2222222222222222222222222222222222222222' as Hex, data: '0xab' as Hex, value: '0x0' as Hex },
    },
  },
  holding: { chainID: ARB_CHAIN, tokenAddress: WETH, amountRaw: 1000000000000000000n, decimals: 18, symbol: 'WETH' },
  aggregator: {} as Aggregator,
  ...overrides,
});

const makeChainList = () => ({
  getChainByID: (id: number) => ({
    id,
    name: id === ARB_CHAIN ? 'Arbitrum' : 'Base',
    custom: { icon: 'https://chain.logo' },
  }),
});

const makeRoute = (overrides?: Partial<SwapRoute>): SwapRoute => ({
  type: SwapMode.EXACT_OUT,
  source: { swaps: [makeQuoteResponse()], creationTime: Date.now(), srcBuffer: new Decimal(0) },
  bridge: null,
  destination: {
    chainId: ARB_CHAIN,
    eoaToEphemeral: null,
    inputAmount: { min: new Decimal('3000'), max: new Decimal('3150') },
    swap: {
      tokenSwap: makeQuoteResponse({
        chainID: ARB_CHAIN,
        quote: {
          input: { contractAddress: USDC_ARB, amount: '3000', amountRaw: 3000000000n, decimals: 6, value: 3000, symbol: 'USDC' },
          output: { contractAddress: WETH, amount: '1.0', amountRaw: 1000000000000000000n, decimals: 18, value: 3000, symbol: 'WETH' },
          txData: { approvalAddress: '0x1111111111111111111111111111111111111111' as Hex, tx: { to: '0x2222222222222222222222222222222222222222' as Hex, data: '0x' as Hex, value: '0x0' as Hex } },
        },
      }),
      gasSwap: null,
    },
    getDstSwap: async () => null,
  },
  buffer: { amount: '150' },
  dstTokenInfo: { contractAddress: WETH, decimals: 18, symbol: 'WETH', name: 'Wrapped Ether', logo: '' } as TokenInfo,
  extras: {
    aggregators: [],
    oraclePrices: [],
    balances: [],
    assetsUsed: [
      { chainID: ARB_CHAIN, tokenAddress: WETH, symbol: 'WETH', decimals: 18, amount: '1.0' },
    ],
  },
  sourceExecutionPaths: new Map(),
  ...overrides,
});

describe('createSwapIntent', () => {
  it('EXACT_OUT → destination amount from toAmount', () => {
    const route = makeRoute();
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: ARB_CHAIN, toTokenAddress: WETH, toAmountRaw: 1000000000000000000n },
    };

    const intent = createSwapIntent(route, input, makeChainList() as unknown as ChainListType);

    expect(intent.destination.amount).toBeDefined();
    expect(intent.destination.token.symbol).toBe('WETH');
    expect(intent.destination.chain.id).toBe(ARB_CHAIN);
  });

  it('sources mapped with chain info', () => {
    const route = makeRoute();
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: ARB_CHAIN, toTokenAddress: WETH, toAmountRaw: 1000000000000000000n },
    };

    const intent = createSwapIntent(route, input, makeChainList() as unknown as ChainListType);

    expect(intent.sources.length).toBeGreaterThan(0);
    expect(intent.sources[0].chain.name).toBe('Arbitrum');
  });

  it('uses destination-facing USD value semantics from the token swap output', () => {
    const route = makeRoute({
      destination: {
        chainId: ARB_CHAIN,
        eoaToEphemeral: null,
        inputAmount: { min: new Decimal('3000'), max: new Decimal('3150') },
        swap: {
          gasSwap: null,
          tokenSwap: makeQuoteResponse({
            chainID: ARB_CHAIN,
            quote: {
              input: {
                contractAddress: USDC_ARB,
                amount: '3000',
                amountRaw: 3000000000n,
                decimals: 6,
                value: 2850,
                symbol: 'USDC',
              },
              output: {
                contractAddress: WETH,
                amount: '1.0',
                amountRaw: 1000000000000000000n,
                decimals: 18,
                value: 3000,
                symbol: 'WETH',
              },
              txData: {
                approvalAddress: '0x1111111111111111111111111111111111111111' as Hex,
                tx: {
                  to: '0x2222222222222222222222222222222222222222' as Hex,
                  data: '0x' as Hex,
                  value: '0x0' as Hex,
                },
              },
            },
          }),
        },
        getDstSwap: async () => null,
      },
    });
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: ARB_CHAIN, toTokenAddress: WETH, toAmountRaw: 1000000000000000000n },
    };

    const intent = createSwapIntent(route, input, makeChainList() as unknown as ChainListType);

    expect(intent.destination.value).toBe('3000');
  });

  it('includes proportional source USD values from balances used by the route', () => {
    const route = makeRoute({
      extras: {
        aggregators: [],
        oraclePrices: [],
        balances: [
          {
            amount: '1.0',
            chainID: ARB_CHAIN,
            decimals: 18,
            symbol: 'WETH',
            tokenAddress: WETH,
            value: 3000,
            logo: '',
            name: 'WETH'
          },
        ],
        assetsUsed: [
          {
            chainID: ARB_CHAIN,
            tokenAddress: WETH,
            symbol: 'WETH',
            decimals: 18,
            amount: '0.5',
          },
        ],
      },
    });
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: ARB_CHAIN, toTokenAddress: WETH, toAmountRaw: 1000000000000000000n },
    };

    const intent = createSwapIntent(route, input, makeChainList() as unknown as ChainListType);

    expect(intent.sources[0].value).toBe('1500');
  });

  it('bridge fees present when bridge exists', () => {
    const route = makeRoute({
      bridge: {
        amount: new Decimal('3000'),
        amounts: {
          tokenAmount: new Decimal('3000'),
          gasInCot: new Decimal(0),
          totalAmount: new Decimal('3000'),
        },
        assets: [],
        chainID: BASE_CHAIN,
        decimals: 6,
        tokenAddress: USDC_ARB,
        estimatedFees: {
          collection: new Decimal(0),
          fulfilment: new Decimal(0),
          caGas: new Decimal('0.1'),
          protocol: new Decimal('0.05'),
          solver: new Decimal('0.075'),
        },
      },
    });
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: BASE_CHAIN, toTokenAddress: WETH, toAmountRaw: 1000000000000000000n },
    };

    const intent = createSwapIntent(route, input, makeChainList() as unknown as ChainListType);

    expect(intent.feesAndBuffer.bridge).not.toBeNull();
    expect(intent.feesAndBuffer.bridge!.total).toBeDefined();
  });

  it('no bridge → feesAndBuffer.bridge = null', () => {
    const route = makeRoute({ bridge: null });
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: ARB_CHAIN, toTokenAddress: WETH, toAmountRaw: 1000000000000000000n },
    };

    const intent = createSwapIntent(route, input, makeChainList() as unknown as ChainListType);

    expect(intent.feesAndBuffer.bridge).toBeNull();
  });

  it('bridgeProvider reflects the route bridge provider (nexus)', () => {
    const route = makeRoute({
      bridge: {
        amount: new Decimal('3000'),
        amounts: { tokenAmount: new Decimal('3000'), gasInCot: new Decimal(0), totalAmount: new Decimal('3000') },
        assets: [],
        chainID: BASE_CHAIN,
        decimals: 6,
        tokenAddress: USDC_ARB,
        estimatedFees: { collection: new Decimal(0), fulfilment: new Decimal(0), caGas: new Decimal(0), protocol: new Decimal(0), solver: new Decimal(0) },
        provider: 'nexus',
      },
    });
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: BASE_CHAIN, toTokenAddress: WETH, toAmountRaw: 1000000000000000000n },
    };

    const intent = createSwapIntent(route, input, makeChainList() as unknown as ChainListType);

    expect(intent.bridgeProvider).toBe('nexus');
  });

  it('bridgeProvider reflects the route bridge provider (mayan)', () => {
    const route = makeRoute({
      bridge: {
        amount: new Decimal('3000'),
        amounts: { tokenAmount: new Decimal('3000'), gasInCot: new Decimal(0), totalAmount: new Decimal('3000') },
        assets: [],
        chainID: BASE_CHAIN,
        decimals: 6,
        tokenAddress: USDC_ARB,
        estimatedFees: { collection: new Decimal(0), fulfilment: new Decimal(0), caGas: new Decimal(0), protocol: new Decimal(0), solver: new Decimal(0) },
        provider: 'mayan',
      },
    });
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: BASE_CHAIN, toTokenAddress: WETH, toAmountRaw: 1000000000000000000n },
    };

    const intent = createSwapIntent(route, input, makeChainList() as unknown as ChainListType);

    expect(intent.bridgeProvider).toBe('mayan');
  });

  it('no bridge → bridgeProvider = null', () => {
    const route = makeRoute({ bridge: null });
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: ARB_CHAIN, toTokenAddress: WETH, toAmountRaw: 1000000000000000000n },
    };

    const intent = createSwapIntent(route, input, makeChainList() as unknown as ChainListType);

    expect(intent.bridgeProvider).toBeNull();
  });

  it('destination token IS COT → no token swap in intent', () => {
    const route = makeRoute({
      destination: {
        chainId: ARB_CHAIN,
        eoaToEphemeral: null,
        inputAmount: { min: new Decimal('1000'), max: new Decimal('1000') },
        swap: { tokenSwap: null, gasSwap: null },
        getDstSwap: async () => null,
      },
      dstTokenInfo: { contractAddress: USDC_ARB, decimals: 6, symbol: 'USDC', name: 'USD Coin', logo: '' } as TokenInfo,
    });
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: ARB_CHAIN, toTokenAddress: USDC_ARB, toAmountRaw: 1000000000n },
    };

    const intent = createSwapIntent(route, input, makeChainList() as unknown as ChainListType);

    expect(intent.destination.token.symbol).toBe('USDC');
    expect(intent.destination.amount).toBeDefined();
  });

  it('destination token IS COT with oracle priceUsd → destinationValue = amount × priceUsd', () => {
    const route = makeRoute({
      destination: {
        chainId: ARB_CHAIN,
        eoaToEphemeral: null,
        inputAmount: { min: new Decimal('1000'), max: new Decimal('1000') },
        swap: { tokenSwap: null, gasSwap: null },
        getDstSwap: async () => null,
      },
      dstTokenInfo: { contractAddress: USDC_ARB, decimals: 6, symbol: 'USDC', name: 'USD Coin', logo: '' } as TokenInfo,
      extras: {
        aggregators: [],
        oraclePrices: [
          {
            universe: 'EVM',
            chainId: ARB_CHAIN,
            priceUsd: new Decimal('1.0001'),
            tokenAddress: USDC_ARB,
            tokenSymbol: 'USDC',
            tokenDecimals: 6,
            timestamp: 0,
          },
        ],
        balances: [],
        assetsUsed: [],
      },
    });
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: ARB_CHAIN, toTokenAddress: USDC_ARB, toAmountRaw: 1000000000n },
    };

    const intent = createSwapIntent(route, input, makeChainList() as unknown as ChainListType);

    // 1000 USDC × 1.0001 = 1000.1
    expect(intent.destination.value).toBe('1000.1');
  });

  it('destination token IS COT with no oracle entry → destinationValue falls back to amount', () => {
    const route = makeRoute({
      destination: {
        chainId: ARB_CHAIN,
        eoaToEphemeral: null,
        inputAmount: { min: new Decimal('1000'), max: new Decimal('1000') },
        swap: { tokenSwap: null, gasSwap: null },
        getDstSwap: async () => null,
      },
      dstTokenInfo: { contractAddress: USDC_ARB, decimals: 6, symbol: 'USDC', name: 'USD Coin', logo: '' } as TokenInfo,
      extras: {
        aggregators: [],
        oraclePrices: [],
        balances: [],
        assetsUsed: [],
      },
    });
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: ARB_CHAIN, toTokenAddress: USDC_ARB, toAmountRaw: 1000000000n },
    };

    const intent = createSwapIntent(route, input, makeChainList() as unknown as ChainListType);

    // No oracle entry for USDC_ARB → fall back to amount (COT is USDC, ≈ $1)
    expect(intent.destination.value).toBe('1000');
  });

  it('EXACT_OUT toAmountRaw < 0n (reservation) → destinationAmount = "0"', () => {
    const route = makeRoute({
      destination: {
        chainId: ARB_CHAIN,
        eoaToEphemeral: null,
        inputAmount: { min: new Decimal(0), max: new Decimal(0) },
        swap: { tokenSwap: null, gasSwap: null },
        getDstSwap: async () => null,
      },
      dstTokenInfo: { contractAddress: USDC_ARB, decimals: 6, symbol: 'USDC', name: 'USD Coin', logo: '' } as TokenInfo,
    });
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: ARB_CHAIN, toTokenAddress: USDC_ARB, toAmountRaw: -1000000000n },
    };

    const intent = createSwapIntent(route, input, makeChainList() as unknown as ChainListType);

    // Reservation/gas-only delivers no tokens; the user-facing amount must be "0",
    // not the garbage that BigInt-divisions of negatives produce in the old formatter.
    expect(intent.destination.amount).toBe('0');
  });

  it('EXACT_OUT toAmountRaw ≤ 0n (reservation/gas-only) → destinationValue = "0"', () => {
    // Negative sentinel: the funding swap reserves the user's existing dst toToken
    // rather than delivering more, so the intent's destinationValue should be "0".
    const route = makeRoute({
      destination: {
        chainId: ARB_CHAIN,
        eoaToEphemeral: null,
        inputAmount: { min: new Decimal(0), max: new Decimal(0) },
        swap: { tokenSwap: null, gasSwap: null },
        getDstSwap: async () => null,
      },
      dstTokenInfo: { contractAddress: USDC_ARB, decimals: 6, symbol: 'USDC', name: 'USD Coin', logo: '' } as TokenInfo,
      extras: {
        aggregators: [],
        oraclePrices: [
          {
            universe: 'EVM',
            chainId: ARB_CHAIN,
            priceUsd: new Decimal('1.0'),
            tokenAddress: USDC_ARB,
            tokenSymbol: 'USDC',
            tokenDecimals: 6,
            timestamp: 0,
          },
        ],
        balances: [],
        assetsUsed: [],
      },
    });
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: ARB_CHAIN, toTokenAddress: USDC_ARB, toAmountRaw: -1000000000n },
    };

    const intent = createSwapIntent(route, input, makeChainList() as unknown as ChainListType);

    expect(intent.destination.value).toBe('0');
  });

  it('EXACT_IN without destination swap uses human-readable destination input amount directly', () => {
    const route = makeRoute({
      type: SwapMode.EXACT_IN,
      destination: {
        chainId: ARB_CHAIN,
        eoaToEphemeral: null,
        inputAmount: { min: new Decimal('3000'), max: new Decimal('3000') },
        swap: { tokenSwap: null, gasSwap: null },
        getDstSwap: async () => null,
      },
      dstTokenInfo: { contractAddress: USDC_ARB, decimals: 6, symbol: 'USDC', name: 'USD Coin', logo: '' } as TokenInfo,
    });
    const input: SwapData = {
      mode: SwapMode.EXACT_IN,
      data: { sources: [], toChainId: ARB_CHAIN, toTokenAddress: USDC_ARB },
    };

    const intent = createSwapIntent(route, input, makeChainList() as unknown as ChainListType);

    expect(intent.destination.amount).toBe('3000');
  });

  it('uses route destination gas-swap output for destination gas display', () => {
    const route = makeRoute({
      destination: {
        chainId: ARB_CHAIN,
        eoaToEphemeral: null,
        inputAmount: { min: new Decimal('3000'), max: new Decimal('3150') },
        swap: {
          tokenSwap: makeQuoteResponse({
            chainID: ARB_CHAIN,
            quote: {
              input: {
                contractAddress: USDC_ARB,
                amount: '3000',
                amountRaw: 3000000000n,
                decimals: 6,
                value: 3000,
                symbol: 'USDC',
              },
              output: {
                contractAddress: WETH,
                amount: '1.0',
                amountRaw: 1000000000000000000n,
                decimals: 18,
                value: 3000,
                symbol: 'WETH',
              },
              txData: {
                approvalAddress: '0x1111111111111111111111111111111111111111' as Hex,
                tx: {
                  to: '0x2222222222222222222222222222222222222222' as Hex,
                  data: '0x' as Hex,
                  value: '0x0' as Hex,
                },
              },
            },
          }),
          gasSwap: makeQuoteResponse({
            chainID: ARB_CHAIN,
            quote: {
              input: { contractAddress: USDC_ARB, amount: '25', amountRaw: 25_000_000n, decimals: 6, value: 25, symbol: 'USDC' },
              output: {
                contractAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as Hex,
                amount: '0.01',
                amountRaw: 10000000000000000n,
                decimals: 18,
                value: 25,
                symbol: 'ETH',
              },
              txData: {
                approvalAddress: '0x1111111111111111111111111111111111111111' as Hex,
                tx: { to: '0x2222222222222222222222222222222222222222' as Hex, data: '0x' as Hex, value: '0x0' as Hex },
              },
            },
          }),
        },
        getDstSwap: async () => null,
      },
    });
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: {
        toChainId: ARB_CHAIN,
        toTokenAddress: WETH,
        toAmountRaw: 1000000000000000000n,
      },
    };

    const intent = createSwapIntent(route, input, makeChainList() as unknown as ChainListType);

    expect(intent.destination.gas.amount).toBe('0.01');
  });

  it('Path A: reads the gas amount from a native-output source swap when gasSwap is null', async () => {
    // Path A EXACT_OUT delivers gas via a native-output SOURCE swap (not destination.swap.gasSwap),
    // so the intent gas display sums the native-output source legs on the dst chain.
    const NATIVE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as Hex;
    const nativeGasLeg = makeQuoteResponse({
      chainID: ARB_CHAIN,
      quote: {
        input: { contractAddress: USDC_ARB, amount: '50', amountRaw: 50000000n, decimals: 6, value: 50, symbol: 'USDC' },
        output: { contractAddress: NATIVE, amount: '0.02', amountRaw: 20000000000000000n, decimals: 18, value: 50, symbol: 'ETH' },
        txData: { approvalAddress: '0x1111111111111111111111111111111111111111' as Hex, tx: { to: '0x2222222222222222222222222222222222222222' as Hex, data: '0x' as Hex, value: '0x0' as Hex } },
      },
    });
    const route = makeRoute({
      directDestination: true,
      // one toToken leg (USDC output, ignored for gas) + one native gas leg
      source: { swaps: [makeQuoteResponse(), nativeGasLeg], creationTime: Date.now(), srcBuffer: new Decimal(0) },
      destination: {
        chainId: ARB_CHAIN,
        eoaToEphemeral: null,
        inputAmount: { min: new Decimal(0), max: new Decimal(0) },
        swap: { tokenSwap: null, gasSwap: null },
        getDstSwap: async () => null,
      },
    });
    const input: SwapData = { mode: SwapMode.EXACT_OUT, data: { toChainId: ARB_CHAIN, toTokenAddress: WETH, toAmountRaw: 1000000000000000000n } };

    const intent = createSwapIntent(route, input, makeChainList() as unknown as ChainListType);

    expect(intent.destination.gas.amount).toBe('0.02');
  });
});
