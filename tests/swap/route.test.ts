import { describe, expect, it, vi, beforeEach } from 'vitest';
import Decimal from 'decimal.js';
import { toHex, type Hex } from 'viem';
// Mock algorithms
vi.mock('../../src/swap/algorithms/auto-select', () => ({
  autoSelectSources: vi.fn(),
  selectDirectDestinationSwaps: vi.fn(),
}));
vi.mock('../../src/swap/algorithms/liquidate', () => ({
  liquidateInputHoldings: vi.fn(),
}));
vi.mock('../../src/swap/algorithms/destination', () => ({
  determineDestinationSwaps: vi.fn(),
  destinationSwapWithExactIn: vi.fn(),
  destinationGasSwapExactIn: vi.fn(),
}));
// B1 EXACT_OUT native-family reserve cap: keep it a fixed value (no RPC) so the deducted-native
// assertions are deterministic. Default 0.001 ETH; tests override per case.
vi.mock('../../src/services/swap-native-reserve-fee', () => ({
  estimateRepresentativeSwapNativeReserveFee: vi.fn().mockResolvedValue(1_000_000_000_000_000n),
}));
import { determineSwapRoute, resolveWalletDecisions, type RouteOptions } from '../../src/swap/route';
import { createSwapIntent } from '../../src/swap/intent';
import { predictSafeAccountAddress } from '../../src/swap/safe/predict';
import { SwapMode } from '../../src/swap/types';
import type {
  OraclePriceResponse,
  PublicClientList,
  SwapData,
  WalletPath,
} from '../../src/swap/types';
import type { QuoteResponse, Aggregator } from '../../src/swap/aggregators/types';
import { QuoteSeriousness, QuoteType } from '../../src/swap/aggregators/types';
import type { ChainListType, TokenInfo } from '../../src/domain';
import { ZERO_ADDRESS } from '../../src/domain/constants/addresses';
import { EADDRESS } from '../../src/swap/constants';
import { autoSelectSources, selectDirectDestinationSwaps } from '../../src/swap/algorithms/auto-select';
import { liquidateInputHoldings } from '../../src/swap/algorithms/liquidate';
import { destinationGasSwapExactIn, determineDestinationSwaps, destinationSwapWithExactIn } from '../../src/swap/algorithms/destination';
import { CurrencyID } from '../../src/swap/cot';
import { estimateRepresentativeSwapNativeReserveFee } from '../../src/services/swap-native-reserve-fee';
import { equalFold } from '../../src/services/strings';
import {
  ARB_CHAIN,
  BASE_CHAIN,
  OP_CHAIN,
  EPHEMERAL_EXECUTOR,
  USDC_ARB,
  USDC_BASE,
  USDC_OP,
  USDT_ARB,
  USDT_OP,
  USDT_BASE,
  DAI,
  WETH,
  makeDstTokenInfo,
  makePublicClientList,
  makeSwapChainList,
  makeSwapChainListWithUsdtCot,
} from '../helpers/swap';
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const makeQuoteResponse = (overrides?: Partial<QuoteResponse>): QuoteResponse => ({
  chainID: ARB_CHAIN,
  quote: {
    input: { contractAddress: WETH, amount: '1.0', amountRaw: 1000000000000000000n, decimals: 18, value: 3000, symbol: 'WETH' },
    output: { contractAddress: USDC_ARB, amount: '3000', amountRaw: 3000000000n, decimals: 6, value: 3000, symbol: 'USDC' },
    txData: {
      approvalAddress: '0x1111111111111111111111111111111111111111' as Hex,
      tx: { to: '0x2222222222222222222222222222222222222222' as Hex, data: '0xabcdef' as Hex, value: '0x0' as Hex },
    },
  },
  holding: { chainID: ARB_CHAIN, tokenAddress: WETH, amountRaw: 1000000000000000000n, decimals: 18, symbol: 'WETH' },
  aggregator: {} as Aggregator,
  ...overrides,
});
const makeDestinationQuoteResponse = (overrides?: Partial<QuoteResponse>): QuoteResponse => ({
  chainID: ARB_CHAIN,
  quote: {
    input: { contractAddress: USDC_ARB, amount: '3100', amountRaw: 3100000000n, decimals: 6, value: 3100, symbol: 'USDC' },
    output: { contractAddress: WETH, amount: '1.0', amountRaw: 1000000000000000000n, decimals: 18, value: 3000, symbol: 'WETH' },
    txData: {
      approvalAddress: '0x1111111111111111111111111111111111111111' as Hex,
      tx: { to: '0x2222222222222222222222222222222222222222' as Hex, data: '0xabcdef' as Hex, value: '0x0' as Hex },
    },
  },
  holding: { chainID: ARB_CHAIN, tokenAddress: USDC_ARB, amountRaw: 3100000000n, decimals: 6, symbol: 'WETH' },
  aggregator: {} as Aggregator,
  ...overrides,
});
const makeGasQuoteResponse = (overrides?: {
  chainID?: number;
  inputAmountRaw?: bigint;
  inputAmount?: string;
  outputAmountRaw?: bigint;
  outputAmount?: string;
  inputContract?: Hex;
}): QuoteResponse => {
  const chainID = overrides?.chainID ?? BASE_CHAIN;
  const inputAmountRaw = overrides?.inputAmountRaw ?? 25_000_000n;
  const inputAmount = overrides?.inputAmount ?? '25';
  const outputAmountRaw = overrides?.outputAmountRaw ?? 10_000_000_000_000_000n;
  const outputAmount = overrides?.outputAmount ?? '0.01';
  const inputContract = overrides?.inputContract ?? USDC_BASE;
  return {
    chainID,
    quote: {
      input: { contractAddress: inputContract, amount: inputAmount, amountRaw: inputAmountRaw, decimals: 6, value: Number(inputAmount), symbol: 'USDC' },
      output: { contractAddress: EADDRESS, amount: outputAmount, amountRaw: outputAmountRaw, decimals: 18, value: Number(inputAmount), symbol: 'ETH' },
      txData: {
        approvalAddress: '0x1111111111111111111111111111111111111111' as Hex,
        tx: { to: '0x2222222222222222222222222222222222222222' as Hex, data: '0xabcdef' as Hex, value: '0x0' as Hex },
      },
    },
    holding: { chainID, tokenAddress: inputContract, amountRaw: inputAmountRaw, decimals: 6, symbol: 'USDC' },
    aggregator: {} as Aggregator,
  };
};
const makeBridgeQuoteResponse = () => ({
  fulfillmentBps: 0,
  sources: [
    {
      chainId: ARB_CHAIN,
      tokenAddress: USDC_ARB,
      depositFeeUsd: '0',
      depositFeeToken: '0',
    },
    {
      chainId: OP_CHAIN,
      tokenAddress: USDC_OP,
      depositFeeUsd: '0',
      depositFeeToken: '0',
    },
  ],
  destination: {
    chainId: BASE_CHAIN,
    tokenAddress: USDC_BASE,
    fulfillmentFeeUsd: '0',
    fulfillmentFeeToken: '0',
  },
});
const mockOraclePrices: OraclePriceResponse = [] as OraclePriceResponse;
const mockAggregators: Aggregator[] = [{
  supportsChain: () => true,
  getQuotes: vi.fn().mockResolvedValue([]),
}];

const mockMiddleware = {
  getBridgeProvider: vi.fn().mockResolvedValue({ provider: 'nexus' }),
  getMayanQuotes: vi.fn(),
};

const makeRouteOptions = (overrides?: Partial<RouteOptions>): RouteOptions => ({
  aggregators: mockAggregators,
  bridgeQuoteResponse: makeBridgeQuoteResponse() as never,
  chainList: makeSwapChainList() as unknown as ChainListType,
  cotCurrencyId: CurrencyID.USDC,
  middlewareClient: mockMiddleware as never,
  publicClientList: makePublicClientList() as unknown as PublicClientList,
  oraclePrices: mockOraclePrices,
  dstTokenInfo: makeDstTokenInfo(),
  eoaAddress: '0xaaaa' as Hex,
  ephemeralAddress: EPHEMERAL_EXECUTOR,
  balances: [],
  walletPathHints: new Map([
    [ARB_CHAIN, 'ephemeral'],
    [BASE_CHAIN, 'ephemeral'],
  ]),
  quoteAddressHints: new Map([
    [ARB_CHAIN, EPHEMERAL_EXECUTOR],
    [BASE_CHAIN, EPHEMERAL_EXECUTOR],
  ]),
  forceMayan: false,
  ...overrides,
});
// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('resolveWalletDecisions', () => {
  it('passes through per-chain wallet path hints', () => {
    const decision = resolveWalletDecisions({
      sourceChainIds: [ARB_CHAIN, BASE_CHAIN],
      walletPathHints: new Map<number, WalletPath>([
        [ARB_CHAIN, 'ephemeral'],
        [BASE_CHAIN, 'safe'],
      ]),
    });
    expect(decision.sourceExecutionPaths.get(ARB_CHAIN)).toBe('ephemeral');
    expect(decision.sourceExecutionPaths.get(BASE_CHAIN)).toBe('safe');
  });
  it('defaults missing hints to "ephemeral"', () => {
    const decision = resolveWalletDecisions({
      sourceChainIds: [ARB_CHAIN],
      walletPathHints: new Map<number, WalletPath>(),
    });
    expect(decision.sourceExecutionPaths.get(ARB_CHAIN)).toBe('ephemeral');
  });
});
describe('determineSwapRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Path A EXACT_OUT selection is mocked per-test; default it to "found nothing" so that
    // default-flow tests whose sources happen to satisfy Path A's classifier fall through to the
    // COT flow (autoSelectSources) deterministically. mockReset clears any leaked once-queue too.
    vi.mocked(selectDirectDestinationSwaps).mockReset();
    vi.mocked(selectDirectDestinationSwaps).mockResolvedValue({ quoteResponses: [], usedCOTs: [] });
  });
  it('EXACT_OUT single-chain → bridge is null', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: ARB_CHAIN, toTokenAddress: WETH, toAmountRaw: 1000000000000000000n },
    };
    // All sources on destination chain — autoSelect returns COTs from same chain
    vi.mocked(autoSelectSources).mockResolvedValue({
      quoteResponses: [],
      usedCOTs: [{ holding: { chainID: ARB_CHAIN, tokenAddress: USDC_ARB, amountRaw: 3255000000n, decimals: 6, symbol: 'USDC' }, amountUsed: new Decimal('3255'), idx: 0 }],
    });
    // determineDestinationSwaps returns QuoteResponse | null
    vi.mocked(determineDestinationSwaps).mockResolvedValue(
      makeDestinationQuoteResponse({ chainID: ARB_CHAIN }),
    );
    const route = await determineSwapRoute(
      input,
      makeRouteOptions({
        balances: [{ amount: '3100', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_ARB, value: 3100, logo: '', name: 'USDC' }],
        
      })
    );
    expect(route.type).toBe(SwapMode.EXACT_OUT);
    expect(route.bridge).toBeNull();
    expect(route.destination.chainId).toBe(ARB_CHAIN);
  });
  it('EXACT_OUT toToken=COT removes the dst-chain toToken from autoSelect holdings', async () => {
    // Regression: when toToken IS the destination COT (USDC on ARB), the dst-chain USDC
    // balance was retained as a swap source, so autoSelect would "use" it to cover the
    // requirement — double-counting the user's existing tokens against funding they
    // expected to receive on top. The dst-chain toToken must always be excluded from
    // sources when toAmountRaw > 0n, regardless of whether it equals COT.
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: ARB_CHAIN, toTokenAddress: USDC_ARB, toAmountRaw: 5_000_000n },
    };
    vi.mocked(autoSelectSources).mockResolvedValue({
      quoteResponses: [],
      usedCOTs: [
        {
          holding: { chainID: BASE_CHAIN, tokenAddress: USDC_BASE, amountRaw: 100_000_000n, decimals: 6, symbol: 'USDC' },
          amountUsed: new Decimal('100'),
          idx: 0,
        },
      ],
    });
    await determineSwapRoute(
      input,
      makeRouteOptions({
        dstTokenInfo: makeDstTokenInfo({ contractAddress: USDC_ARB, decimals: 6, symbol: 'USDC', name: 'USD Coin' }),
        balances: [
          { amount: '3', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_ARB, value: 3, logo: '', name: 'USDC' },
          { amount: '100', chainID: BASE_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_BASE, value: 100, logo: '', name: 'USDC' },
        ],
      })
    );
    expect(autoSelectSources).toHaveBeenCalledOnce();
    const { holdings } = vi.mocked(autoSelectSources).mock.calls[0][0];
    const dstChainHolding = holdings.find(
      (h) => h.chainID === ARB_CHAIN && equalFold(h.tokenAddress, USDC_ARB)
    );
    expect(dstChainHolding).toBeUndefined();
    expect(holdings.some((h) => h.chainID === BASE_CHAIN)).toBe(true);
  });
  it('EXACT_OUT toAmountRaw < 0n reserves abs(value) of dst toToken from autoSelect holdings', async () => {
    // Negative sentinel — surplus / reservation. The dst-chain toToken stays in the
    // holdings pool but with `reserveAmount` subtracted from the available amount, so
    // any remainder above the reservation is usable as a swap source while the reserved
    // portion is preserved for the downstream execute step.
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: {
        toChainId: ARB_CHAIN,
        toTokenAddress: USDC_ARB,
        toAmountRaw: -3_000_000n,
        toNativeAmountRaw: 1_000_000_000_000_000n,
      },
    };
    vi.mocked(autoSelectSources).mockResolvedValue({
      quoteResponses: [],
      usedCOTs: [
        {
          holding: { chainID: ARB_CHAIN, tokenAddress: USDC_ARB, amountRaw: 2_000_000n, decimals: 6, symbol: 'USDC' },
          amountUsed: new Decimal('2'),
          idx: 0,
        },
      ],
    });
    vi.mocked(destinationGasSwapExactIn).mockResolvedValue(
      makeGasQuoteResponse({
        chainID: ARB_CHAIN,
        inputContract: USDC_ARB,
        inputAmountRaw: 0n,
        inputAmount: '0',
      })
    );
    await determineSwapRoute(
      input,
      makeRouteOptions({
        dstTokenInfo: makeDstTokenInfo({ contractAddress: USDC_ARB, decimals: 6, symbol: 'USDC', name: 'USD Coin' }),
        oraclePrices: [
          { universe: 'EVM', chainId: ARB_CHAIN, priceUsd: new Decimal('2500'), tokenAddress: ZERO_ADDRESS, tokenSymbol: 'ETH', tokenDecimals: 18, timestamp: 0 },
          { universe: 'EVM', chainId: ARB_CHAIN, priceUsd: new Decimal('1'), tokenAddress: USDC_ARB, tokenSymbol: 'USDC', tokenDecimals: 6, timestamp: 0 },
        ],
        balances: [
          { amount: '5', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_ARB, value: 5, logo: '', name: 'USDC' },
        ],
      })
    );
    expect(autoSelectSources).toHaveBeenCalledOnce();
    const { holdings } = vi.mocked(autoSelectSources).mock.calls[0][0];
    const dstChainHolding = holdings.find(
      (h) => h.chainID === ARB_CHAIN && equalFold(h.tokenAddress, USDC_ARB)
    );
    expect(dstChainHolding).toBeDefined();
    // Started at 5 USDC, reserved 3 → 2 USDC remaining as swap source.
    expect(dstChainHolding!.amountRaw).toBe(2_000_000n);
  });
  it('EXACT_OUT cross-chain → bridge populated', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: BASE_CHAIN, toTokenAddress: WETH, toAmountRaw: 1000000000000000000n },
    };
    // Source on ARB, destination on BASE → bridge needed
    vi.mocked(autoSelectSources).mockResolvedValue({
      quoteResponses: [
        makeQuoteResponse({
          quote: {
            input: { contractAddress: WETH, amount: '0.5', amountRaw: 500000000000000000n, decimals: 18, value: 1500, symbol: 'WETH' },
            output: { contractAddress: USDC_ARB, amount: '3103', amountRaw: 3103000000n, decimals: 6, value: 3103, symbol: 'USDC' },
            txData: {
              approvalAddress: '0x1111111111111111111111111111111111111111' as Hex,
              tx: { to: '0x2222222222222222222222222222222222222222' as Hex, data: '0xabcdef' as Hex, value: '0x0' as Hex },
            },
          },
        }),
      ],
      usedCOTs: [],
    });
    // determineDestinationSwaps returns QuoteResponse | null
    vi.mocked(determineDestinationSwaps).mockResolvedValue(
      makeDestinationQuoteResponse({ chainID: BASE_CHAIN }),
    );
    const route = await determineSwapRoute(
      input,
      makeRouteOptions({
        balances: [{ amount: '0.5', chainID: ARB_CHAIN, decimals: 18, symbol: 'WETH', tokenAddress: WETH, value: 1500, logo: '', name: 'WETH' }],
      })
    );
    expect(route.type).toBe(SwapMode.EXACT_OUT);
    expect(route.bridge).not.toBeNull();
    expect(route.bridge!.assets.length).toBeGreaterThan(0);
    // EXACT_OUT reclaim: bridge source actuals so every chain's extra (buffer + realized slippage)
    // consolidates at the destination (returned there by a single direct transfer at execution time).
    expect(route.source.reclaimFromActualBalance).toBe(true);
  });
  it('EXACT_OUT cross-chain with toNativeAmount quotes a gas swap and sizes bridge gas off it', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: {
        toChainId: BASE_CHAIN,
        toTokenAddress: WETH,
        toAmountRaw: 1000000000000000000n,
        toNativeAmountRaw: 10000000000000000n,
      },
    };
    vi.mocked(autoSelectSources).mockResolvedValue({
      quoteResponses: [
        makeQuoteResponse({
          quote: {
            input: {
              contractAddress: WETH,
              amount: '1.1',
              amountRaw: 1100000000000000000n,
              decimals: 18,
              value: 3300,
              symbol: 'WETH',
            },
            output: {
              contractAddress: USDC_ARB,
              amount: '3300',
              amountRaw: 3300000000n,
              decimals: 6,
              value: 3300,
              symbol: 'USDC',
            },
            txData: {
              approvalAddress: '0x1111111111111111111111111111111111111111' as Hex,
              tx: {
                to: '0x2222222222222222222222222222222222222222' as Hex,
                data: '0xabcdef' as Hex,
                value: '0x0' as Hex,
              },
            },
          },
        }),
      ],
      usedCOTs: [],
    });
    vi.mocked(determineDestinationSwaps).mockResolvedValue(
      makeDestinationQuoteResponse({ chainID: BASE_CHAIN })
    );
    vi.mocked(destinationGasSwapExactIn).mockResolvedValue(
      makeGasQuoteResponse({
        chainID: BASE_CHAIN,
        inputAmountRaw: 22_000_000n,
        inputAmount: '22',
        outputAmountRaw: 10_000_000_000_000_000n,
        outputAmount: '0.01',
        inputContract: USDC_BASE,
      })
    );
    const route = await determineSwapRoute(
      input,
      makeRouteOptions({
        oraclePrices: [
          {
            universe: 'EVM',
            chainId: BASE_CHAIN,
            priceUsd: new Decimal('2500'),
            tokenAddress: ZERO_ADDRESS,
            tokenSymbol: 'ETH',
            tokenDecimals: 18,
            timestamp: 0,
          },
          {
            universe: 'EVM',
            chainId: BASE_CHAIN,
            priceUsd: new Decimal('1'),
            tokenAddress: USDC_BASE,
            tokenSymbol: 'USDC',
            tokenDecimals: 6,
            timestamp: 0,
          },
        ],
        balances: [
          {
            amount: '1.1',
            chainID: ARB_CHAIN,
            decimals: 18,
            symbol: 'WETH',
            tokenAddress: WETH,
            value: 3300,
            logo: '',
            name: 'WETH'
          },
        ],
      })
    );
    expect(route.bridge).not.toBeNull();
    expect(route.destination.swap.gasSwap).not.toBeNull();
    expect(route.destination.swap.gasSwap?.quote.input.amountRaw).toBe(22_000_000n);
    expect(route.destination.swap.gasSwap?.quote.output.amountRaw).toBe(10_000_000_000_000_000n);
    // Bridge gas is sized off the gas swap's actual COT input (not oracle-derived).
    expect(route.bridge?.amounts.gasInCot.toString()).toBe('22');
    expect(
      route.bridge?.amounts.tokenAmount.plus(route.bridge.amounts.gasInCot).eq(
        route.bridge.amounts.totalAmount
      )
    ).toBe(true);
  });
  it('fails closed when cross-chain routing needs a bridge quote and none is available', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: BASE_CHAIN, toTokenAddress: WETH, toAmountRaw: 1000000000000000000n },
    };
    vi.mocked(autoSelectSources).mockResolvedValue({
      quoteResponses: [
        makeQuoteResponse({
          chainID: ARB_CHAIN,
          quote: {
            input: {
              contractAddress: WETH,
              amount: '0.5',
              amountRaw: 500000000000000000n,
              decimals: 18,
              value: 1500,
              symbol: 'WETH',
            },
            output: {
              contractAddress: USDC_ARB,
              amount: '3103',
              amountRaw: 3103000000n,
              decimals: 6,
              value: 3103,
              symbol: 'USDC',
            },
            txData: {
              approvalAddress: '0x1111111111111111111111111111111111111111' as Hex,
              tx: {
                to: '0x2222222222222222222222222222222222222222' as Hex,
                data: '0xabcdef' as Hex,
                value: '0x0' as Hex,
              },
            },
          },
        }),
      ],
      usedCOTs: [],
    });
    vi.mocked(determineDestinationSwaps).mockResolvedValue(
      makeDestinationQuoteResponse({ chainID: BASE_CHAIN })
    );
    await expect(
      determineSwapRoute(
        input,
        {
          ...makeRouteOptions({
            balances: [
              {
                amount: '0.5',
                chainID: ARB_CHAIN,
                decimals: 18,
                symbol: 'WETH',
                tokenAddress: WETH,
                value: 1500,
                logo: '',
                name: 'WETH',
              },
            ],
          }),
          bridgeQuoteResponse: null,
        } as never
      )
    ).rejects.toThrow(/bridge fee quote unavailable/i);
  });
  it('EXACT_IN liquidates non-COT holdings', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_IN,
      data: {
        sources: [{ chainId: ARB_CHAIN, tokenAddress: WETH, amountRaw: 1000000000000000000n }],
        toChainId: ARB_CHAIN,
        toTokenAddress: USDC_ARB,
      },
    };
    vi.mocked(liquidateInputHoldings).mockResolvedValue([makeQuoteResponse()]);
    vi.mocked(destinationSwapWithExactIn).mockResolvedValue(null);
    const route = await determineSwapRoute(input, makeRouteOptions({
      balances: [{ amount: '1', chainID: ARB_CHAIN, decimals: 18, symbol: 'WETH', tokenAddress: WETH, value: 3000, logo: '', name: 'WETH' }],
      dstTokenInfo: makeDstTokenInfo({ contractAddress: USDC_ARB, decimals: 6, symbol: 'USDC', name: 'USD Coin' }),
    }));
    expect(route.type).toBe(SwapMode.EXACT_IN);
    expect(route.source.swaps).toHaveLength(1);
    expect(liquidateInputHoldings).toHaveBeenCalled();
    // EXACT_IN has no source buffer: a failed leg re-quotes and proceeds with no drift guard.
    expect(route.source.srcBuffer).toBeNull();
    // No buffer to surface in the intent.
    expect(route.buffer.amount).toBe('0');
  });
  it('EXACT_IN same-family non-COT sources bridge directly with no swaps (USDT→USDT)', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_IN,
      data: {
        sources: [
          { chainId: ARB_CHAIN, tokenAddress: USDT_ARB, amountRaw: 1_000_000n },
          { chainId: OP_CHAIN, tokenAddress: USDT_OP, amountRaw: 1_000_000n },
        ],
        toChainId: BASE_CHAIN,
        toTokenAddress: USDT_BASE,
      },
    };
    // COT-path mocks present so a non-firing fast-path still completes the route — that
    // surfaces a clean assertion failure here instead of a crash.
    vi.mocked(liquidateInputHoldings).mockResolvedValue([makeQuoteResponse({ chainID: ARB_CHAIN })]);
    vi.mocked(destinationSwapWithExactIn).mockResolvedValue(makeDestinationQuoteResponse());

    const route = await determineSwapRoute(
      input,
      makeRouteOptions({
        balances: [
          { amount: '1', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDT', tokenAddress: USDT_ARB, value: 1, logo: '', name: 'Tether USD' },
          { amount: '1', chainID: OP_CHAIN, decimals: 6, symbol: 'USDT', tokenAddress: USDT_OP, value: 1, logo: '', name: 'Tether USD' },
        ],
        dstTokenInfo: makeDstTokenInfo({ contractAddress: USDT_BASE, decimals: 6, symbol: 'USDT', name: 'Tether USD' }),
      })
    );

    // Pure bridge: no source liquidation, no destination swap.
    expect(liquidateInputHoldings).not.toHaveBeenCalled();
    expect(route.source.swaps).toHaveLength(0);
    expect(route.destination.swap.tokenSwap).toBeNull();
    // Bridge delivers the destination token (USDT) directly.
    expect(route.bridge).not.toBeNull();
    expect(equalFold(route.bridge!.tokenAddress, USDT_BASE)).toBe(true);
    expect(route.bridge!.assets).toHaveLength(2);
    // Same-token fast path: settles in the USDT family and is flagged so the failure sweep can skip.
    expect(route.sameTokenBridge).toBe(true);
    expect(route.settlementCurrencyId).toBe(CurrencyID.USDT);
  });
  it('EXACT_IN same-token: dst-chain source stays at the EOA and is not bridged', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_IN,
      data: {
        sources: [
          { chainId: ARB_CHAIN, tokenAddress: USDT_ARB, amountRaw: 1_000_000n },
          { chainId: BASE_CHAIN, tokenAddress: USDT_BASE, amountRaw: 2_000_000n },
        ],
        toChainId: BASE_CHAIN,
        toTokenAddress: USDT_BASE,
      },
    };
    const route = await determineSwapRoute(
      input,
      makeRouteOptions({
        balances: [
          { amount: '1', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDT', tokenAddress: USDT_ARB, value: 1, logo: '', name: 'Tether USD' },
          { amount: '2', chainID: BASE_CHAIN, decimals: 6, symbol: 'USDT', tokenAddress: USDT_BASE, value: 2, logo: '', name: 'Tether USD' },
        ],
        dstTokenInfo: makeDstTokenInfo({ contractAddress: USDT_BASE, decimals: 6, symbol: 'USDT', name: 'Tether USD' }),
      })
    );
    // Only the off-chain (ARB) source is bridged; the BASE source already sits at the EOA.
    expect(route.bridge!.assets).toHaveLength(1);
    expect(route.bridge!.assets[0].chainID).toBe(ARB_CHAIN);
    // Delivered = bridged ARB (1, fees 0) + dst-chain BASE (2) = 3.
    expect(route.destination.inputAmount.min.toFixed()).toBe('3');
  });
  it('B1 EXACT_OUT same-family non-COT sources bridge directly with no swaps (USDT→USDT)', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: {
        sources: [
          { chainId: ARB_CHAIN, tokenAddress: USDT_ARB },
          { chainId: OP_CHAIN, tokenAddress: USDT_OP },
        ],
        toChainId: BASE_CHAIN,
        toTokenAddress: USDT_BASE,
        toAmountRaw: 1_500_000n, // 1.5 USDT
      },
    };
    // The dst-COT sizing quote (USDC→USDT) runs before the gate; B1 discards it when it fires.
    vi.mocked(determineDestinationSwaps).mockResolvedValue(makeDestinationQuoteResponse({ chainID: BASE_CHAIN }));
    // B1 fetches its OWN F-denominated bridge-fee quote (never the preflight USDC quote).
    const getQuote = vi.fn().mockResolvedValue(makeBridgeQuoteResponse());
    const route = await determineSwapRoute(
      input,
      makeRouteOptions({
        chainList: makeSwapChainListWithUsdtCot(),
        middlewareClient: { ...mockMiddleware, getQuote } as never,
        balances: [
          { amount: '1', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDT', tokenAddress: USDT_ARB, value: 1, logo: '', name: 'Tether USD' },
          { amount: '1', chainID: OP_CHAIN, decimals: 6, symbol: 'USDT', tokenAddress: USDT_OP, value: 1, logo: '', name: 'Tether USD' },
        ],
        dstTokenInfo: makeDstTokenInfo({ contractAddress: USDT_BASE, decimals: 6, symbol: 'USDT', name: 'Tether USD' }),
      })
    );

    // Pure bridge: no autoSelect, no swaps, no dst swap.
    expect(autoSelectSources).not.toHaveBeenCalled();
    expect(route.source.swaps).toHaveLength(0);
    expect(route.destination.swap.tokenSwap).toBeNull();
    expect(route.type).toBe(SwapMode.EXACT_OUT);
    // Same-token fast path: settles in the USDT family and is flagged so the failure sweep can skip.
    expect(route.sameTokenBridge).toBe(true);
    expect(route.settlementCurrencyId).toBe(CurrencyID.USDT);
    // Bridge delivers exactly toAmount (1.5 USDT); the quote has zero fees so gross == delivered.
    expect(equalFold(route.bridge!.tokenAddress, USDT_BASE)).toBe(true);
    expect(route.bridge!.amounts.tokenAmount.toString()).toBe('1.5');
    expect(route.destination.inputAmount.min.toString()).toBe('1.5');
    expect(route.destination.inputAmount.max.toString()).toBe('1.5');
    // The F-quote was fetched via getQuote.
    expect(getQuote).toHaveBeenCalled();
  });
  it('B1 EXACT_OUT grosses up the exact target through the bridge fee (inversion)', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: {
        sources: [{ chainId: ARB_CHAIN, tokenAddress: USDT_ARB }],
        toChainId: BASE_CHAIN,
        toTokenAddress: USDT_BASE,
        toAmountRaw: 1_000_000n, // 1 USDT
      },
    };
    vi.mocked(determineDestinationSwaps).mockResolvedValue(makeDestinationQuoteResponse({ chainID: BASE_CHAIN }));
    // 1% protocol bps + a 0.01 USDT fixed fulfilment fee → gross = (1 + 0.01) / (1 − 0.01).
    const base = makeBridgeQuoteResponse();
    const getQuote = vi.fn().mockResolvedValue({
      ...base,
      fulfillmentBps: 100,
      destination: { ...base.destination, fulfillmentFeeToken: '10000' },
    });
    const route = await determineSwapRoute(input, makeRouteOptions({
      chainList: makeSwapChainListWithUsdtCot(),
      middlewareClient: { ...mockMiddleware, getQuote } as never,
      balances: [{ amount: '5', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDT', tokenAddress: USDT_ARB, value: 5, logo: '', name: 'Tether USD' }],
      dstTokenInfo: makeDstTokenInfo({ contractAddress: USDT_BASE, decimals: 6, symbol: 'USDT', name: 'Tether USD' }),
    }));
    const gross = new Decimal('1.01').div(new Decimal('0.99'));
    // Delivery stays exact; the gross-up covers the fee so delivered == toAmount.
    expect(route.bridge!.amounts.tokenAmount.toString()).toBe('1');
    expect(route.bridge!.amount.toString()).toBe(gross.toString());
    expect(route.bridge!.assets).toHaveLength(1);
    expect(route.bridge!.assets[0].eoaBalance.toString()).toBe(gross.toString());
  });
  it('B1 EXACT_OUT splits the grossed-up target greedily across family chains', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: {
        sources: [
          { chainId: ARB_CHAIN, tokenAddress: USDT_ARB },
          { chainId: OP_CHAIN, tokenAddress: USDT_OP },
        ],
        toChainId: BASE_CHAIN,
        toTokenAddress: USDT_BASE,
        toAmountRaw: 3_000_000n, // 3 USDT, zero fees → gross 3
      },
    };
    vi.mocked(determineDestinationSwaps).mockResolvedValue(makeDestinationQuoteResponse({ chainID: BASE_CHAIN }));
    const getQuote = vi.fn().mockResolvedValue(makeBridgeQuoteResponse());
    const route = await determineSwapRoute(input, makeRouteOptions({
      chainList: makeSwapChainListWithUsdtCot(),
      middlewareClient: { ...mockMiddleware, getQuote } as never,
      balances: [
        { amount: '2', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDT', tokenAddress: USDT_ARB, value: 2, logo: '', name: 'Tether USD' },
        { amount: '2', chainID: OP_CHAIN, decimals: 6, symbol: 'USDT', tokenAddress: USDT_OP, value: 2, logo: '', name: 'Tether USD' },
      ],
      dstTokenInfo: makeDstTokenInfo({ contractAddress: USDT_BASE, decimals: 6, symbol: 'USDT', name: 'Tether USD' }),
    }));
    // ARB fully consumed (2), OP partially (1) → covers gross 3.
    expect(route.bridge!.assets).toHaveLength(2);
    expect(route.bridge!.assets.find((a) => a.chainID === ARB_CHAIN)!.eoaBalance.toString()).toBe('2');
    expect(route.bridge!.assets.find((a) => a.chainID === OP_CHAIN)!.eoaBalance.toString()).toBe('1');
  });
  it('B1 EXACT_OUT falls back to the COT flow when the F-quote is unavailable', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { sources: [{ chainId: ARB_CHAIN, tokenAddress: USDT_ARB }], toChainId: BASE_CHAIN, toTokenAddress: USDT_BASE, toAmountRaw: 1_000_000n },
    };
    vi.mocked(determineDestinationSwaps).mockResolvedValue(makeDestinationQuoteResponse({ chainID: BASE_CHAIN }));
    // COT-fallback mocks so the fell-through route completes (covering usedCOTs).
    vi.mocked(autoSelectSources).mockResolvedValue({
      quoteResponses: [],
      usedCOTs: [{ holding: { chainID: BASE_CHAIN, tokenAddress: USDC_BASE, amountRaw: 100_000_000n, decimals: 6, symbol: 'USDC' }, amountUsed: new Decimal('3255'), idx: 0 }],
    });
    const getQuote = vi.fn().mockResolvedValue(null); // F-quote fails → builder throws → fallback
    const route = await determineSwapRoute(input, makeRouteOptions({
      chainList: makeSwapChainListWithUsdtCot(),
      middlewareClient: { ...mockMiddleware, getQuote } as never,
      balances: [{ amount: '5', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDT', tokenAddress: USDT_ARB, value: 5, logo: '', name: 'Tether USD' }],
      dstTokenInfo: makeDstTokenInfo({ contractAddress: USDT_BASE, decimals: 6, symbol: 'USDT', name: 'Tether USD' }),
    }));
    expect(route.sameTokenBridge).toBe(false);
    expect(autoSelectSources).toHaveBeenCalled();
  });
  it('B1 EXACT_OUT falls back when family holdings cannot cover the grossed-up target', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { sources: [{ chainId: ARB_CHAIN, tokenAddress: USDT_ARB }], toChainId: BASE_CHAIN, toTokenAddress: USDT_BASE, toAmountRaw: 5_000_000n },
    };
    vi.mocked(determineDestinationSwaps).mockResolvedValue(makeDestinationQuoteResponse({ chainID: BASE_CHAIN }));
    vi.mocked(autoSelectSources).mockResolvedValue({
      quoteResponses: [],
      usedCOTs: [{ holding: { chainID: BASE_CHAIN, tokenAddress: USDC_BASE, amountRaw: 100_000_000n, decimals: 6, symbol: 'USDC' }, amountUsed: new Decimal('3255'), idx: 0 }],
    });
    const getQuote = vi.fn().mockResolvedValue(makeBridgeQuoteResponse());
    const route = await determineSwapRoute(input, makeRouteOptions({
      chainList: makeSwapChainListWithUsdtCot(),
      middlewareClient: { ...mockMiddleware, getQuote } as never,
      balances: [{ amount: '1', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDT', tokenAddress: USDT_ARB, value: 1, logo: '', name: 'Tether USD' }],
      dstTokenInfo: makeDstTokenInfo({ contractAddress: USDT_BASE, decimals: 6, symbol: 'USDT', name: 'Tether USD' }),
    }));
    expect(route.sameTokenBridge).toBe(false);
    expect(autoSelectSources).toHaveBeenCalled();
  });
  it('B1 EXACT_OUT (native/ETH family) caps each source at balance − native reserve', async () => {
    // 1 ETH balance, 0.001 ETH reserve → 0.999 usable; target 0.999 forces the FULL reserve-adjusted
    // balance to bridge, proving the reserve was deducted (a naive walk would bridge 1.0).
    const chainList = makeSwapChainList();
    const nativeToken = { contractAddress: EADDRESS, decimals: 18, symbol: 'ETH', name: 'Ether', logo: '', currencyId: CurrencyID.ETH };
    chainList.getNativeToken = vi.fn().mockReturnValue(nativeToken);
    const origById = chainList.getTokenByCurrencyId;
    chainList.getTokenByCurrencyId = vi.fn().mockImplementation((c: number, id: number) =>
      id === CurrencyID.ETH ? { ...nativeToken, mayanEnabled: true } : origById(c, id));
    vi.mocked(estimateRepresentativeSwapNativeReserveFee).mockResolvedValue(1_000_000_000_000_000n); // 0.001 ETH
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { sources: [{ chainId: ARB_CHAIN, tokenAddress: EADDRESS }], toChainId: BASE_CHAIN, toTokenAddress: EADDRESS, toAmountRaw: 999n * 10n ** 15n }, // 0.999 ETH
    };
    vi.mocked(determineDestinationSwaps).mockResolvedValue(makeDestinationQuoteResponse({ chainID: BASE_CHAIN }));
    const getQuote = vi.fn().mockResolvedValue(makeBridgeQuoteResponse());
    const route = await determineSwapRoute(input, makeRouteOptions({
      chainList,
      middlewareClient: { ...mockMiddleware, getQuote } as never,
      balances: [{ amount: '1', chainID: ARB_CHAIN, decimals: 18, symbol: 'ETH', tokenAddress: EADDRESS, value: 3000, logo: '', name: 'Ether' }],
      dstTokenInfo: makeDstTokenInfo({ contractAddress: EADDRESS, decimals: 18, symbol: 'ETH', name: 'Ether' }),
    }));
    expect(estimateRepresentativeSwapNativeReserveFee).toHaveBeenCalled();
    expect(route.sameTokenBridge).toBe(true);
    expect(route.settlementCurrencyId).toBe(CurrencyID.ETH);
    // Bridged == balance − reserve (0.999), and native is normalized to ZERO_ADDRESS.
    expect(route.bridge!.assets[0].eoaBalance.toString()).toBe('0.999');
    expect(equalFold(route.bridge!.assets[0].contractAddress, ZERO_ADDRESS)).toBe(true);
  });
  const mayanMiddleware = (minReceived: number, getQuote: ReturnType<typeof vi.fn>) => ({
    ...mockMiddleware,
    getBridgeProvider: vi.fn().mockResolvedValue({ provider: 'mayan' }),
    getMayanQuotes: vi.fn().mockImplementation(async (req: { sources: { chain_id: string; contract_address: Hex; amount: string }[] }) => ({
      destination: { chainId: BASE_CHAIN, tokenAddress: USDT_BASE },
      quotes: req.sources.map((s) => ({
        source: { chainId: Number(BigInt(s.chain_id)), tokenAddress: s.contract_address, amount: s.amount },
        mayanQuote: { minReceived, protocolBps: 3 },
      })),
    })),
    getQuote,
  });
  it('B1 EXACT_OUT routes through Mayan when the per-leg quotes cover the target', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { sources: [{ chainId: ARB_CHAIN, tokenAddress: USDT_ARB }], toChainId: BASE_CHAIN, toTokenAddress: USDT_BASE, toAmountRaw: 2_000_000n },
    };
    vi.mocked(determineDestinationSwaps).mockResolvedValue(makeDestinationQuoteResponse({ chainID: BASE_CHAIN }));
    const route = await determineSwapRoute(input, makeRouteOptions({
      chainList: makeSwapChainListWithUsdtCot(),
      middlewareClient: mayanMiddleware(2, vi.fn().mockResolvedValue(makeBridgeQuoteResponse())) as never,
      balances: [{ amount: '3', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDT', tokenAddress: USDT_ARB, value: 3, logo: '', name: 'Tether USD' }],
      dstTokenInfo: makeDstTokenInfo({ contractAddress: USDT_BASE, decimals: 6, symbol: 'USDT', name: 'Tether USD' }),
    }));
    expect(route.sameTokenBridge).toBe(true);
    expect(route.bridge!.provider).toBe('mayan');
    expect(route.bridge!.mayanQuotesBySource).toBeDefined();
  });
  it('B1 EXACT_OUT falls back to the COT flow when Mayan quotes undershoot the target', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { sources: [{ chainId: ARB_CHAIN, tokenAddress: USDT_ARB }], toChainId: BASE_CHAIN, toTokenAddress: USDT_BASE, toAmountRaw: 5_000_000n },
    };
    vi.mocked(determineDestinationSwaps).mockResolvedValue(makeDestinationQuoteResponse({ chainID: BASE_CHAIN }));
    vi.mocked(autoSelectSources).mockResolvedValue({
      quoteResponses: [],
      usedCOTs: [{ holding: { chainID: BASE_CHAIN, tokenAddress: USDC_BASE, amountRaw: 100_000_000n, decimals: 6, symbol: 'USDC' }, amountUsed: new Decimal('3255'), idx: 0 }],
    });
    vi.mocked(destinationSwapWithExactIn).mockResolvedValue(makeDestinationQuoteResponse({ chainID: BASE_CHAIN }));
    // Σ minReceived = 2 < toAmount 5 → B1 undershoots → fall back to the COT flow.
    const route = await determineSwapRoute(input, makeRouteOptions({
      chainList: makeSwapChainListWithUsdtCot(),
      middlewareClient: mayanMiddleware(2, vi.fn().mockResolvedValue(makeBridgeQuoteResponse())) as never,
      balances: [{ amount: '6', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDT', tokenAddress: USDT_ARB, value: 6, logo: '', name: 'Tether USD' }],
      dstTokenInfo: makeDstTokenInfo({ contractAddress: USDT_BASE, decimals: 6, symbol: 'USDT', name: 'Tether USD' }),
    }));
    expect(route.sameTokenBridge).toBe(false);
    expect(autoSelectSources).toHaveBeenCalled();
  });
  it('B2 EXACT_OUT dynamic-COT: USDT sources → WETH re-enters (allowlisted) settling in USDT, zero source swaps', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: {
        sources: [
          { chainId: ARB_CHAIN, tokenAddress: USDT_ARB },
          { chainId: OP_CHAIN, tokenAddress: USDT_OP },
        ],
        toChainId: BASE_CHAIN,
        toTokenAddress: WETH,
        toAmountRaw: 1_000_000_000_000_000_000n, // 1 WETH
      },
    };
    // Sizing quote (outer USDC→WETH, then the re-entered USDT→WETH) + autoSelect over the USDT COT.
    vi.mocked(determineDestinationSwaps).mockResolvedValue(makeDestinationQuoteResponse({ chainID: BASE_CHAIN }));
    vi.mocked(autoSelectSources).mockResolvedValue({
      quoteResponses: [],
      usedCOTs: [{ holding: { chainID: ARB_CHAIN, tokenAddress: USDT_ARB, amountRaw: 3255_000_000n, decimals: 6, symbol: 'USDT' }, amountUsed: new Decimal('3255'), idx: 0 }],
    });
    const getQuote = vi.fn().mockResolvedValue(makeBridgeQuoteResponse());
    const route = await determineSwapRoute(input, makeRouteOptions({
      chainList: makeSwapChainListWithUsdtCot(),
      middlewareClient: { ...mockMiddleware, getQuote } as never,
      balances: [
        { amount: '3255', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDT', tokenAddress: USDT_ARB, value: 3255, logo: '', name: 'Tether USD' },
        { amount: '100', chainID: OP_CHAIN, decimals: 6, symbol: 'USDT', tokenAddress: USDT_OP, value: 100, logo: '', name: 'Tether USD' },
      ],
      dstTokenInfo: makeDstTokenInfo({ contractAddress: WETH, decimals: 18, symbol: 'WETH', name: 'Wrapped Ether' }),
    }));
    // Settles in USDT; the allowlisted sources ARE the COT → autoSelect returns usedCOTs, no swaps.
    expect(route.settlementCurrencyId).toBe(CurrencyID.USDT);
    expect(route.source.swaps).toHaveLength(0);
    expect(route.destination.swap.tokenSwap).not.toBeNull();
    expect(getQuote).toHaveBeenCalled();
  });
  it('B2 EXACT_IN dynamic-COT: USDT sources → WETH re-enters settling in USDT (zero source swaps)', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_IN,
      data: {
        sources: [
          { chainId: ARB_CHAIN, tokenAddress: USDT_ARB, amountRaw: 1_000_000n },
          { chainId: OP_CHAIN, tokenAddress: USDT_OP, amountRaw: 1_000_000n },
        ],
        toChainId: BASE_CHAIN,
        toTokenAddress: WETH,
      },
    };
    // The re-entered flow (cotCurrencyId=USDT) is EXACT_IN → quotes the dst swap USDT→WETH via
    // destinationSwapWithExactIn.
    vi.mocked(destinationSwapWithExactIn).mockResolvedValue(makeDestinationQuoteResponse({ chainID: BASE_CHAIN }));
    const getQuote = vi.fn().mockResolvedValue(makeBridgeQuoteResponse());
    const route = await determineSwapRoute(input, makeRouteOptions({
      chainList: makeSwapChainListWithUsdtCot(),
      middlewareClient: { ...mockMiddleware, getQuote } as never,
      balances: [
        { amount: '1', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDT', tokenAddress: USDT_ARB, value: 1, logo: '', name: 'Tether USD' },
        { amount: '1', chainID: OP_CHAIN, decimals: 6, symbol: 'USDT', tokenAddress: USDT_OP, value: 1, logo: '', name: 'Tether USD' },
      ],
      dstTokenInfo: makeDstTokenInfo({ contractAddress: WETH, decimals: 18, symbol: 'WETH', name: 'Wrapped Ether' }),
    }));
    // Settles in USDT (the dynamic COT); the sources ARE the COT → no source-swap liquidation.
    expect(route.settlementCurrencyId).toBe(CurrencyID.USDT);
    expect(liquidateInputHoldings).not.toHaveBeenCalled();
    expect(route.source.swaps).toHaveLength(0);
    // One dst swap USDT→WETH; the F-denominated fee quote was fetched.
    expect(route.destination.swap.tokenSwap).not.toBeNull();
    expect(getQuote).toHaveBeenCalled();
  });
  it('B2 EXACT_IN falls back to the USDC COT flow when the F-quote is unavailable', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_IN,
      data: {
        sources: [
          { chainId: ARB_CHAIN, tokenAddress: USDT_ARB, amountRaw: 1_000_000n },
          { chainId: OP_CHAIN, tokenAddress: USDT_OP, amountRaw: 1_000_000n },
        ],
        toChainId: BASE_CHAIN,
        toTokenAddress: WETH,
      },
    };
    // Default (USDC) COT-flow mocks so the fell-through route completes: liquidate USDT→USDC, dst swap.
    vi.mocked(liquidateInputHoldings).mockResolvedValue([makeQuoteResponse({ chainID: ARB_CHAIN })]);
    vi.mocked(destinationSwapWithExactIn).mockResolvedValue(makeDestinationQuoteResponse({ chainID: BASE_CHAIN }));
    const getQuote = vi.fn().mockResolvedValue(null); // F-quote fails → B2 returns null → fallback
    const route = await determineSwapRoute(input, makeRouteOptions({
      chainList: makeSwapChainListWithUsdtCot(),
      middlewareClient: { ...mockMiddleware, getQuote } as never,
      balances: [
        { amount: '1', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDT', tokenAddress: USDT_ARB, value: 1, logo: '', name: 'Tether USD' },
        { amount: '1', chainID: OP_CHAIN, decimals: 6, symbol: 'USDT', tokenAddress: USDT_OP, value: 1, logo: '', name: 'Tether USD' },
      ],
      dstTokenInfo: makeDstTokenInfo({ contractAddress: WETH, decimals: 18, symbol: 'WETH', name: 'Wrapped Ether' }),
    }));
    // Default flow settles in USDC and liquidates the USDT sources.
    expect(route.settlementCurrencyId).toBe(CurrencyID.USDC);
    expect(liquidateInputHoldings).toHaveBeenCalled();
  });
  it('B2 skipFastPaths stops the re-entry recursion — dynamic-cot-eligible sources run the default COT flow', async () => {
    // The B2 re-entry sets skipFastPaths; the re-entered call must NOT re-classify (else it would loop).
    const input: SwapData = {
      mode: SwapMode.EXACT_IN,
      data: {
        sources: [
          { chainId: ARB_CHAIN, tokenAddress: USDT_ARB, amountRaw: 1_000_000n },
          { chainId: OP_CHAIN, tokenAddress: USDT_OP, amountRaw: 1_000_000n },
        ],
        toChainId: BASE_CHAIN,
        toTokenAddress: WETH,
      },
    };
    vi.mocked(liquidateInputHoldings).mockResolvedValue([makeQuoteResponse({ chainID: ARB_CHAIN })]);
    vi.mocked(destinationSwapWithExactIn).mockResolvedValue(makeDestinationQuoteResponse({ chainID: BASE_CHAIN }));
    const getQuote = vi.fn().mockResolvedValue(makeBridgeQuoteResponse());
    const route = await determineSwapRoute(input, makeRouteOptions({
      chainList: makeSwapChainListWithUsdtCot(),
      middlewareClient: { ...mockMiddleware, getQuote } as never,
      skipFastPaths: true,
      balances: [
        { amount: '1', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDT', tokenAddress: USDT_ARB, value: 1, logo: '', name: 'Tether USD' },
        { amount: '1', chainID: OP_CHAIN, decimals: 6, symbol: 'USDT', tokenAddress: USDT_OP, value: 1, logo: '', name: 'Tether USD' },
      ],
      dstTokenInfo: makeDstTokenInfo({ contractAddress: WETH, decimals: 18, symbol: 'WETH', name: 'Wrapped Ether' }),
    }));
    // No re-classification → default USDC flow, no F-quote fetched.
    expect(route.settlementCurrencyId).toBe(CurrencyID.USDC);
    expect(getQuote).not.toHaveBeenCalled();
  });
  it('EXACT_IN mixed: dst-chain SOURCE SWAP output is counted in destination amount', async () => {
    // Mirrors the reported intent: ETH on the dst chain (Base) swaps to USDC locally, while
    // USDT on another chain (ARB here; Monad in the report) bridges in. toToken IS COT (USDC),
    // so there is no destination swap. Expected delivered = local ETH→USDC (1) + bridged USDT (2).
    const input: SwapData = {
      mode: SwapMode.EXACT_IN,
      data: {
        sources: [
          { chainId: BASE_CHAIN, tokenAddress: EADDRESS, amountRaw: 593600000000000n }, // ETH on dst chain
          { chainId: ARB_CHAIN, tokenAddress: USDT_ARB, amountRaw: 2_000_000n }, // bridged source
        ],
        toChainId: BASE_CHAIN,
        toTokenAddress: USDC_BASE, // toToken IS COT → no dst swap
      },
    };
    vi.mocked(liquidateInputHoldings).mockResolvedValue([
      // dst-chain source swap: ETH → 1 USDC on BASE (≈ the $1.0005 ETH leg in the report)
      makeQuoteResponse({
        chainID: BASE_CHAIN,
        quote: {
          input: { contractAddress: EADDRESS, amount: '0.0005936', amountRaw: 593600000000000n, decimals: 18, value: 1, symbol: 'ETH' },
          output: { contractAddress: USDC_BASE, amount: '1', amountRaw: 1_000_000n, decimals: 6, value: 1, symbol: 'USDC' },
          txData: { approvalAddress: '0x1111111111111111111111111111111111111111' as Hex, tx: { to: '0x2222222222222222222222222222222222222222' as Hex, data: '0xabcdef' as Hex, value: '0x0' as Hex } },
        },
        holding: { chainID: BASE_CHAIN, tokenAddress: EADDRESS, amountRaw: 593600000000000n, decimals: 18, symbol: 'ETH' },
      }),
      // bridged source swap: USDT → 2 USDC on ARB, bridged to BASE (fees 0)
      makeQuoteResponse({
        chainID: ARB_CHAIN,
        quote: {
          input: { contractAddress: USDT_ARB, amount: '2', amountRaw: 2_000_000n, decimals: 6, value: 2, symbol: 'USDT' },
          output: { contractAddress: USDC_ARB, amount: '2', amountRaw: 2_000_000n, decimals: 6, value: 2, symbol: 'USDC' },
          txData: { approvalAddress: '0x1111111111111111111111111111111111111111' as Hex, tx: { to: '0x2222222222222222222222222222222222222222' as Hex, data: '0xabcdef' as Hex, value: '0x0' as Hex } },
        },
        holding: { chainID: ARB_CHAIN, tokenAddress: USDT_ARB, amountRaw: 2_000_000n, decimals: 6, symbol: 'USDT' },
      }),
    ]);
    const opts = makeRouteOptions({
      dstTokenInfo: makeDstTokenInfo({ contractAddress: USDC_BASE, decimals: 6, symbol: 'USDC', name: 'USD Coin' }),
      balances: [
        { amount: '0.0005936', chainID: BASE_CHAIN, decimals: 18, symbol: 'ETH', tokenAddress: EADDRESS, value: 1, logo: '', name: 'ETH' },
        { amount: '2', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDT', tokenAddress: USDT_ARB, value: 2, logo: '', name: 'Tether USD' },
      ],
    });
    const route = await determineSwapRoute(input, opts);
    const intent = createSwapIntent(route, input, opts.chainList);

    // No dst swap (toToken IS COT) → destinationDirectEoa=true → the dst-chain source swap is
    // delivered straight to the EOA. So whether this is display-only or execution hinges purely
    // on whether inputAmount includes the local 1 USDC.
    expect(route.destination.swap.tokenSwap).toBeNull();
    // Correct delivered = local ETH→USDC (1) + bridged USDT (2) = 3.
    expect(route.destination.inputAmount.min.toFixed()).toBe('3');
    expect(intent.destination.amount).toBe('3');
  });
  it('EXACT_IN mixed, toToken != COT: dst SWAP input includes the dst-chain source-swap COT', async () => {
    // Same mixed shape, but toToken = DAI (≠ COT) so a destination swap runs. destinationDirectEoa
    // is now FALSE, so the local ETH→USDC COT lands at the wrapper and must be fed into the dst
    // swap. The dst-swap input should be (local 1 + bridged 2) - srcBuffer, NOT just bridged - buffer.
    const input: SwapData = {
      mode: SwapMode.EXACT_IN,
      data: {
        sources: [
          { chainId: BASE_CHAIN, tokenAddress: EADDRESS, amountRaw: 593600000000000n }, // ETH on dst chain
          { chainId: ARB_CHAIN, tokenAddress: USDT_ARB, amountRaw: 2_000_000n }, // bridged source
        ],
        toChainId: BASE_CHAIN,
        toTokenAddress: DAI, // non-COT on the dst chain → a destination swap runs
      },
    };
    vi.mocked(liquidateInputHoldings).mockResolvedValue([
      makeQuoteResponse({
        chainID: BASE_CHAIN,
        quote: {
          input: { contractAddress: EADDRESS, amount: '0.0005936', amountRaw: 593600000000000n, decimals: 18, value: 1, symbol: 'ETH' },
          output: { contractAddress: USDC_BASE, amount: '1', amountRaw: 1_000_000n, decimals: 6, value: 1, symbol: 'USDC' },
          txData: { approvalAddress: '0x1111111111111111111111111111111111111111' as Hex, tx: { to: '0x2222222222222222222222222222222222222222' as Hex, data: '0xabcdef' as Hex, value: '0x0' as Hex } },
        },
        holding: { chainID: BASE_CHAIN, tokenAddress: EADDRESS, amountRaw: 593600000000000n, decimals: 18, symbol: 'ETH' },
      }),
      makeQuoteResponse({
        chainID: ARB_CHAIN,
        quote: {
          input: { contractAddress: USDT_ARB, amount: '2', amountRaw: 2_000_000n, decimals: 6, value: 2, symbol: 'USDT' },
          output: { contractAddress: USDC_ARB, amount: '2', amountRaw: 2_000_000n, decimals: 6, value: 2, symbol: 'USDC' },
          txData: { approvalAddress: '0x1111111111111111111111111111111111111111' as Hex, tx: { to: '0x2222222222222222222222222222222222222222' as Hex, data: '0xabcdef' as Hex, value: '0x0' as Hex } },
        },
        holding: { chainID: ARB_CHAIN, tokenAddress: USDT_ARB, amountRaw: 2_000_000n, decimals: 6, symbol: 'USDT' },
      }),
    ]);
    vi.mocked(destinationSwapWithExactIn).mockResolvedValue(makeDestinationQuoteResponse({ chainID: BASE_CHAIN }));
    const opts = makeRouteOptions({
      dstTokenInfo: makeDstTokenInfo({ contractAddress: DAI, decimals: 18, symbol: 'DAI', name: 'Dai Stablecoin' }),
      balances: [
        { amount: '0.0005936', chainID: BASE_CHAIN, decimals: 18, symbol: 'ETH', tokenAddress: EADDRESS, value: 1, logo: '', name: 'ETH' },
        { amount: '2', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDT', tokenAddress: USDT_ARB, value: 2, logo: '', name: 'Tether USD' },
      ],
    });
    const route = await determineSwapRoute(input, opts);

    // A dst swap runs → the local COT is NOT delivered direct-to-EOA; it must be swapped here.
    expect(route.destination.swap.tokenSwap).not.toBeNull();
    // No source buffer: the dst swap is quoted at the full available COT = 1 local + 2 bridged = 3.
    // The regression this guards is dropping the local 1 (which would give 2, not 3).
    expect(vi.mocked(destinationSwapWithExactIn)).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ amountRaw: 3000000n }) })
    );
  });
  it('EXACT_IN mixed family (USDT + DAI → USDT) falls back to the COT flow', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_IN,
      data: {
        sources: [
          { chainId: ARB_CHAIN, tokenAddress: USDT_ARB, amountRaw: 1_000_000n },
          { chainId: ARB_CHAIN, tokenAddress: DAI, amountRaw: 1_000_000_000_000_000_000n },
        ],
        toChainId: BASE_CHAIN,
        toTokenAddress: USDT_BASE,
      },
    };
    vi.mocked(liquidateInputHoldings).mockResolvedValue([makeQuoteResponse({ chainID: ARB_CHAIN })]);
    vi.mocked(destinationSwapWithExactIn).mockResolvedValue(makeDestinationQuoteResponse());
    const route = await determineSwapRoute(
      input,
      makeRouteOptions({
        balances: [
          { amount: '1', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDT', tokenAddress: USDT_ARB, value: 1, logo: '', name: 'Tether USD' },
          { amount: '1', chainID: ARB_CHAIN, decimals: 18, symbol: 'DAI', tokenAddress: DAI, value: 1, logo: '', name: 'Dai Stablecoin' },
        ],
        dstTokenInfo: makeDstTokenInfo({ contractAddress: USDT_BASE, decimals: 6, symbol: 'USDT', name: 'Tether USD' }),
      })
    );
    // DAI isn't the USDT family → not the fast-path → COT round-trip runs.
    expect(liquidateInputHoldings).toHaveBeenCalled();
    expect(route.source.swaps.length).toBeGreaterThan(0);
  });
  it('EXACT_IN same-token does not fire for a non-mesh destination token', async () => {
    // WETH has no currencyId → not a bridgeable family → existing COT flow.
    const input: SwapData = {
      mode: SwapMode.EXACT_IN,
      data: {
        sources: [{ chainId: ARB_CHAIN, tokenAddress: WETH, amountRaw: 1_000_000_000_000_000_000n }],
        toChainId: BASE_CHAIN,
        toTokenAddress: WETH,
      },
    };
    vi.mocked(liquidateInputHoldings).mockResolvedValue([makeQuoteResponse({ chainID: ARB_CHAIN })]);
    vi.mocked(destinationSwapWithExactIn).mockResolvedValue(makeDestinationQuoteResponse());
    const route = await determineSwapRoute(
      input,
      makeRouteOptions({
        balances: [{ amount: '1', chainID: ARB_CHAIN, decimals: 18, symbol: 'WETH', tokenAddress: WETH, value: 3000, logo: '', name: 'WETH' }],
      })
    );
    expect(liquidateInputHoldings).toHaveBeenCalled();
    expect(route.source.swaps.length).toBeGreaterThan(0);
  });
  it('EXACT_IN same-token does not fire when a source is not the destination family (WETH → native ETH)', async () => {
    // WETH has no currencyId (not the ETH mesh family) → not a same-family bridge → COT flow.
    const input: SwapData = {
      mode: SwapMode.EXACT_IN,
      data: {
        sources: [{ chainId: ARB_CHAIN, tokenAddress: WETH, amountRaw: 1_000_000_000_000_000_000n }],
        toChainId: BASE_CHAIN,
        toTokenAddress: EADDRESS,
      },
    };
    vi.mocked(liquidateInputHoldings).mockResolvedValue([makeQuoteResponse({ chainID: ARB_CHAIN })]);
    vi.mocked(destinationSwapWithExactIn).mockResolvedValue(makeDestinationQuoteResponse());
    await determineSwapRoute(
      input,
      makeRouteOptions({
        balances: [{ amount: '1', chainID: ARB_CHAIN, decimals: 18, symbol: 'WETH', tokenAddress: WETH, value: 3000, logo: '', name: 'WETH' }],
        dstTokenInfo: makeDstTokenInfo({ contractAddress: EADDRESS, decimals: 18, symbol: 'ETH', name: 'Ether' }),
      })
    );
    expect(liquidateInputHoldings).toHaveBeenCalled();
  });
  it('EXACT_IN mixed-family COT round-trip computes sane fees from the COT-denominated quote', async () => {
    // End-to-end of the fixed bug: Base ETH + OP USDC -> Arbitrum native ETH. Mixed source
    // families (ETH + USDC) disqualify the same-token fast-path, so the route does the USDC COT
    // round-trip. Preflight's resolveBridgeQuoteToken now quotes the COT (USDC) for this mixed
    // case — not the native-ETH destination — so `fulfillmentFeeToken` arrives denominated in USDC
    // (6 decimals): "11868" = 0.011868 USDC (~$0.0119). computeBridgeFees scales it by the COT's 6
    // decimals, matching the quote's token, so the fee stays ~$0.0119 instead of the old 1e12
    // inflation that tripped "Bridge fees ... exceed bridged COT".
    const input: SwapData = {
      mode: SwapMode.EXACT_IN,
      data: {
        sources: [
          { chainId: BASE_CHAIN, tokenAddress: EADDRESS },
          { chainId: OP_CHAIN, tokenAddress: USDC_OP },
        ],
        toChainId: ARB_CHAIN,
        toTokenAddress: EADDRESS,
      },
    };
    // Base ETH liquidates to 0.25 USDC on Base; OP USDC (0.30) is COT. Both bridge to ARB -> ~0.55.
    vi.mocked(liquidateInputHoldings).mockResolvedValue([
      makeQuoteResponse({
        chainID: BASE_CHAIN,
        quote: {
          input: { contractAddress: EADDRESS, amount: '0.003', amountRaw: 3_000_000_000_000_000n, decimals: 18, value: 11, symbol: 'ETH' },
          output: { contractAddress: USDC_BASE, amount: '0.25', amountRaw: 250_000n, decimals: 6, value: 0.25, symbol: 'USDC' },
          txData: {
            approvalAddress: '0x1111111111111111111111111111111111111111' as Hex,
            tx: { to: '0x2222222222222222222222222222222222222222' as Hex, data: '0xabcdef' as Hex, value: '0x0' as Hex },
          },
        },
        holding: { chainID: BASE_CHAIN, tokenAddress: EADDRESS, amountRaw: 3_000_000_000_000_000n, decimals: 18, symbol: 'ETH' },
      }),
    ]);
    vi.mocked(destinationSwapWithExactIn).mockResolvedValue(makeDestinationQuoteResponse({ chainID: ARB_CHAIN }));

    // What preflight now produces for this mixed-source COT round-trip: the fee is in USDC (6 dec).
    const usdcDenominatedQuote = {
      fulfillmentBps: 10,
      sources: [],
      destination: {
        chainId: ARB_CHAIN,
        tokenAddress: USDC_ARB,
        fulfillmentFeeUsd: '0.011868',
        fulfillmentFeeToken: '11868',
      },
    };

    const route = await determineSwapRoute(
      input,
      makeRouteOptions({
        bridgeQuoteResponse: usdcDenominatedQuote as never,
        dstTokenInfo: makeDstTokenInfo({ contractAddress: EADDRESS, decimals: 18, symbol: 'ETH', name: 'Ether' }),
        balances: [
          { amount: '0.003', chainID: BASE_CHAIN, decimals: 18, symbol: 'ETH', tokenAddress: EADDRESS, value: 11, logo: '', name: 'Ether' },
          { amount: '0.30', chainID: OP_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_OP, value: 0.3, logo: '', name: 'USDC' },
        ],
        walletPathHints: new Map([
          [ARB_CHAIN, 'ephemeral'],
          [BASE_CHAIN, 'ephemeral'],
          [OP_CHAIN, 'ephemeral'],
        ]),
        quoteAddressHints: new Map([
          [ARB_CHAIN, EPHEMERAL_EXECUTOR],
          [BASE_CHAIN, EPHEMERAL_EXECUTOR],
          [OP_CHAIN, EPHEMERAL_EXECUTOR],
        ]),
      })
    );

    // The USDC-denominated fee is ~0.0119 USDC — well below the ~0.55 USDC bridged — so the route
    // resolves instead of throwing "exceed bridged COT".
    expect(route.bridge).not.toBeNull();
    expect(route.bridge!.estimatedFees.fulfilment.toFixed(6)).toBe('0.011868');
  });
  it('EXACT_IN native same-family sources bridge directly with addresses normalized to ZERO (ETH→ETH)', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_IN,
      data: {
        sources: [
          { chainId: ARB_CHAIN, tokenAddress: EADDRESS, amountRaw: 1_000_000_000_000_000_000n },
          { chainId: OP_CHAIN, tokenAddress: EADDRESS, amountRaw: 1_000_000_000_000_000_000n },
        ],
        toChainId: BASE_CHAIN,
        toTokenAddress: EADDRESS,
      },
    };
    vi.mocked(liquidateInputHoldings).mockResolvedValue([makeQuoteResponse({ chainID: ARB_CHAIN })]);
    vi.mocked(destinationSwapWithExactIn).mockResolvedValue(makeDestinationQuoteResponse());
    const route = await determineSwapRoute(
      input,
      makeRouteOptions({
        balances: [
          { amount: '1', chainID: ARB_CHAIN, decimals: 18, symbol: 'ETH', tokenAddress: EADDRESS, value: 3000, logo: '', name: 'Ether' },
          { amount: '1', chainID: OP_CHAIN, decimals: 18, symbol: 'ETH', tokenAddress: EADDRESS, value: 3000, logo: '', name: 'Ether' },
        ],
        dstTokenInfo: makeDstTokenInfo({ contractAddress: EADDRESS, decimals: 18, symbol: 'ETH', name: 'Ether' }),
      })
    );
    // Pure native bridge: no source/destination swaps.
    expect(liquidateInputHoldings).not.toHaveBeenCalled();
    expect(route.source.swaps).toHaveLength(0);
    expect(route.destination.swap.tokenSwap).toBeNull();
    // Native addresses normalized EADDRESS → ZERO so the bridge intent's token lookup resolves.
    expect(route.bridge).not.toBeNull();
    expect(equalFold(route.bridge!.tokenAddress, ZERO_ADDRESS)).toBe(true);
    expect(route.bridge!.assets).toHaveLength(2);
    for (const asset of route.bridge!.assets) {
      expect(equalFold(asset.contractAddress, ZERO_ADDRESS)).toBe(true);
    }
  });
  it('EXACT_IN dst quote spends the full cotAvailable (no source buffer); getDstSwap floor is 0', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_IN,
      data: {
        sources: [{ chainId: ARB_CHAIN, tokenAddress: WETH, amountRaw: 1000000000000000000n }],
        toChainId: ARB_CHAIN,
        toTokenAddress: WETH,
      },
    };
    vi.mocked(liquidateInputHoldings).mockResolvedValue([makeQuoteResponse()]);
    vi.mocked(destinationSwapWithExactIn).mockResolvedValue(makeDestinationQuoteResponse());
    const route = await determineSwapRoute(
      input,
      makeRouteOptions({
        balances: [
          { amount: '1', chainID: ARB_CHAIN, decimals: 18, symbol: 'WETH', tokenAddress: WETH, value: 3000, logo: '', name: 'WETH' },
        ],
      })
    );
    // cotAvailableForDestination = 3000 (all same chain, no bridge fees). No source buffer →
    // the dst swap is quoted at the full 3000; the getDstSwap floor (`min`) is 0.
    expect(route.source.srcBuffer).toBeNull();
    // COT round-trip: settles in the COT (USDC), not a same-token bridge.
    expect(route.sameTokenBridge).toBe(false);
    expect(route.settlementCurrencyId).toBe(CurrencyID.USDC);
    // `min` is 0 (the reclaim floor) so a down-drifted source can't over-size the dst swap; `max`
    // is the full COT the execution-time reclaim may spend up to.
    expect(route.destination.inputAmount.min.toFixed()).toBe('0');
    expect(route.destination.inputAmount.max.toFixed()).toBe('3000');
    // No bridge (same-chain) → nothing to reclaim from a bridged balance.
    expect(route.bridge).toBeNull();
    expect(route.source.reclaimFromActualBalance).toBe(false);
    // The route-time quote uses the full cotAvailable.
    expect(vi.mocked(destinationSwapWithExactIn)).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ amountRaw: 3000000000n }),
      })
    );
  });

  it('EXACT_IN getDstSwap sizes the input to actual - deduction (floor 0)', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_IN,
      data: {
        sources: [{ chainId: ARB_CHAIN, tokenAddress: WETH, amountRaw: 1000000000000000000n }],
        toChainId: ARB_CHAIN,
        toTokenAddress: WETH,
      },
    };
    vi.mocked(liquidateInputHoldings).mockResolvedValue([makeQuoteResponse()]);
    vi.mocked(destinationSwapWithExactIn).mockResolvedValue(makeDestinationQuoteResponse());
    const route = await determineSwapRoute(
      input,
      makeRouteOptions({
        balances: [
          { amount: '1', chainID: ARB_CHAIN, decimals: 18, symbol: 'WETH', tokenAddress: WETH, value: 3000, logo: '', name: 'WETH' },
        ],
      })
    );
    // No source buffer: floor = 0, max = cotAvailable = 3000.
    // Full delivery, no drift: actual COT at the wrapper = 3000. deduction = 1bp of 3000 = 0.3.
    // execInput = 3000 - 0.3 = 2999.7 → 2999700000n raw.
    const resized = await route.destination.getDstSwap(3000000000n);
    expect(resized).not.toBeNull();
    expect(vi.mocked(destinationSwapWithExactIn)).toHaveBeenLastCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ amountRaw: 2999700000n }) })
    );
    // Input scales with the actual delivered balance (minus deduction) and is NOT capped at the
    // route estimate — the source reclaim can over-deliver, and that surplus must be spent here.
    // 5000 actual → 5000 - 0.5 (1bp) = 4999.5 → 4999500000n.
    await route.destination.getDstSwap(5000000000n);
    expect(vi.mocked(destinationSwapWithExactIn)).toHaveBeenLastCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ amountRaw: 4999500000n }) })
    );
  });

  it('EXACT_IN cross-chain sets source.reclaimFromActualBalance when a bridge runs', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_IN,
      data: {
        sources: [{ chainId: ARB_CHAIN, tokenAddress: WETH, amountRaw: 1000000000000000000n }],
        toChainId: BASE_CHAIN,
        toTokenAddress: USDC_BASE, // COT on BASE → no dst swap, but a bridge runs
      },
    };
    vi.mocked(liquidateInputHoldings).mockResolvedValue([makeQuoteResponse()]);
    const route = await determineSwapRoute(
      input,
      makeRouteOptions({
        balances: [
          { amount: '1', chainID: ARB_CHAIN, decimals: 18, symbol: 'WETH', tokenAddress: WETH, value: 3000, logo: '', name: 'WETH' },
        ],
      })
    );
    expect(route.bridge).not.toBeNull();
    expect(route.source.reclaimFromActualBalance).toBe(true);
  });
  it('EXACT_IN Mayan: dst swap input is sized from Mayan minReceived, not the Nexus fee estimate', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_IN,
      data: {
        sources: [{ chainId: ARB_CHAIN, tokenAddress: WETH, amountRaw: 1000000000000000000n }],
        toChainId: BASE_CHAIN,
        toTokenAddress: WETH, // non-COT on BASE → a destination token swap runs
      },
    };
    // Source swap: 1 WETH on ARB → 3000 USDC (COT) on ARB, bridged to BASE.
    vi.mocked(liquidateInputHoldings).mockResolvedValue([makeQuoteResponse()]);
    vi.mocked(destinationSwapWithExactIn).mockResolvedValue(
      makeDestinationQuoteResponse({ chainID: BASE_CHAIN })
    );
    // Mayan actually delivers 2900 USDC on BASE — a 100 USDC haircut on the 3000 bridged,
    // larger than the Nexus fee estimate (0 here). The dst swap must be sized off 2900.
    mockMiddleware.getMayanQuotes.mockResolvedValue({
      destination: { chainId: BASE_CHAIN, tokenAddress: USDC_BASE },
      quotes: [
        {
          source: { chainId: ARB_CHAIN, tokenAddress: USDC_ARB, amount: '3000000000' },
          mayanQuote: { minReceived: 2900, protocolBps: 0 },
        },
      ],
    });

    const route = await determineSwapRoute(
      input,
      makeRouteOptions({
        forceMayan: true,
        balances: [
          { amount: '1', chainID: ARB_CHAIN, decimals: 18, symbol: 'WETH', tokenAddress: WETH, value: 3000, logo: '', name: 'WETH' },
        ],
      })
    );

    expect(route.bridge?.provider).toBe('mayan');
    // Mayan delivers 2900 on BASE (not the 3000 bridged) — the dst swap is sized off 2900, with no
    // source buffer. `min` is the reclaim floor (0).
    expect(route.destination.inputAmount.min.toFixed()).toBe('0');
    expect(vi.mocked(destinationSwapWithExactIn)).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ amountRaw: 2900000000n }) })
    );
  });
  it('destination token IS COT → no token swap needed', async () => {
    // Source COT lives on BASE so the sentinel filter (which removes USDC_ARB on ARB)
    // doesn't strand us. Bridge collects BASE USDC and delivers it on ARB; no dst-swap
    // is needed because toToken IS the destination COT.
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: ARB_CHAIN, toTokenAddress: USDC_ARB, toAmountRaw: 1000000000n },
    };
    vi.mocked(autoSelectSources).mockResolvedValue({
      quoteResponses: [],
      usedCOTs: [{ holding: { chainID: BASE_CHAIN, tokenAddress: USDC_BASE, amountRaw: 1050000000n, decimals: 6, symbol: 'USDC' }, amountUsed: new Decimal('1050'), idx: 0 }],
    });
    // Not called because COT IS the destination token
    vi.mocked(determineDestinationSwaps).mockResolvedValue(null);
    const route = await determineSwapRoute(
      input,
      makeRouteOptions({
        dstTokenInfo: makeDstTokenInfo({ contractAddress: USDC_ARB, decimals: 6, symbol: 'USDC', name: 'USD Coin' }),
        balances: [{ amount: '1050', chainID: BASE_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_BASE, value: 1050, logo: '', name: 'USDC' }],
      })
    );
    expect(route.destination.swap.tokenSwap).toBeNull();
  });
  it('EXACT_OUT throws when needsTokenSwap but destination aggregator cannot quote', async () => {
    // Reproduces "Swap plan is missing destination_swap step for chain X": when toToken
    // is non-COT and no aggregator supports the dst chain / pair, determineDestinationSwaps
    // returns null. The route used to silently proceed with tokenSwap=null +
    // finalWalletPath=ephemeral, producing an inconsistent plan that crashed later at the
    // progress-emit lookup. Route building must fail loudly here so the caller knows
    // the destination chain/token isn't routable.
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: ARB_CHAIN, toTokenAddress: WETH, toAmountRaw: 1000000000000000000n },
    };
    vi.mocked(autoSelectSources).mockResolvedValue({
      quoteResponses: [],
      usedCOTs: [{ holding: { chainID: ARB_CHAIN, tokenAddress: USDC_ARB, amountRaw: 3255000000n, decimals: 6, symbol: 'USDC' }, amountUsed: new Decimal('3255'), idx: 0 }],
    });
    vi.mocked(determineDestinationSwaps).mockResolvedValue(null);
    await expect(
      determineSwapRoute(
        input,
        makeRouteOptions({
          balances: [{ amount: '3255', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_ARB, value: 3255, logo: '', name: 'USDC' }],
        })
      )
    ).rejects.toThrow(/destination swap quote/i);
  });
  it('EXACT_IN throws when needsTokenSwap but destination aggregator cannot quote', async () => {
    // Same root cause as the EXACT_OUT variant: a non-COT toToken on a chain/pair the
    // aggregators can't quote leaves tokenSwap=null while finalWalletPath stays ephemeral,
    // and execution later crashes on a missing destination_swap plan step. Fail at route
    // build instead.
    const input: SwapData = {
      mode: SwapMode.EXACT_IN,
      data: {
        sources: [{ chainId: ARB_CHAIN, tokenAddress: USDC_ARB, amountRaw: 3000000000n }],
        toChainId: ARB_CHAIN,
        toTokenAddress: WETH,
      },
    };
    vi.mocked(liquidateInputHoldings).mockResolvedValue([]);
    vi.mocked(destinationSwapWithExactIn).mockResolvedValue(null);
    await expect(
      determineSwapRoute(
        input,
        makeRouteOptions({
          balances: [{ amount: '3000', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_ARB, value: 3000, logo: '', name: 'USDC' }],
        })
      )
    ).rejects.toThrow(/destination swap quote/i);
  });
  it('EXACT_OUT applies destination buffer', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: ARB_CHAIN, toTokenAddress: WETH, toAmountRaw: 1000000000000000000n },
    };
    vi.mocked(autoSelectSources).mockResolvedValue({
      quoteResponses: [],
      usedCOTs: [{ holding: { chainID: ARB_CHAIN, tokenAddress: USDC_ARB, amountRaw: 5000000000n, decimals: 6, symbol: 'USDC' }, amountUsed: new Decimal('5000'), idx: 0 }],
    });
    // determineDestinationSwaps returns QuoteResponse | null
    vi.mocked(determineDestinationSwaps).mockResolvedValue(
      makeDestinationQuoteResponse({ chainID: ARB_CHAIN }),
    );
    const route = await determineSwapRoute(
      input,
      makeRouteOptions({
        balances: [{ amount: '5000', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_ARB, value: 5000, logo: '', name: 'USDC' }],
      })
    );
    // Buffer should be a non-zero string for EXACT_OUT
    expect(route.buffer.amount).toBeDefined();
    expect(route.type).toBe(SwapMode.EXACT_OUT);
  });
  it('EXACT_OUT applies a source buffer on top of the destination-buffered input requirement', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: ARB_CHAIN, toTokenAddress: WETH, toAmountRaw: 1000000000000000000n },
    };
    vi.mocked(autoSelectSources).mockResolvedValue({
      quoteResponses: [],
      usedCOTs: [
        {
          holding: { chainID: ARB_CHAIN, tokenAddress: USDC_ARB, amountRaw: 3103000000n, decimals: 6, symbol: 'USDC' },
          amountUsed: new Decimal('3103'),
          idx: 0,
        },
      ],
    });
    vi.mocked(determineDestinationSwaps).mockResolvedValue(
      makeDestinationQuoteResponse({
        chainID: ARB_CHAIN,
        quote: {
          input: {
            contractAddress: USDC_ARB,
            amount: '3100',
            amountRaw: 3100000000n,
            decimals: 6,
            value: 3100,
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
              data: '0xabcdef' as Hex,
              value: '0x0' as Hex,
            },
          },
        },
      })
    );
    const route = await determineSwapRoute(
      input,
      makeRouteOptions({
        // This same-chain COT→WETH input would take Path A (direct swap); skip fast paths to isolate
        // the DEFAULT-flow two-buffer math (dst buffer + source buffer in COT units) under test here.
        skipFastPaths: true,
        balances: [
          {
            amount: '5000',
            chainID: ARB_CHAIN,
            decimals: 6,
            symbol: 'USDC',
            tokenAddress: USDC_ARB,
            value: 5000,
            logo: '',
            name: 'USDC',
          },
        ],
      })
    );
    expect(
      vi.mocked(autoSelectSources).mock.calls[0][0].outputRequired.toString()
    ).toBe('3103');
    expect(route.destination.inputAmount.min.toString()).toBe('3100');
    expect(route.destination.inputAmount.max.toString()).toBe('3102');
    expect(route.buffer.amount).toBe('3');
  });
  it('EXACT_OUT applies sources as an allowlist before source selection', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: {
        toChainId: BASE_CHAIN,
        toTokenAddress: WETH,
        toAmountRaw: 1000000000000000000n,
        sources: [{ chainId: BASE_CHAIN, tokenAddress: USDC_BASE }],
      },
    };
    vi.mocked(autoSelectSources).mockResolvedValue({
      quoteResponses: [],
      usedCOTs: [
        {
          holding: { chainID: BASE_CHAIN, tokenAddress: USDC_BASE, amountRaw: 3255000000n, decimals: 6, symbol: 'USDC' },
          amountUsed: new Decimal('3255'),
          idx: 0,
        },
      ],
    });
    vi.mocked(determineDestinationSwaps).mockResolvedValue(
      makeDestinationQuoteResponse({
        chainID: BASE_CHAIN,
        holding: { chainID: BASE_CHAIN, tokenAddress: USDC_BASE, amountRaw: 3100000000n, decimals: 6, symbol: 'USDC' },
        quote: {
          input: {
            contractAddress: USDC_BASE,
            amount: '3100',
            amountRaw: 3100000000n,
            decimals: 6,
            value: 3100,
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
              data: '0xabcdef' as Hex,
              value: '0x0' as Hex,
            },
          },
        },
      })
    );
    await determineSwapRoute(
      input,
      makeRouteOptions({
        balances: [
          { amount: '0.5', chainID: ARB_CHAIN, decimals: 18, symbol: 'WETH', tokenAddress: WETH, value: 1500, logo: '', name: 'WETH' },
          { amount: '4000', chainID: BASE_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_BASE, value: 4000, logo: '', name: 'USDC' },
        ],
      })
    );
    expect(vi.mocked(autoSelectSources).mock.calls[0][0].holdings).toEqual([
      expect.objectContaining({
        chainID: BASE_CHAIN,
        tokenAddress: USDC_BASE,
        amountRaw: 4000000000n,
        decimals: 6,
        symbol: 'USDC',
      }),
    ]);
  });
  it('EXACT_OUT excludes destination-token/native sources when toNativeAmount is requested', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: {
        toChainId: ARB_CHAIN,
        toTokenAddress: WETH,
        toAmountRaw: 1000000000000000000n,
        toNativeAmountRaw: 10000000000000000n,
      },
    };
    vi.mocked(autoSelectSources).mockResolvedValue({
      quoteResponses: [],
      usedCOTs: [
        {
          holding: { chainID: ARB_CHAIN, tokenAddress: USDC_ARB, amountRaw: 3400000000n, decimals: 6, symbol: 'USDC' },
          amountUsed: new Decimal('3400'),
          idx: 0,
        },
      ],
    });
    vi.mocked(determineDestinationSwaps).mockResolvedValue(
      makeDestinationQuoteResponse({
        chainID: ARB_CHAIN,
        quote: {
          input: {
            contractAddress: USDC_ARB,
            amount: '3100',
            amountRaw: 3100000000n,
            decimals: 6,
            value: 3100,
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
              data: '0xabcdef' as Hex,
              value: '0x0' as Hex,
            },
          },
        },
      })
    );
    vi.mocked(destinationGasSwapExactIn).mockResolvedValue(
      makeGasQuoteResponse({ chainID: ARB_CHAIN, inputContract: USDC_ARB })
    );
    const route = await determineSwapRoute(
      input,
      makeRouteOptions({
        oraclePrices: [
          { universe: 'EVM', chainId: ARB_CHAIN, priceUsd: new Decimal('2500'), tokenAddress: ZERO_ADDRESS, tokenSymbol: 'ETH', tokenDecimals: 18, timestamp: 0 },
          { universe: 'EVM', chainId: ARB_CHAIN, priceUsd: new Decimal('1'), tokenAddress: USDC_ARB, tokenSymbol: 'USDC', tokenDecimals: 6, timestamp: 0 },
        ],
        balances: [
          { amount: '0.5', chainID: ARB_CHAIN, decimals: 18, symbol: 'WETH', tokenAddress: WETH, value: 1500, logo: '', name: 'WETH' },
          { amount: '0.01', chainID: ARB_CHAIN, decimals: 18, symbol: 'ETH', tokenAddress: EADDRESS as Hex, value: 25, logo: '', name: 'ETH' },
          { amount: '4000', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_ARB, value: 4000, logo: '', name: 'USDC' },
        ],
      })
    );
    expect(vi.mocked(autoSelectSources).mock.calls[0][0].holdings).toEqual([
      expect.objectContaining({
        chainID: ARB_CHAIN,
        tokenAddress: USDC_ARB,
        amountRaw: 4000000000n,
        decimals: 6,
        symbol: 'USDC',
      }),
    ]);
    expect(vi.mocked(determineDestinationSwaps)).toHaveBeenCalledTimes(1);
    // 3100 (token swap input) + 25 (gas swap input from default mock) = 3125
    expect(route.destination.inputAmount.min.toString()).toBe('3125');
  });
  it('EXACT_OUT keeps the post-reserve destination native remainder as a source and normalizes route gas to zero', async () => {
    // toAmountRaw > 0n removes USDC_ARB on ARB from sources, so the only retained
    // dst-chain balance is the native ETH minus the reservation. BASE USDC stays as the
    // actual swap source.
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: {
        toChainId: ARB_CHAIN,
        toTokenAddress: USDC_ARB,
        toAmountRaw: 100000000n,
        toNativeAmountRaw: -400000000000000000n,
      },
    };
    vi.mocked(autoSelectSources).mockResolvedValue({
      quoteResponses: [],
      usedCOTs: [
        {
          holding: { chainID: BASE_CHAIN, tokenAddress: USDC_BASE, amountRaw: 4000000000n, decimals: 6, symbol: 'USDC' },
          amountUsed: new Decimal('4000'),
          idx: 0,
        },
      ],
    });
    vi.mocked(determineDestinationSwaps).mockResolvedValue(null);
    const route = await determineSwapRoute(
      input,
      makeRouteOptions({
        dstTokenInfo: makeDstTokenInfo({
          contractAddress: USDC_ARB,
          decimals: 6,
          symbol: 'USDC',
          name: 'USD Coin',
        }),
        balances: [
          { amount: '1', chainID: ARB_CHAIN, decimals: 18, symbol: 'ETH', tokenAddress: EADDRESS as Hex, value: 3000, logo: '', name: 'ETH' },
          { amount: '4000', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_ARB, value: 4000, logo: '', name: 'USDC' },
          { amount: '4000', chainID: BASE_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_BASE, value: 4000, logo: '', name: 'USDC' },
        ],
      })
    );
    const holdings = vi.mocked(autoSelectSources).mock.calls[0][0].holdings;
    expect(holdings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          chainID: ARB_CHAIN,
          tokenAddress: EADDRESS as Hex,
          amountRaw: 600000000000000000n,
          decimals: 18,
          symbol: 'ETH',
        }),
      ])
    );
    expect(
      holdings.some((h) => h.chainID === ARB_CHAIN && equalFold(h.tokenAddress, USDC_ARB))
    ).toBe(false);
    expect(route.extras.balances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          chainID: ARB_CHAIN,
          tokenAddress: EADDRESS as Hex,
          amount: '0.6',
        }),
      ])
    );
  });
  it('EXACT_OUT zeroes an exact-match destination native reserve without affecting other-chain native balances', async () => {
    // Reserves all dst-chain ETH (exact match). USDC_ARB on ARB is also filtered out by
    // the toAmountRaw sentinel; the actual source is BASE USDC (cross-chain bridge).
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: {
        toChainId: ARB_CHAIN,
        toTokenAddress: USDC_ARB,
        toAmountRaw: 100000000n,
        toNativeAmountRaw: -1000000000000000000n,
      },
    };
    vi.mocked(autoSelectSources).mockResolvedValue({
      quoteResponses: [],
      usedCOTs: [
        {
          holding: { chainID: BASE_CHAIN, tokenAddress: USDC_BASE, amountRaw: 4000000000n, decimals: 6, symbol: 'USDC' },
          amountUsed: new Decimal('4000'),
          idx: 0,
        },
      ],
    });
    vi.mocked(determineDestinationSwaps).mockResolvedValue(null);
    const route = await determineSwapRoute(
      input,
      makeRouteOptions({
        dstTokenInfo: makeDstTokenInfo({
          contractAddress: USDC_ARB,
          decimals: 6,
          symbol: 'USDC',
          name: 'USD Coin',
        }),
        balances: [
          { amount: '1', chainID: ARB_CHAIN, decimals: 18, symbol: 'ETH', tokenAddress: EADDRESS as Hex, value: 3000, logo: '', name: 'ETH' },
          { amount: '2', chainID: BASE_CHAIN, decimals: 18, symbol: 'ETH', tokenAddress: EADDRESS as Hex, value: 6000, logo: '', name: 'ETH' },
          { amount: '4000', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_ARB, value: 4000, logo: '', name: 'USDC' },
          { amount: '4000', chainID: BASE_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_BASE, value: 4000, logo: '', name: 'USDC' },
        ],
      })
    );
    const holdings = vi.mocked(autoSelectSources).mock.calls[0][0].holdings;
    expect(holdings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          chainID: BASE_CHAIN,
          tokenAddress: EADDRESS as Hex,
          amountRaw: 2000000000000000000n,
          decimals: 18,
          symbol: 'ETH',
        }),
      ])
    );
    expect(
      holdings.some((h) => h.chainID === ARB_CHAIN && equalFold(h.tokenAddress, EADDRESS as Hex))
    ).toBe(false);
    expect(
      holdings.some((h) => h.chainID === ARB_CHAIN && equalFold(h.tokenAddress, USDC_ARB))
    ).toBe(false);
    expect(route.extras.balances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          chainID: ARB_CHAIN,
          tokenAddress: EADDRESS as Hex,
          amount: '0',
        }),
        expect.objectContaining({
          chainID: BASE_CHAIN,
          tokenAddress: EADDRESS as Hex,
          amount: '2',
        }),
      ])
    );
  });
  it('EXACT_OUT deducts destination-chain COT from bridge amount and sets eoaToEphemeral for ephemeral destination custody', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: {
        toChainId: ARB_CHAIN,
        toTokenAddress: WETH,
        toAmountRaw: 1000000000000000000n,
      },
    };
    vi.mocked(autoSelectSources).mockResolvedValue({
      quoteResponses: [
        makeQuoteResponse({
          chainID: BASE_CHAIN,
          quote: {
            input: {
              contractAddress: WETH,
              amount: '0.75',
              amountRaw: 750000000000000000n,
              decimals: 18,
              value: 2250,
              symbol: 'WETH',
            },
            output: {
              contractAddress: USDC_BASE,
              amount: '2255',
              amountRaw: 2255000000n,
              decimals: 6,
              value: 2255,
              symbol: 'USDC',
            },
            txData: {
              approvalAddress: '0x1111111111111111111111111111111111111111' as Hex,
              tx: {
                to: '0x2222222222222222222222222222222222222222' as Hex,
                data: '0xabcdef' as Hex,
                value: '0x0' as Hex,
              },
            },
          },
        }),
      ],
      usedCOTs: [
        {
          holding: { chainID: ARB_CHAIN, tokenAddress: USDC_ARB, amountRaw: 1000000000n, decimals: 6, symbol: 'USDC' },
          amountUsed: new Decimal('1000'),
          idx: 0,
        },
      ],
    });
    vi.mocked(determineDestinationSwaps).mockResolvedValue(
      makeDestinationQuoteResponse({
        chainID: ARB_CHAIN,
        quote: {
          input: {
            contractAddress: USDC_ARB,
            amount: '3100',
            amountRaw: 3100000000n,
            decimals: 6,
            value: 3100,
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
              data: '0xabcdef' as Hex,
              value: '0x0' as Hex,
            },
          },
        },
      })
    );
    const route = await determineSwapRoute(
      input,
      makeRouteOptions({
        balances: [
          { amount: '0.75', chainID: BASE_CHAIN, decimals: 18, symbol: 'WETH', tokenAddress: WETH, value: 2250, logo: '', name: 'WETH' },
          { amount: '1000', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_ARB, value: 1000, logo: '', name: 'USDC' },
        ],
      })
    );
    // Forward model: bridge.amount is the actual gross bridged (Σ assets = the 2255 USDC produced on
    // BASE); the dst-chain 1000 USDC stays at the EOA and is deducted via eoaToEphemeral below.
    expect(route.bridge?.amount.toString()).toBe('2255');
    expect(route.destination.eoaToEphemeral).toEqual({
      amount: 1000000000n,
      contractAddress: USDC_ARB,
    });
    // Destination is 7702 (default) and needs a swap step → bridge fills to the ephemeral
    // wrapper, signalled by tokenSwap being non-null.
    expect(route.destination.swap.tokenSwap).not.toBeNull();
  });
  it('sets eoaToEphemeral on a non-7702 (Safe) destination chain so direct EOA COT reaches the Safe', async () => {
    // Parity: on a Safe (non-7702) destination chain the dst swap runs as the Safe, so the EOA's
    // direct COT must be moved EOA→Safe before the swap. This used to be gated to 7702 chains,
    // leaving the Safe empty → the dst swap reverts (GS013). The transfer must be produced for
    // both wrappers; prepare/execution target whichever executor runs the swap.
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: {
        toChainId: ARB_CHAIN,
        toTokenAddress: WETH,
        toAmountRaw: 1000000000000000000n,
      },
    };
    vi.mocked(autoSelectSources).mockResolvedValue({
      quoteResponses: [
        makeQuoteResponse({
          chainID: BASE_CHAIN,
          quote: {
            input: { contractAddress: WETH, amount: '0.75', amountRaw: 750000000000000000n, decimals: 18, value: 2250, symbol: 'WETH' },
            output: { contractAddress: USDC_BASE, amount: '2255', amountRaw: 2255000000n, decimals: 6, value: 2255, symbol: 'USDC' },
            txData: {
              approvalAddress: '0x1111111111111111111111111111111111111111' as Hex,
              tx: { to: '0x2222222222222222222222222222222222222222' as Hex, data: '0xabcdef' as Hex, value: '0x0' as Hex },
            },
          },
        }),
      ],
      usedCOTs: [
        {
          holding: { chainID: ARB_CHAIN, tokenAddress: USDC_ARB, amountRaw: 1000000000n, decimals: 6, symbol: 'USDC' },
          amountUsed: new Decimal('1000'),
          idx: 0,
        },
      ],
    });
    vi.mocked(determineDestinationSwaps).mockResolvedValue(
      makeDestinationQuoteResponse({
        chainID: ARB_CHAIN,
        quote: {
          input: { contractAddress: USDC_ARB, amount: '3100', amountRaw: 3100000000n, decimals: 6, value: 3100, symbol: 'USDC' },
          output: { contractAddress: WETH, amount: '1.0', amountRaw: 1000000000000000000n, decimals: 18, value: 3000, symbol: 'WETH' },
          txData: {
            approvalAddress: '0x1111111111111111111111111111111111111111' as Hex,
            tx: { to: '0x2222222222222222222222222222222222222222' as Hex, data: '0xabcdef' as Hex, value: '0x0' as Hex },
          },
        },
      })
    );
    // Destination chain ARB advertises supports7702=false → Safe wrapper.
    const chainList = makeSwapChainList();
    const originalGetChainByID = chainList.getChainByID.bind(chainList);
    chainList.getChainByID = vi.fn().mockImplementation((chainId: number) =>
      chainId === ARB_CHAIN
        ? { ...originalGetChainByID(chainId), supports7702: false }
        : originalGetChainByID(chainId)
    );
    const route = await determineSwapRoute(
      input,
      makeRouteOptions({
        chainList: chainList as unknown as ChainListType,
        balances: [
          { amount: '0.75', chainID: BASE_CHAIN, decimals: 18, symbol: 'WETH', tokenAddress: WETH, value: 2250, logo: '', name: 'WETH' },
          { amount: '1000', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_ARB, value: 1000, logo: '', name: 'USDC' },
        ],
        walletPathHints: new Map<number, WalletPath>([
          [ARB_CHAIN, 'safe'],
          [BASE_CHAIN, 'ephemeral'],
        ]),
      })
    );
    // Safe destination must still get the EOA→wrapper COT transfer (was null before the fix).
    expect(route.destination.eoaToEphemeral).toEqual({
      amount: 1000000000n,
      contractAddress: USDC_ARB,
    });
  });
  it('EXACT_OUT folds the up-front bridge-fee estimate into the source selection and records bridge fees', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: {
        toChainId: BASE_CHAIN,
        toTokenAddress: USDC_BASE,
        toAmountRaw: 100000000n,
      },
    };
    // Single-pass selection: the bridge fee is estimated up front and folded into the selection
    // target, so autoSelectSources is asked once for enough COT to cover dst-need + buffers + fee
    // (here 100 + 2 + 1 + [1.5 fulfilment + 1.2 protocol on the ~110% rough leg] = 105.7).
    vi.mocked(autoSelectSources).mockResolvedValue({
      quoteResponses: [
        makeQuoteResponse({
          chainID: ARB_CHAIN,
          quote: {
            input: {
              contractAddress: WETH,
              amount: '0.0353',
              amountRaw: 35300000000000000n,
              decimals: 18,
              value: 106,
              symbol: 'WETH',
            },
            output: {
              contractAddress: USDC_ARB,
              amount: '106',
              amountRaw: 106000000n,
              decimals: 6,
              value: 106,
              symbol: 'USDC',
            },
            txData: {
              approvalAddress: '0x1111111111111111111111111111111111111111' as Hex,
              tx: {
                to: '0x2222222222222222222222222222222222222222' as Hex,
                data: '0xabcdef' as Hex,
                value: '0x0' as Hex,
              },
            },
          },
        }),
      ],
      usedCOTs: [],
    });
    const route = await determineSwapRoute(
      input,
      makeRouteOptions({
        dstTokenInfo: makeDstTokenInfo({
          contractAddress: USDC_BASE,
          decimals: 6,
          symbol: 'USDC',
          name: 'USD Coin',
        }),
        bridgeQuoteResponse: {
          fulfillmentBps: 100,
          sources: [
            {
              chainId: ARB_CHAIN,
              tokenAddress: USDC_ARB,
              depositFeeUsd: '2',
              depositFeeToken: '2000000',
            },
          ],
          destination: {
            chainId: BASE_CHAIN,
            tokenAddress: USDC_BASE,
            fulfillmentFeeUsd: '1.5',
            fulfillmentFeeToken: '1500000',
          },
        } as never,
        balances: [
          {
            amount: '0.04',
            chainID: ARB_CHAIN,
            decimals: 18,
            symbol: 'WETH',
            tokenAddress: WETH,
            value: 120,
            logo: '',
            name: 'WETH'
          },
        ],
      })
    );
    // Smart-account-only model: collection fee is stubbed to zero (no EOA-direct funding
    // path), fulfilment + protocol still come from the bridge quote.
    expect(route.bridge?.estimatedFees.collection.toString()).toBe('0');
    expect(route.bridge?.estimatedFees.fulfilment.toString()).toBe('1.5');
    // protocol bps is on the gross bridged (Σ assets = 106), not the net delivery target.
    expect(route.bridge?.estimatedFees.protocol.toString()).toBe('1.06');
    // Forward model: delivered token = gross 106 − fulfilment 1.5 − protocol 1.06 = 103.44.
    expect(route.bridge?.amounts.tokenAmount.toString()).toBe('103.44');
  });
  it('EXACT_OUT Nexus: protocol fee is on the gross bridged (Σ assets), consistent with EXACT_IN', async () => {
    // The bridge sends Σ assets (150 USDC) and the bps fee applies to that gross — matching EXACT_IN
    // — not the smaller net delivery target. So protocol = 150 × 1% = 1.5 (not ~1.03 on net), and
    // bridge.amount reports the actual gross bridged.
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: ARB_CHAIN, toTokenAddress: USDC_ARB, toAmountRaw: 100_000_000n },
    };
    vi.mocked(determineDestinationSwaps).mockResolvedValue(null); // toToken IS COT → no dst swap
    vi.mocked(autoSelectSources).mockResolvedValue({
      quoteResponses: [],
      usedCOTs: [
        {
          holding: { chainID: BASE_CHAIN, tokenAddress: USDC_BASE, amountRaw: 150_000_000n, decimals: 6, symbol: 'USDC' },
          amountUsed: new Decimal('150'),
          idx: 0,
        },
      ],
    });
    const route = await determineSwapRoute(
      input,
      makeRouteOptions({
        dstTokenInfo: makeDstTokenInfo({ contractAddress: USDC_ARB, decimals: 6, symbol: 'USDC', name: 'USD Coin' }),
        bridgeQuoteResponse: {
          fulfillmentBps: 100,
          sources: [{ chainId: BASE_CHAIN, tokenAddress: USDC_BASE, depositFeeUsd: '0', depositFeeToken: '0' }],
          destination: { chainId: ARB_CHAIN, tokenAddress: USDC_ARB, fulfillmentFeeUsd: '0', fulfillmentFeeToken: '0' },
        } as never,
        balances: [
          { amount: '150', chainID: BASE_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_BASE, value: 150, logo: '', name: 'USDC' },
        ],
      })
    );
    expect(route.bridge!.provider).toBe('nexus');
    expect(route.bridge!.estimatedFees.protocol.toString()).toBe('1.5');
    expect(route.bridge!.amount.toString()).toBe('150');
  });

  it('EXACT_OUT coalesces multiple quote responses from the same chain into one bridge asset', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: {
        toChainId: BASE_CHAIN,
        toTokenAddress: USDC_BASE,
        toAmountRaw: 100000000n,
      },
    };
    vi.mocked(autoSelectSources).mockResolvedValue({
      quoteResponses: [
        makeQuoteResponse({
          chainID: ARB_CHAIN,
          quote: {
            input: {
              contractAddress: WETH,
              amount: '0.02',
              amountRaw: 20000000000000000n,
              decimals: 18,
              value: 60,
              symbol: 'WETH',
            },
            output: {
              contractAddress: USDC_ARB,
              amount: '60',
              amountRaw: 60000000n,
              decimals: 6,
              value: 60,
              symbol: 'USDC',
            },
            txData: {
              approvalAddress: '0x1111111111111111111111111111111111111111' as Hex,
              tx: {
                to: '0x2222222222222222222222222222222222222222' as Hex,
                data: '0xabcdef' as Hex,
                value: '0x0' as Hex,
              },
            },
          },
        }),
        makeQuoteResponse({
          chainID: ARB_CHAIN,
          quote: {
            input: {
              contractAddress: WETH,
              amount: '0.016666666666666666',
              amountRaw: 16666666666666666n,
              decimals: 18,
              value: 50,
              symbol: 'WETH',
            },
            output: {
              contractAddress: USDC_ARB,
              amount: '50',
              amountRaw: 50000000n,
              decimals: 6,
              value: 50,
              symbol: 'USDC',
            },
            txData: {
              approvalAddress: '0x1111111111111111111111111111111111111111' as Hex,
              tx: {
                to: '0x2222222222222222222222222222222222222222' as Hex,
                data: '0xabcdef' as Hex,
                value: '0x0' as Hex,
              },
            },
          },
        }),
      ],
      usedCOTs: [],
    });
    const route = await determineSwapRoute(
      input,
      makeRouteOptions({
        dstTokenInfo: makeDstTokenInfo({
          contractAddress: USDC_BASE,
          decimals: 6,
          symbol: 'USDC',
          name: 'USD Coin',
        }),
        balances: [
          {
            amount: '0.04',
            chainID: ARB_CHAIN,
            decimals: 18,
            symbol: 'WETH',
            tokenAddress: WETH,
            value: 120,
            logo: '',
            name: 'WETH'
          },
        ],
      })
    );
    // Bridge funding always tagged as ephemeralBalance now (smart-account-only model). EOA
    // balance carries direct-COT holdings only, which this scenario doesn't exercise.
    expect(route.bridge?.assets).toEqual([
      expect.objectContaining({
        chainID: ARB_CHAIN,
        ephemeralBalance: new Decimal('110'),
        eoaBalance: new Decimal(0),
      }),
    ]);
  });
  it('no valid sources → throws swapRouteFailed', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: ARB_CHAIN, toTokenAddress: WETH, toAmountRaw: 1000000000000000000n },
    };
    vi.mocked(autoSelectSources).mockRejectedValue(new Error('No valid sources'));
    await expect(
      determineSwapRoute(input, makeRouteOptions()),
    ).rejects.toThrow();
  });
  it('rejects unsupported destination chains before resolving COT', async () => {
    const badChainId = 999999;
    const chainList = makeSwapChainList();
    chainList.getChainByID = vi.fn().mockImplementation((chainId: number) => {
      if (chainId === badChainId) {
        throw new Error(`Chain not found: ${badChainId}`);
      }
      return {
        id: chainId,
        name: `Chain ${chainId}`,
        nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH', logo: '' },
        custom: { icon: '', knownTokens: [] },
      };
    });
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: badChainId, toTokenAddress: WETH, toAmountRaw: 1000000000000000000n },
    };
    await expect(determineSwapRoute(input, makeRouteOptions({ chainList: chainList as unknown as ChainListType }))).rejects.toThrow(
      `Chain not found: ${badChainId}`
    );
  });
  it('rejects when there are no usable balances for EXACT_OUT routing', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: ARB_CHAIN, toTokenAddress: WETH, toAmountRaw: 1000000000000000000n },
    };
    await expect(determineSwapRoute(input, makeRouteOptions({ balances: [] }))).rejects.toThrow(
      /Insufficient balance|usable balances/i
    );
    expect(autoSelectSources).not.toHaveBeenCalled();
  });
  it('rejects when available balances do not cover the required output', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: ARB_CHAIN, toTokenAddress: WETH, toAmountRaw: 1000000000000000000n },
    };
    vi.mocked(autoSelectSources).mockResolvedValue({
      quoteResponses: [],
      usedCOTs: [{ holding: { chainID: ARB_CHAIN, tokenAddress: USDC_ARB, amountRaw: 1000000n, decimals: 6, symbol: 'USDC' }, amountUsed: new Decimal('1'), idx: 0 }],
    });
    vi.mocked(determineDestinationSwaps).mockResolvedValue(makeQuoteResponse({ chainID: ARB_CHAIN }));
    await expect(
      determineSwapRoute(
        input,
        makeRouteOptions({
          balances: [{ amount: '1', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_ARB, value: 1, logo: '', name: 'USDC' }],
        })
      )
    ).rejects.toThrow(/Insufficient balance|cover required output/i);
  });
  it('normalizes EXACT_IN assetsUsed amounts to human-decimal strings', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_IN,
      data: {
        sources: [{ chainId: ARB_CHAIN, tokenAddress: WETH, amountRaw: 1000000000000000000n }],
        toChainId: ARB_CHAIN,
        toTokenAddress: USDC_ARB,
      },
    };
    const chainList = makeSwapChainList();
    chainList.getTokenByAddress = vi.fn().mockImplementation((chainId: number, tokenAddress: Hex) => {
      if (chainId === ARB_CHAIN && tokenAddress === WETH) {
        return { contractAddress: WETH, decimals: 18, symbol: 'WETH', name: 'Wrapped Ether', logo: '' };
      }
      return undefined;
    });
    vi.mocked(liquidateInputHoldings).mockResolvedValue([makeQuoteResponse()]);
    vi.mocked(destinationSwapWithExactIn).mockResolvedValue(null);
    const route = await determineSwapRoute(
      input,
      makeRouteOptions({
        chainList: chainList as unknown as ChainListType,
        dstTokenInfo: makeDstTokenInfo({ contractAddress: USDC_ARB, decimals: 6, symbol: 'USDC', name: 'USD Coin' }),
        balances: [{ amount: '1', chainID: ARB_CHAIN, decimals: 18, symbol: 'WETH', tokenAddress: WETH, value: 3000, logo: '', name: 'WETH' }],
      })
    );
    expect(route.extras.assetsUsed[0].amount).toBe('1');
  });
  it('EXACT_IN assetsUsed falls back to balance metadata for unsupported source tokens', async () => {
    const unlisted = '0x9999000000000000000000000000000000000001' as Hex;
    const input: SwapData = {
      mode: SwapMode.EXACT_IN,
      data: {
        sources: [{ chainId: ARB_CHAIN, tokenAddress: unlisted, amountRaw: 1000000000000000000n }],
        toChainId: ARB_CHAIN,
        toTokenAddress: USDC_ARB,
      },
    };
    const chainList = makeSwapChainList();
    chainList.getTokenByAddress = vi.fn().mockImplementation((chainId: number, tokenAddress: Hex) => {
      if (chainId === ARB_CHAIN && tokenAddress === USDC_ARB) {
        return { contractAddress: USDC_ARB, decimals: 6, symbol: 'USDC', name: 'USD Coin', logo: '' };
      }
      return undefined;
    });
    vi.mocked(liquidateInputHoldings).mockResolvedValue([
      makeQuoteResponse({
        chainID: ARB_CHAIN,
        holding: {
          chainID: ARB_CHAIN,
          tokenAddress: unlisted,
          amountRaw: 1000000000000000000n,
          decimals: 18,
          symbol: 'UNLISTED',
        },
      }),
    ]);
    vi.mocked(destinationSwapWithExactIn).mockResolvedValue(null);
    const route = await determineSwapRoute(
      input,
      makeRouteOptions({
        chainList: chainList as unknown as ChainListType,
        dstTokenInfo: makeDstTokenInfo({
          contractAddress: USDC_ARB,
          decimals: 6,
          symbol: 'USDC',
          name: 'USD Coin',
        }),
        balances: [
          {
            amount: '1',
            chainID: ARB_CHAIN,
            decimals: 18,
            symbol: 'UNLISTED',
            tokenAddress: unlisted,
            value: 1,
            logo: '',
            name: 'UNLISTED'
          },
        ],
      })
    );
    expect(route.extras.assetsUsed).toEqual([
      {
        chainID: ARB_CHAIN,
        tokenAddress: unlisted,
        symbol: 'UNLISTED',
        decimals: 18,
        amount: '1',
      },
    ]);
  });
  it('EXACT_IN all COT same chain → no bridge', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_IN,
      data: {
        sources: [{ chainId: ARB_CHAIN, tokenAddress: USDC_ARB, amountRaw: 1000000000n }],
        toChainId: ARB_CHAIN,
        toTokenAddress: WETH,
      },
    };
    // COT holding on same chain — no liquidation needed
    vi.mocked(liquidateInputHoldings).mockResolvedValue([]);
    vi.mocked(destinationSwapWithExactIn).mockResolvedValue(
      makeQuoteResponse({ chainID: ARB_CHAIN }),
    );
    const route = await determineSwapRoute(
      input,
      makeRouteOptions({
        balances: [{ amount: '1000', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_ARB, value: 1000, logo: '', name: 'USDC' }],
      })
    );
    expect(route.bridge).toBeNull();
    expect(route.destination.swap.tokenSwap).not.toBeNull();
  });

  // ── Path A: direct destination-chain swap (EXACT_IN) ──────────────────────────────────────────
  describe('Path A direct destination (EXACT_IN)', () => {
    const PEPE = '0x00000000000000000000000000000000000pepe01' as Hex;
    const makeWethToPepeQuote = (outputRaw: bigint): QuoteResponse =>
      makeQuoteResponse({
        chainID: ARB_CHAIN,
        quote: {
          input: { contractAddress: WETH, amount: '1.0', amountRaw: 1000000000000000000n, decimals: 18, value: 3000, symbol: 'WETH' },
          output: { contractAddress: PEPE, amount: '1000', amountRaw: outputRaw, decimals: 18, value: 3000, symbol: 'PEPE' },
          txData: { approvalAddress: '0x1111111111111111111111111111111111111111' as Hex, tx: { to: '0x2222222222222222222222222222222222222222' as Hex, data: '0xabcdef' as Hex, value: '0x0' as Hex } },
        },
        holding: { chainID: ARB_CHAIN, tokenAddress: WETH, amountRaw: 1000000000000000000n, decimals: 18, symbol: 'WETH' },
      });
    const pepeInfo = makeDstTokenInfo({ contractAddress: PEPE, decimals: 18, symbol: 'PEPE', name: 'Pepe' });
    const wethArbBalance = { amount: '1', chainID: ARB_CHAIN, decimals: 18, symbol: 'WETH', tokenAddress: WETH, value: 3000, logo: '', name: 'Wrapped Ether' };
    const pepeArbBalance = { amount: '500', chainID: ARB_CHAIN, decimals: 18, symbol: 'PEPE', tokenAddress: PEPE, value: 5, logo: '', name: 'Pepe' };

    it('fires when all sources are on the destination chain and a token swap is needed — no bridge, no dst swap', async () => {
      const input: SwapData = {
        mode: SwapMode.EXACT_IN,
        data: { sources: [{ chainId: ARB_CHAIN, tokenAddress: WETH, amountRaw: 1000000000000000000n }], toChainId: ARB_CHAIN, toTokenAddress: PEPE },
      };
      vi.mocked(liquidateInputHoldings).mockResolvedValue([makeWethToPepeQuote(1000000000000000000000n)]); // 1000 PEPE

      const route = await determineSwapRoute(input, makeRouteOptions({ dstTokenInfo: pepeInfo, balances: [wethArbBalance] }));

      expect(route.directDestination).toBe(true);
      expect(route.bridge).toBeNull();
      expect(route.destination.swap.tokenSwap).toBeNull();
      expect(route.source.swaps).toHaveLength(1);
      expect(route.destination.inputAmount.max.toString()).toBe('1000');
      expect(route.destination.inputAmount.min.toString()).toBe('1000');
      // The dst swap machinery is not consulted on Path A (EXACT_IN dst swap = destinationSwapWithExactIn).
      expect(destinationSwapWithExactIn).not.toHaveBeenCalled();
      // liquidate targets the destination token directly, recipient = EOA, taker = wrapper (ephemeral).
      const liqArg = vi.mocked(liquidateInputHoldings).mock.calls[0][0];
      expect(liqArg.outputToken).toEqual({ contractAddress: PEPE });
      expect(liqArg.recipientAddressByChain.get(ARB_CHAIN)).toBe('0xaaaa');
      expect(liqArg.userAddressByChain.get(ARB_CHAIN)).toBe(EPHEMERAL_EXECUTOR);
    });

    it('identity holdings (already the destination token) contribute directly and are not quoted', async () => {
      const input: SwapData = {
        mode: SwapMode.EXACT_IN,
        data: {
          sources: [
            { chainId: ARB_CHAIN, tokenAddress: WETH, amountRaw: 1000000000000000000n },
            { chainId: ARB_CHAIN, tokenAddress: PEPE, amountRaw: 500000000000000000000n }, // 500 PEPE identity
          ],
          toChainId: ARB_CHAIN,
          toTokenAddress: PEPE,
        },
      };
      // liquidate only sees the non-identity WETH holding.
      vi.mocked(liquidateInputHoldings).mockResolvedValue([makeWethToPepeQuote(1000000000000000000000n)]);

      const route = await determineSwapRoute(input, makeRouteOptions({ dstTokenInfo: pepeInfo, balances: [wethArbBalance, pepeArbBalance] }));

      expect(route.directDestination).toBe(true);
      expect(route.source.swaps).toHaveLength(1); // only WETH→PEPE, identity not swapped
      // delivered = 1000 (swapped) + 500 (identity) = 1500 PEPE
      expect(route.destination.inputAmount.max.toString()).toBe('1500');
      const liqArg = vi.mocked(liquidateInputHoldings).mock.calls[0][0];
      expect(liqArg.holdings.map((h: { tokenAddress: Hex }) => h.tokenAddress)).toEqual([WETH]);
    });

    it('does NOT fire when the destination token is the COT (needsTokenSwap false) — default COT-dst flow', async () => {
      const input: SwapData = {
        mode: SwapMode.EXACT_IN,
        data: { sources: [{ chainId: ARB_CHAIN, tokenAddress: WETH, amountRaw: 1000000000000000000n }], toChainId: ARB_CHAIN, toTokenAddress: USDC_ARB },
      };
      vi.mocked(liquidateInputHoldings).mockResolvedValue([makeQuoteResponse({ chainID: ARB_CHAIN })]); // WETH→USDC

      const route = await determineSwapRoute(input, makeRouteOptions({
        dstTokenInfo: makeDstTokenInfo({ contractAddress: USDC_ARB, decimals: 6, symbol: 'USDC', name: 'USD Coin' }),
        balances: [wethArbBalance],
      }));

      expect(route.directDestination).toBeFalsy();
      expect(route.destination.swap.tokenSwap).toBeNull(); // COT dst
      // Default flow liquidates to the COT (outputToken unset).
      expect(vi.mocked(liquidateInputHoldings).mock.calls[0][0].outputToken).toBeUndefined();
    });

    it('a shortfall quote (strict-ALL) falls back to the default COT double-hop', async () => {
      const input: SwapData = {
        mode: SwapMode.EXACT_IN,
        data: { sources: [{ chainId: ARB_CHAIN, tokenAddress: WETH, amountRaw: 1000000000000000000n }], toChainId: ARB_CHAIN, toTokenAddress: PEPE },
      };
      // First (Path A) call → no quote (strict-ALL shortfall → builder throws). Second (default) → WETH→USDC.
      vi.mocked(liquidateInputHoldings)
        .mockResolvedValueOnce([]) // Path A: incomplete
        .mockResolvedValueOnce([makeQuoteResponse({ chainID: ARB_CHAIN })]); // default: WETH→USDC
      vi.mocked(destinationSwapWithExactIn).mockResolvedValue(makeQuoteResponse({ chainID: ARB_CHAIN, quote: { input: { contractAddress: USDC_ARB, amount: '3000', amountRaw: 3000000000n, decimals: 6, value: 3000, symbol: 'USDC' }, output: { contractAddress: PEPE, amount: '1000', amountRaw: 1000000000000000000000n, decimals: 18, value: 3000, symbol: 'PEPE' }, txData: { approvalAddress: '0x1111111111111111111111111111111111111111' as Hex, tx: { to: '0x2222222222222222222222222222222222222222' as Hex, data: '0xabcdef' as Hex, value: '0x0' as Hex } } } }));

      const route = await determineSwapRoute(input, makeRouteOptions({ dstTokenInfo: pepeInfo, balances: [wethArbBalance] }));

      expect(route.directDestination).toBeFalsy();
      expect(route.destination.swap.tokenSwap).not.toBeNull(); // default double-hop dst swap
      // Path A tried first (outputToken=PEPE), then the default flow (outputToken unset).
      expect(vi.mocked(liquidateInputHoldings).mock.calls[0][0].outputToken).toEqual({ contractAddress: PEPE });
      expect(vi.mocked(liquidateInputHoldings).mock.calls[1][0].outputToken).toBeUndefined();
      expect(destinationSwapWithExactIn).toHaveBeenCalled();
    });

    it('is skipped when skipFastPaths is set (B2 re-entry guard)', async () => {
      const input: SwapData = {
        mode: SwapMode.EXACT_IN,
        data: { sources: [{ chainId: ARB_CHAIN, tokenAddress: WETH, amountRaw: 1000000000000000000n }], toChainId: ARB_CHAIN, toTokenAddress: PEPE },
      };
      vi.mocked(liquidateInputHoldings).mockResolvedValue([makeQuoteResponse({ chainID: ARB_CHAIN })]); // WETH→USDC (default)
      vi.mocked(destinationSwapWithExactIn).mockResolvedValue(makeQuoteResponse({ chainID: ARB_CHAIN, quote: { input: { contractAddress: USDC_ARB, amount: '3000', amountRaw: 3000000000n, decimals: 6, value: 3000, symbol: 'USDC' }, output: { contractAddress: PEPE, amount: '1000', amountRaw: 1000000000000000000000n, decimals: 18, value: 3000, symbol: 'PEPE' }, txData: { approvalAddress: '0x1111111111111111111111111111111111111111' as Hex, tx: { to: '0x2222222222222222222222222222222222222222' as Hex, data: '0xabcdef' as Hex, value: '0x0' as Hex } } } }));

      const route = await determineSwapRoute(input, makeRouteOptions({ dstTokenInfo: pepeInfo, balances: [wethArbBalance], skipFastPaths: true }));

      expect(route.directDestination).toBeFalsy();
      // Only the default liquidate ran; Path A was never attempted (outputToken unset on the sole call).
      expect(vi.mocked(liquidateInputHoldings).mock.calls[0][0].outputToken).toBeUndefined();
    });
  });

  // ── Path A: direct destination-chain swap (EXACT_OUT, two-pass gas) ────────────────────────────
  describe('Path A direct destination (EXACT_OUT)', () => {
    const PEPE = '0x00000000000000000000000000000000000pepe01' as Hex;
    const pepeInfo = makeDstTokenInfo({ contractAddress: PEPE, decimals: 18, symbol: 'PEPE', name: 'Pepe' });
    const bal = (tokenAddress: Hex, amount: string, decimals: number, value: number, symbol: string) => ({ amount, chainID: ARB_CHAIN, decimals, symbol, tokenAddress, value, logo: '', name: symbol });
    // A COT→PEPE sizing quote so the pre-gate `needsTokenSwap && !tokenSwapQuote` check passes; Path A
    // discards it. Its input.amount drives `inputAmount` (the RES sizing basis).
    const sizingQuote = () => makeDestinationQuoteResponse({ chainID: ARB_CHAIN, quote: { input: { contractAddress: USDC_ARB, amount: '100', amountRaw: 100000000n, decimals: 6, value: 100, symbol: 'USDC' }, output: { contractAddress: PEPE, amount: '100', amountRaw: 100000000000000000000n, decimals: 18, value: 100, symbol: 'PEPE' }, txData: { approvalAddress: '0x1111111111111111111111111111111111111111' as Hex, tx: { to: '0x2222222222222222222222222222222222222222' as Hex, data: '0xabcdef' as Hex, value: '0x0' as Hex } } } });
    const human = (raw: bigint, decimals: number) => new Decimal(raw.toString()).div(new Decimal(10).pow(decimals)).toString();
    const leg = (inputToken: Hex, inputRaw: bigint, inputDecimals: number, outputToken: Hex, outputRaw: bigint, outputDecimals: number): QuoteResponse => ({
      chainID: ARB_CHAIN,
      quote: {
        input: { contractAddress: inputToken, amount: human(inputRaw, inputDecimals), amountRaw: inputRaw, decimals: inputDecimals, value: 0, symbol: 'IN' },
        output: { contractAddress: outputToken, amount: human(outputRaw, outputDecimals), amountRaw: outputRaw, decimals: outputDecimals, value: 0, symbol: 'OUT' },
        txData: { approvalAddress: '0x1111111111111111111111111111111111111111' as Hex, tx: { to: '0x2222222222222222222222222222222222222222' as Hex, data: '0xabcdef' as Hex, value: '0x0' as Hex } },
      },
      holding: { chainID: ARB_CHAIN, tokenAddress: inputToken, amountRaw: inputRaw, decimals: inputDecimals, symbol: 'IN' },
      aggregator: {} as Aggregator,
    });

    it('fires: swaps dst-chain sources → toToken directly, no bridge, no dst swap', async () => {
      const input: SwapData = { mode: SwapMode.EXACT_OUT, data: { toChainId: ARB_CHAIN, toTokenAddress: PEPE, toAmountRaw: 100000000000000000000n } };
      vi.mocked(determineDestinationSwaps).mockResolvedValue(sizingQuote());
      vi.mocked(selectDirectDestinationSwaps).mockResolvedValue({
        quoteResponses: [leg(WETH, 1000000000000000000n, 18, PEPE, 101000000000000000000n, 18)], // delivers 101 PEPE
        usedCOTs: [],
      });

      const route = await determineSwapRoute(input, makeRouteOptions({ dstTokenInfo: pepeInfo, balances: [bal(WETH, '1', 18, 3000, 'WETH')] }));

      expect(route.directDestination).toBe(true);
      expect(route.bridge).toBeNull();
      expect(route.destination.swap.tokenSwap).toBeNull(); // sizing quote discarded
      expect(route.source.swaps).toHaveLength(1);
      // Path A selects toward target = toToken with outputRequired = toAmount + srcBuffer(min 2%/$1 → $1 → 1 PEPE) = 101.
      const arg = vi.mocked(selectDirectDestinationSwaps).mock.calls[0][0];
      expect(arg.target).toEqual(expect.objectContaining({ contractAddress: PEPE, decimals: 18 }));
      expect(arg.outputRequired.toString()).toBe('101');
      expect(route.source.srcBuffer?.toString()).toBe('1');
    });

    it('gas two-pass: token pass consumes [S1, 0.7·S2], gas pass receives the remainders [0.3·S2, S3]', async () => {
      const A1 = 1000000000000000000n; // 1 WETH
      const A2 = 1000000000000000000000n; // 1000 DAI
      const A3 = 500000000n; // 500 USDC
      const input: SwapData = { mode: SwapMode.EXACT_OUT, data: { toChainId: ARB_CHAIN, toTokenAddress: PEPE, toAmountRaw: 100000000000000000000n, toNativeAmountRaw: 1000000000000000000n } };
      vi.mocked(determineDestinationSwaps).mockResolvedValue(sizingQuote());
      vi.mocked(destinationGasSwapExactIn).mockResolvedValue(makeGasQuoteResponse({ chainID: ARB_CHAIN, inputContract: USDC_ARB }));
      vi.mocked(selectDirectDestinationSwaps)
        .mockResolvedValueOnce({ // token pass: consume S1 fully (A1) + S2 partially (0.7·A2)
          quoteResponses: [leg(WETH, A1, 18, PEPE, 60000000000000000000n, 18), leg(DAI, 700000000000000000000n, 18, PEPE, 41000000000000000000n, 18)],
          usedCOTs: [],
        })
        .mockResolvedValueOnce({ // gas pass
          quoteResponses: [leg(DAI, 300000000000000000000n, 18, EADDRESS, 1100000000000000000n, 18)],
          usedCOTs: [],
        });

      const route = await determineSwapRoute(input, makeRouteOptions({
        dstTokenInfo: pepeInfo,
        balances: [bal(WETH, '1', 18, 3000, 'WETH'), bal(DAI, '1000', 18, 1000, 'DAI'), bal(USDC_ARB, '500', 6, 500, 'USDC')],
        // Gas sizing (before the gate) needs the dst native (ZERO_ADDRESS) + COT prices in the oracle.
        oraclePrices: [
          { universe: 'EVM' as const, chainId: ARB_CHAIN, tokenAddress: ZERO_ADDRESS, tokenSymbol: 'ETH', tokenDecimals: 18, priceUsd: new Decimal(2500), timestamp: 1 },
          { universe: 'EVM' as const, chainId: ARB_CHAIN, tokenAddress: USDC_ARB, tokenSymbol: 'USDC', tokenDecimals: 6, priceUsd: new Decimal(1), timestamp: 1 },
        ] as OraclePriceResponse,
      }));

      expect(selectDirectDestinationSwaps).toHaveBeenCalledTimes(2);
      // Pass 1 targets the token; pass 2 targets native (EADDRESS) with the leftover holdings.
      expect(vi.mocked(selectDirectDestinationSwaps).mock.calls[0][0].target.contractAddress).toBe(PEPE);
      const gasArg = vi.mocked(selectDirectDestinationSwaps).mock.calls[1][0];
      expect(gasArg.target.contractAddress).toBe(EADDRESS);
      expect(gasArg.holdings.map((h) => [h.tokenAddress, h.amountRaw])).toEqual([
        [DAI, 300000000000000000000n], // 0.3·A2 remainder
        [USDC_ARB, A3], // untouched
      ]);
      // Merged source.swaps = 2 token legs + 1 gas leg; both buffers present.
      expect(route.source.swaps).toHaveLength(3);
      expect(route.source.gasSrcBuffer).toBeDefined();
      expect(route.directDestination).toBe(true);
    });

    it('falls back to the default flow when the direct selection cannot cover toAmount', async () => {
      const input: SwapData = { mode: SwapMode.EXACT_OUT, data: { toChainId: ARB_CHAIN, toTokenAddress: PEPE, toAmountRaw: 100000000000000000000n } };
      vi.mocked(determineDestinationSwaps).mockResolvedValue(sizingQuote());
      vi.mocked(selectDirectDestinationSwaps).mockResolvedValue({ quoteResponses: [leg(WETH, 1000000000000000000n, 18, PEPE, 50000000000000000000n, 18)], usedCOTs: [] }); // only 50 PEPE — short → builder throws
      vi.mocked(autoSelectSources).mockResolvedValue({ quoteResponses: [leg(WETH, 1000000000000000000n, 18, USDC_ARB, 200000000n, 6)], usedCOTs: [] }); // default COT selection

      const route = await determineSwapRoute(input, makeRouteOptions({ dstTokenInfo: pepeInfo, balances: [bal(WETH, '1', 18, 3000, 'WETH')] }));

      expect(route.directDestination).toBeFalsy();
      expect(route.destination.swap.tokenSwap).not.toBeNull(); // default double-hop dst swap (the discarded sizing quote)
    });

    it('is skipped when skipFastPaths is set', async () => {
      const input: SwapData = { mode: SwapMode.EXACT_OUT, data: { toChainId: ARB_CHAIN, toTokenAddress: PEPE, toAmountRaw: 100000000000000000000n } };
      vi.mocked(determineDestinationSwaps).mockResolvedValue(sizingQuote());
      vi.mocked(autoSelectSources).mockResolvedValue({ quoteResponses: [leg(WETH, 1000000000000000000n, 18, USDC_ARB, 200000000n, 6)], usedCOTs: [] });

      const route = await determineSwapRoute(input, makeRouteOptions({ dstTokenInfo: pepeInfo, balances: [bal(WETH, '1', 18, 3000, 'WETH')], skipFastPaths: true }));

      expect(route.directDestination).toBeFalsy();
      // Path A never runs — the default COT selection (autoSelectSources) does.
      expect(selectDirectDestinationSwaps).not.toHaveBeenCalled();
      expect(autoSelectSources).toHaveBeenCalled();
    });

    it('falls back when the direct selection covers toAmount but NOT the buffer (no drift margin)', async () => {
      // Regression: selectDirectDestinationSwaps returns partial coverage WITHOUT throwing. Delivering
      // exactly toAmount (100 PEPE) would leave srcBuffer(1) as a phantom drift budget a requote could
      // spend below toAmount. The builder must require the BUFFERED target (101), so this falls back.
      const input: SwapData = { mode: SwapMode.EXACT_OUT, data: { toChainId: ARB_CHAIN, toTokenAddress: PEPE, toAmountRaw: 100000000000000000000n } };
      vi.mocked(determineDestinationSwaps).mockResolvedValue(sizingQuote());
      vi.mocked(selectDirectDestinationSwaps).mockResolvedValue({ quoteResponses: [leg(WETH, 1000000000000000000n, 18, PEPE, 100000000000000000000n, 18)], usedCOTs: [] }); // exactly 100 PEPE = toAmount, < 101 buffered
      vi.mocked(autoSelectSources).mockResolvedValue({ quoteResponses: [leg(WETH, 1000000000000000000n, 18, USDC_ARB, 200000000n, 6)], usedCOTs: [] }); // default fallback
      const route = await determineSwapRoute(input, makeRouteOptions({ dstTokenInfo: pepeInfo, balances: [bal(WETH, '1', 18, 3000, 'WETH')] }));
      expect(route.directDestination).toBeFalsy();
      expect(route.destination.swap.tokenSwap).not.toBeNull(); // fell through to the default double-hop
    });

    it('prices the gas pass on the DST-chain native, not the first native entry in the oracle array', async () => {
      // Regression: BOTH priceUsdFor (convergence cap) AND applyBuffer (gasSrcBuffer) matched a native
      // (ZERO_ADDRESS) on tokenAddress alone → a decoy chain @ $1 placed first would win over ARB @ 2500.
      //   convergence cap (≈$0.50 of native): 0.5/2500·1e18 = 2e14  (not 5e17)
      //   gasSrcBuffer (0.1 ETH: $1 cap binds since 2% = 0.002 ETH > $1): min(0.002, 1/2500) = 0.0004 ETH
      //     (not min(0.002, 1/1) = 0.002 — the decoy's $1/ETH price)
      const input: SwapData = { mode: SwapMode.EXACT_OUT, data: { toChainId: ARB_CHAIN, toTokenAddress: PEPE, toAmountRaw: 100000000000000000000n, toNativeAmountRaw: 100000000000000000n } }; // 0.1 ETH
      vi.mocked(determineDestinationSwaps).mockResolvedValue(sizingQuote());
      vi.mocked(destinationGasSwapExactIn).mockResolvedValue(makeGasQuoteResponse({ chainID: ARB_CHAIN, inputContract: USDC_ARB }));
      vi.mocked(selectDirectDestinationSwaps)
        .mockResolvedValueOnce({ quoteResponses: [leg(WETH, 1000000000000000000n, 18, PEPE, 101000000000000000000n, 18)], usedCOTs: [] })
        .mockResolvedValueOnce({ quoteResponses: [leg(USDC_ARB, 300000000n, 6, EADDRESS, 110000000000000000n, 18)], usedCOTs: [] }); // delivers 0.11 ETH ≥ 0.1004 buffered
      const route = await determineSwapRoute(input, makeRouteOptions({
        dstTokenInfo: pepeInfo,
        balances: [bal(WETH, '1', 18, 3000, 'WETH'), bal(USDC_ARB, '500', 6, 500, 'USDC')],
        oraclePrices: [
          { universe: 'EVM' as const, chainId: BASE_CHAIN, tokenAddress: ZERO_ADDRESS, tokenSymbol: 'ETH', tokenDecimals: 18, priceUsd: new Decimal(1), timestamp: 1 }, // DECOY: wrong chain, first
          { universe: 'EVM' as const, chainId: ARB_CHAIN, tokenAddress: ZERO_ADDRESS, tokenSymbol: 'ETH', tokenDecimals: 18, priceUsd: new Decimal(2500), timestamp: 1 },
          { universe: 'EVM' as const, chainId: ARB_CHAIN, tokenAddress: USDC_ARB, tokenSymbol: 'USDC', tokenDecimals: 6, priceUsd: new Decimal(1), timestamp: 1 },
        ] as OraclePriceResponse,
      }));
      const gasArg = vi.mocked(selectDirectDestinationSwaps).mock.calls[1][0];
      expect(gasArg.maxConvergenceExtraRaw?.toString()).toBe('200000000000000'); // priceUsdFor: ARB price wins
      expect(route.source.gasSrcBuffer?.toString()).toBe('0.0004'); // applyBuffer: ARB price wins ($1 cap at 2500)
    });
  });

  it('EXACT_IN bridge totals exclude destination-chain source-swap COT', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_IN,
      data: {
        sources: [
          { chainId: BASE_CHAIN, tokenAddress: WETH, amountRaw: 1000000000000000000n },
          { chainId: ARB_CHAIN, tokenAddress: WETH, amountRaw: 1000000000000000000n },
        ],
        toChainId: ARB_CHAIN,
        toTokenAddress: USDC_ARB,
      },
    };
    vi.mocked(liquidateInputHoldings).mockResolvedValue([
      makeQuoteResponse({
        chainID: BASE_CHAIN,
        quote: {
          input: {
            contractAddress: WETH,
            amount: '1.0',
            amountRaw: 1000000000000000000n,
            decimals: 18,
            value: 3000,
            symbol: 'WETH',
          },
          output: {
            contractAddress: USDC_BASE,
            amount: '2000',
            amountRaw: 2000000000n,
            decimals: 6,
            value: 2000,
            symbol: 'USDC',
          },
          txData: {
            approvalAddress: '0x1111111111111111111111111111111111111111' as Hex,
            tx: {
              to: '0x2222222222222222222222222222222222222222' as Hex,
              data: '0xabcdef' as Hex,
              value: '0x0' as Hex,
            },
          },
        },
        holding: { chainID: BASE_CHAIN, tokenAddress: WETH, amountRaw: 1000000000000000000n, decimals: 18, symbol: 'WETH' },
      }),
      makeQuoteResponse({
        chainID: ARB_CHAIN,
        quote: {
          input: {
            contractAddress: WETH,
            amount: '1.0',
            amountRaw: 1000000000000000000n,
            decimals: 18,
            value: 3000,
            symbol: 'WETH',
          },
          output: {
            contractAddress: USDC_ARB,
            amount: '1000',
            amountRaw: 1000000000n,
            decimals: 6,
            value: 1000,
            symbol: 'USDC',
          },
          txData: {
            approvalAddress: '0x1111111111111111111111111111111111111111' as Hex,
            tx: {
              to: '0x2222222222222222222222222222222222222222' as Hex,
              data: '0xabcdef' as Hex,
              value: '0x0' as Hex,
            },
          },
        },
        holding: { chainID: ARB_CHAIN, tokenAddress: WETH, amountRaw: 1000000000000000000n, decimals: 18, symbol: 'WETH' },
      }),
    ]);
    vi.mocked(destinationSwapWithExactIn).mockResolvedValue(null);
    const route = await determineSwapRoute(
      input,
      makeRouteOptions({
        dstTokenInfo: makeDstTokenInfo({
          contractAddress: USDC_ARB,
          decimals: 6,
          symbol: 'USDC',
          name: 'USD Coin',
        }),
        balances: [
          {
            amount: '1',
            chainID: BASE_CHAIN,
            decimals: 18,
            symbol: 'WETH',
            tokenAddress: WETH,
            value: 3000,
            logo: '',
            name: 'WETH',
          },
          {
            amount: '1',
            chainID: ARB_CHAIN,
            decimals: 18,
            symbol: 'WETH',
            tokenAddress: WETH,
            value: 3000,
            logo: '',
            name: 'WETH',
          },
        ],
      })
    );
    expect(route.bridge?.assets.map((asset) => asset.chainID)).toEqual([BASE_CHAIN]);
    expect(route.bridge?.amount.toString()).toBe('2000');
    expect(route.bridge?.amounts.tokenAmount.toString()).toBe('2000');
    expect(route.bridge?.amounts.totalAmount.toString()).toBe('2000');
  });
  it('EXACT_IN quotes the destination from local COT plus bridged COT after fees', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_IN,
      data: {
        sources: [
          { chainId: ARB_CHAIN, tokenAddress: USDC_ARB, amountRaw: 100000000n },
          { chainId: BASE_CHAIN, tokenAddress: USDC_BASE, amountRaw: 10000000n },
        ],
        toChainId: BASE_CHAIN,
        toTokenAddress: WETH,
      },
    };
    vi.mocked(liquidateInputHoldings).mockResolvedValue([]);
    vi.mocked(destinationSwapWithExactIn).mockResolvedValue(
      makeDestinationQuoteResponse({
        chainID: BASE_CHAIN,
        quote: {
          input: {
            contractAddress: USDC_BASE,
            amount: '105.5',
            amountRaw: 105500000n,
            decimals: 6,
            value: 105.5,
            symbol: 'USDC',
          },
          output: {
            contractAddress: WETH,
            amount: '0.035',
            amountRaw: 35000000000000000n,
            decimals: 18,
            value: 105.5,
            symbol: 'WETH',
          },
          txData: {
            approvalAddress: '0x1111111111111111111111111111111111111111' as Hex,
            tx: {
              to: '0x2222222222222222222222222222222222222222' as Hex,
              data: '0xabcdef' as Hex,
              value: '0x0' as Hex,
            },
          },
        },
      })
    );
    const route = await determineSwapRoute(
      input,
      makeRouteOptions({
        balances: [
          {
            amount: '100',
            chainID: ARB_CHAIN,
            decimals: 6,
            symbol: 'USDC',
            tokenAddress: USDC_ARB,
            value: 100,
            logo: '',
            name: 'USDC',
          },
          {
            amount: '10',
            chainID: BASE_CHAIN,
            decimals: 6,
            symbol: 'USDC',
            tokenAddress: USDC_BASE,
            value: 10,
            logo: '',
            name: 'USDC',
          },
        ],
        bridgeQuoteResponse: {
          fulfillmentBps: 100,
          sources: [
            {
              chainId: ARB_CHAIN,
              tokenAddress: USDC_ARB,
              depositFeeUsd: '2',
              depositFeeToken: '2000000',
            },
          ],
          destination: {
            chainId: BASE_CHAIN,
            tokenAddress: USDC_BASE,
            fulfillmentFeeUsd: '1.5',
            fulfillmentFeeToken: '1500000',
          },
        } as never,
      })
    );
    expect(route.bridge?.amount.toString()).toBe('100');
    expect(route.bridge?.amounts.totalAmount.toString()).toBe('100');
    // Collection fee = 0 in the smart-account-only model; fulfilment/protocol still applied.
    expect(route.bridge?.amounts.tokenAmount.toString()).toBe('97.5');
    expect(route.bridge?.estimatedFees.collection.toString()).toBe('0');
    expect(route.bridge?.estimatedFees.fulfilment.toString()).toBe('1.5');
    expect(route.bridge?.estimatedFees.protocol.toString()).toBe('1');
    expect(vi.mocked(destinationSwapWithExactIn)).toHaveBeenCalled();
  });
  it('EXACT_IN coalesces direct COT and swap-produced COT on the same bridge chain', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_IN,
      data: {
        sources: [
          { chainId: ARB_CHAIN, tokenAddress: WETH, amountRaw: 1000000000000000000n },
          { chainId: ARB_CHAIN, tokenAddress: USDC_ARB, amountRaw: 10000000n },
        ],
        toChainId: BASE_CHAIN,
        toTokenAddress: USDC_BASE,
      },
    };
    vi.mocked(liquidateInputHoldings).mockResolvedValue([
      makeQuoteResponse({
        chainID: ARB_CHAIN,
        quote: {
          input: {
            contractAddress: WETH,
            amount: '1',
            amountRaw: 1000000000000000000n,
            decimals: 18,
            value: 40,
            symbol: 'WETH',
          },
          output: {
            contractAddress: USDC_ARB,
            amount: '40',
            amountRaw: 40000000n,
            decimals: 6,
            value: 40,
            symbol: 'USDC',
          },
          txData: {
            approvalAddress: '0x1111111111111111111111111111111111111111' as Hex,
            tx: {
              to: '0x2222222222222222222222222222222222222222' as Hex,
              data: '0xabcdef' as Hex,
              value: '0x0' as Hex,
            },
          },
        },
      }),
    ]);
    vi.mocked(destinationSwapWithExactIn).mockResolvedValue(null);
    const route = await determineSwapRoute(
      input,
      makeRouteOptions({
        dstTokenInfo: makeDstTokenInfo({
          contractAddress: USDC_BASE,
          decimals: 6,
          symbol: 'USDC',
          name: 'USD Coin',
        }),
        balances: [
          {
            amount: '1',
            chainID: ARB_CHAIN,
            decimals: 18,
            symbol: 'WETH',
            tokenAddress: WETH,
            value: 40,
            logo: '',
            name: 'WETH',
          },
          {
            amount: '10',
            chainID: ARB_CHAIN,
            decimals: 6,
            symbol: 'USDC',
            tokenAddress: USDC_ARB,
            value: 10,
            logo: '',
            name: 'USDC',
          },
        ],
      })
    );
    // Direct COT holdings still flow as `eoaBalance` (transfer EOA → ephemeral happens via
    // the bridge deposit batch). Swap-produced COT is tagged as `ephemeralBalance` since the
    // wrapper executes the swap and the bridge intent identity is always the ephemeral.
    expect(route.bridge?.assets).toEqual([
      expect.objectContaining({
        chainID: ARB_CHAIN,
        eoaBalance: new Decimal('10'),
        ephemeralBalance: new Decimal('40'),
      }),
    ]);
  });
  it('EXACT_IN with empty sources uses all available balances', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_IN,
      data: {
        sources: [],
        toChainId: ARB_CHAIN,
        toTokenAddress: USDC_ARB,
      },
    };
    const chainList = makeSwapChainList();
    chainList.getTokenByAddress = vi.fn().mockImplementation((chainId: number, tokenAddress: Hex) => {
      if (chainId === ARB_CHAIN && tokenAddress === WETH) {
        return { contractAddress: WETH, decimals: 18, symbol: 'WETH', name: 'Wrapped Ether', logo: '' };
      }
      if (chainId === ARB_CHAIN && tokenAddress === USDC_ARB) {
        return { contractAddress: USDC_ARB, decimals: 6, symbol: 'USDC', name: 'USD Coin', logo: '' };
      }
      return undefined;
    });
    vi.mocked(liquidateInputHoldings).mockResolvedValue([makeQuoteResponse()]);
    vi.mocked(destinationSwapWithExactIn).mockResolvedValue(null);
    const route = await determineSwapRoute(
      input,
      makeRouteOptions({
        chainList: chainList as unknown as ChainListType,
        dstTokenInfo: makeDstTokenInfo({ contractAddress: USDC_ARB, decimals: 6, symbol: 'USDC', name: 'USD Coin' }),
        balances: [
          { amount: '1', chainID: ARB_CHAIN, decimals: 18, symbol: 'WETH', tokenAddress: WETH, value: 3000, logo: '', name: 'WETH' },
          { amount: '5', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_ARB, value: 5, logo: '', name: 'USDC' },
        ],
      })
    );
    expect(vi.mocked(liquidateInputHoldings)).toHaveBeenCalledWith(
      expect.objectContaining({
        holdings: expect.arrayContaining([
          expect.objectContaining({
            chainID: ARB_CHAIN,
            tokenAddress: WETH,
            amountRaw: 1000000000000000000n,
          }),
        ]),
      })
    );
    expect(route.extras.assetsUsed).toHaveLength(2);
  });
  it('EXACT_IN uses the full available balance when a source amount is undefined', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_IN,
      data: {
        sources: [{ chainId: ARB_CHAIN, tokenAddress: WETH }],
        toChainId: ARB_CHAIN,
        toTokenAddress: USDC_ARB,
      },
    };
    vi.mocked(liquidateInputHoldings).mockResolvedValue([makeQuoteResponse()]);
    vi.mocked(destinationSwapWithExactIn).mockResolvedValue(null);
    await determineSwapRoute(
      input,
      makeRouteOptions({
        dstTokenInfo: makeDstTokenInfo({ contractAddress: USDC_ARB, decimals: 6, symbol: 'USDC', name: 'USD Coin' }),
        balances: [
          { amount: '1', chainID: ARB_CHAIN, decimals: 18, symbol: 'WETH', tokenAddress: WETH, value: 3000, logo: '', name: 'WETH' },
        ],
      })
    );
    expect(vi.mocked(liquidateInputHoldings)).toHaveBeenCalledWith(
      expect.objectContaining({
        holdings: [
          expect.objectContaining({
            chainID: ARB_CHAIN,
            tokenAddress: WETH,
            amountRaw: 1000000000000000000n,
            decimals: 18,
            symbol: 'WETH',
          }),
        ],
      })
    );
  });
  it('EXACT_IN rejects when a requested source amount exceeds the available balance', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_IN,
      data: {
        sources: [{ chainId: ARB_CHAIN, tokenAddress: WETH, amountRaw: 2000000000000000000n }],
        toChainId: ARB_CHAIN,
        toTokenAddress: USDC_ARB,
      },
    };
    await expect(
      determineSwapRoute(
        input,
        makeRouteOptions({
          dstTokenInfo: makeDstTokenInfo({ contractAddress: USDC_ARB, decimals: 6, symbol: 'USDC', name: 'USD Coin' }),
          balances: [
            { amount: '1', chainID: ARB_CHAIN, decimals: 18, symbol: 'WETH', tokenAddress: WETH, value: 3000, logo: '', name: 'WETH' },
          ],
        })
      )
    ).rejects.toThrow(/Insufficient balance/i);
    expect(liquidateInputHoldings).not.toHaveBeenCalled();
  });
  it('quotes with the executor address selected for the chain instead of always using the EOA address', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_IN,
      data: {
        sources: [{ chainId: ARB_CHAIN, tokenAddress: WETH, amountRaw: 1000000000000000000n }],
        toChainId: ARB_CHAIN,
        toTokenAddress: WETH,
      },
    };
    vi.mocked(liquidateInputHoldings).mockResolvedValue([makeQuoteResponse()]);
    vi.mocked(destinationSwapWithExactIn).mockResolvedValue(makeQuoteResponse());
    const routeOptions = {
      ...makeRouteOptions({
        eoaAddress: '0xaaaa000000000000000000000000000000000001' as Hex,
        balances: [{ amount: '1', chainID: ARB_CHAIN, decimals: 18, symbol: 'WETH', tokenAddress: WETH, value: 3000, logo: '', name: 'WETH' }],
      }),
      quoteAddressHints: new Map([[ARB_CHAIN, EPHEMERAL_EXECUTOR]]),
    } as RouteOptions & { quoteAddressHints: Map<number, Hex> };
    await determineSwapRoute(input, routeOptions);
    expect(
      vi.mocked(liquidateInputHoldings).mock.calls[0][0].userAddressByChain?.get(ARB_CHAIN)
    ).toBe(EPHEMERAL_EXECUTOR);
    expect(vi.mocked(destinationSwapWithExactIn)).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ userAddress: EPHEMERAL_EXECUTOR }),
      })
    );
  });
  it('EXACT_OUT getDstSwap rejects when a requote exceeds the original max budget', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: ARB_CHAIN, toTokenAddress: WETH, toAmountRaw: 1000000000000000000n },
    };
    vi.mocked(autoSelectSources).mockResolvedValue({
      quoteResponses: [],
      usedCOTs: [
        {
          holding: { chainID: ARB_CHAIN, tokenAddress: USDC_ARB, amountRaw: 3300000000n, decimals: 6, symbol: 'USDC' },
          amountUsed: new Decimal('3300'),
          idx: 0,
        },
      ],
    });
    vi.mocked(determineDestinationSwaps)
      .mockResolvedValueOnce(
        makeDestinationQuoteResponse({
          chainID: ARB_CHAIN,
          quote: {
            input: {
              contractAddress: USDC_ARB,
              amount: '3100',
              amountRaw: 3100000000n,
              decimals: 6,
              value: 3100,
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
                data: '0xabcdef' as Hex,
                value: '0x0' as Hex,
              },
            },
          },
        })
      )
      .mockResolvedValueOnce(
        makeDestinationQuoteResponse({
          chainID: ARB_CHAIN,
          quote: {
            input: {
              contractAddress: USDC_ARB,
              amount: '3130',
              amountRaw: 3130000000n,
              decimals: 6,
              value: 3130,
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
                data: '0xabcdef' as Hex,
                value: '0x0' as Hex,
              },
            },
          },
        })
      );
    const route = await determineSwapRoute(
      input,
      makeRouteOptions({
        balances: [{ amount: '4000', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_ARB, value: 4000, logo: '', name: 'USDC' }],
      })
    );
    // actual = 0 → budget = the route-time max, so the over-budget requote is rejected.
    await expect(route.destination.getDstSwap(0n)).rejects.toThrow(/max budget/i);
    // But the same requote is ACCEPTED once the actual wrapper balance covers it — the srcBuffer
    // that was bridged on top of the destination buffer lifts the budget to what really landed.
    const accepted = await route.destination.getDstSwap(1_000_000_000_000n);
    expect(accepted?.tokenSwap).not.toBeNull();
  });
  it('EXACT_OUT getDstSwap keeps the original buffered max on an accepted requote (buffer applied once)', async () => {
    // The dst buffer (min 10% / $2) is applied exactly once when the route is built.
    // A requote that moves `min` but stays within the frozen original max must NOT re-add
    // the buffer to `max` — otherwise the ceiling would creep up on every requote.
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: ARB_CHAIN, toTokenAddress: WETH, toAmountRaw: 1000000000000000000n },
    };
    vi.mocked(autoSelectSources).mockResolvedValue({
      quoteResponses: [],
      usedCOTs: [
        {
          holding: { chainID: ARB_CHAIN, tokenAddress: USDC_ARB, amountRaw: 3300000000n, decimals: 6, symbol: 'USDC' },
          amountUsed: new Decimal('3300'),
          idx: 0,
        },
      ],
    });
    vi.mocked(determineDestinationSwaps)
      // Initial build: input 3100 → dst buffer 2 → originalDestinationMaxInput = 3102.
      .mockResolvedValueOnce(
        makeDestinationQuoteResponse({
          chainID: ARB_CHAIN,
          quote: {
            input: { contractAddress: USDC_ARB, amount: '3100', amountRaw: 3100000000n, decimals: 6, value: 3100, symbol: 'USDC' },
            output: { contractAddress: WETH, amount: '1.0', amountRaw: 1000000000000000000n, decimals: 18, value: 3000, symbol: 'WETH' },
            txData: {
              approvalAddress: '0x1111111111111111111111111111111111111111' as Hex,
              tx: { to: '0x2222222222222222222222222222222222222222' as Hex, data: '0xabcdef' as Hex, value: '0x0' as Hex },
            },
          },
        })
      )
      // Requote: input 3101 — changed, but still ≤ 3102, so it is accepted.
      .mockResolvedValueOnce(
        makeDestinationQuoteResponse({
          chainID: ARB_CHAIN,
          quote: {
            input: { contractAddress: USDC_ARB, amount: '3101', amountRaw: 3101000000n, decimals: 6, value: 3101, symbol: 'USDC' },
            output: { contractAddress: WETH, amount: '1.0', amountRaw: 1000000000000000000n, decimals: 18, value: 3000, symbol: 'WETH' },
            txData: {
              approvalAddress: '0x1111111111111111111111111111111111111111' as Hex,
              tx: { to: '0x2222222222222222222222222222222222222222' as Hex, data: '0xabcdef' as Hex, value: '0x0' as Hex },
            },
          },
        })
      );
    const route = await determineSwapRoute(
      input,
      makeRouteOptions({
        balances: [{ amount: '4000', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_ARB, value: 4000, logo: '', name: 'USDC' }],
      })
    );
    expect(route.destination.inputAmount.max.toString()).toBe('3102');
    await route.destination.getDstSwap(0n);
    // min tracks the fresh requote; max stays pinned at the original buffered ceiling.
    expect(route.destination.inputAmount.min.toString()).toBe('3101');
    expect(route.destination.inputAmount.max.toString()).toBe('3102');
  });
  it('EXACT_OUT getDstSwap requotes the gas swap and rejects when its input drifts past the buffered max budget', async () => {
    // Initial: token swap input 3100 + gas swap input 22 = 3122 → dst buffer 2 → max 3124.
    // Requote: token 3100 + gas 30 = 3130 → exceeds 3124, must throw.
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: {
        toChainId: ARB_CHAIN,
        toTokenAddress: WETH,
        toAmountRaw: 1000000000000000000n,
        toNativeAmountRaw: 10000000000000000n,
      },
    };
    vi.mocked(autoSelectSources).mockResolvedValue({
      quoteResponses: [],
      usedCOTs: [
        {
          holding: { chainID: ARB_CHAIN, tokenAddress: USDC_ARB, amountRaw: 4000000000n, decimals: 6, symbol: 'USDC' },
          amountUsed: new Decimal('4000'),
          idx: 0,
        },
      ],
    });
    vi.mocked(determineDestinationSwaps).mockResolvedValue(
      makeDestinationQuoteResponse({
        chainID: ARB_CHAIN,
        quote: {
          input: { contractAddress: USDC_ARB, amount: '3100', amountRaw: 3100000000n, decimals: 6, value: 3100, symbol: 'USDC' },
          output: { contractAddress: WETH, amount: '1.0', amountRaw: 1000000000000000000n, decimals: 18, value: 3000, symbol: 'WETH' },
          txData: {
            approvalAddress: '0x1111111111111111111111111111111111111111' as Hex,
            tx: { to: '0x2222222222222222222222222222222222222222' as Hex, data: '0xabcdef' as Hex, value: '0x0' as Hex },
          },
        },
      })
    );
    vi.mocked(destinationGasSwapExactIn)
      .mockResolvedValueOnce(
        makeGasQuoteResponse({
          chainID: ARB_CHAIN,
          inputContract: USDC_ARB,
          inputAmountRaw: 22_000_000n,
          inputAmount: '22',
        })
      )
      .mockResolvedValueOnce(
        makeGasQuoteResponse({
          chainID: ARB_CHAIN,
          inputContract: USDC_ARB,
          inputAmountRaw: 30_000_000n,
          inputAmount: '30',
        })
      );
    const route = await determineSwapRoute(
      input,
      makeRouteOptions({
        oraclePrices: [
          { universe: 'EVM', chainId: ARB_CHAIN, priceUsd: new Decimal('2500'), tokenAddress: ZERO_ADDRESS, tokenSymbol: 'ETH', tokenDecimals: 18, timestamp: 0 },
          { universe: 'EVM', chainId: ARB_CHAIN, priceUsd: new Decimal('1'), tokenAddress: USDC_ARB, tokenSymbol: 'USDC', tokenDecimals: 6, timestamp: 0 },
        ],
        balances: [{ amount: '4000', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_ARB, value: 4000, logo: '', name: 'USDC' }],
      })
    );
    // Initial: token 3100 + gas 22 = 3122; dst buffer = min(10%, $2) → $2 → max = 3124.
    expect(route.destination.swap.gasSwap?.quote.input.amountRaw).toBe(22_000_000n);
    expect(route.destination.inputAmount.min.toString()).toBe('3122');
    expect(route.destination.inputAmount.max.toString()).toBe('3124');
    await expect(route.destination.getDstSwap(0n)).rejects.toThrow(/max budget/i);
  });
  it('EXACT_OUT getDstSwap accepts a gas-swap requote when total input stays under the buffered max', async () => {
    // Initial: 3100 + 22 = 3122; max 3124. Requote: 3100 + 24 = 3124 — at the cap, accepted.
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: {
        toChainId: ARB_CHAIN,
        toTokenAddress: WETH,
        toAmountRaw: 1000000000000000000n,
        toNativeAmountRaw: 10000000000000000n,
      },
    };
    vi.mocked(autoSelectSources).mockResolvedValue({
      quoteResponses: [],
      usedCOTs: [
        {
          holding: { chainID: ARB_CHAIN, tokenAddress: USDC_ARB, amountRaw: 4000000000n, decimals: 6, symbol: 'USDC' },
          amountUsed: new Decimal('4000'),
          idx: 0,
        },
      ],
    });
    vi.mocked(determineDestinationSwaps).mockResolvedValue(
      makeDestinationQuoteResponse({
        chainID: ARB_CHAIN,
        quote: {
          input: { contractAddress: USDC_ARB, amount: '3100', amountRaw: 3100000000n, decimals: 6, value: 3100, symbol: 'USDC' },
          output: { contractAddress: WETH, amount: '1.0', amountRaw: 1000000000000000000n, decimals: 18, value: 3000, symbol: 'WETH' },
          txData: {
            approvalAddress: '0x1111111111111111111111111111111111111111' as Hex,
            tx: { to: '0x2222222222222222222222222222222222222222' as Hex, data: '0xabcdef' as Hex, value: '0x0' as Hex },
          },
        },
      })
    );
    vi.mocked(destinationGasSwapExactIn)
      .mockResolvedValueOnce(
        makeGasQuoteResponse({
          chainID: ARB_CHAIN,
          inputContract: USDC_ARB,
          inputAmountRaw: 22_000_000n,
          inputAmount: '22',
        })
      )
      .mockResolvedValueOnce(
        makeGasQuoteResponse({
          chainID: ARB_CHAIN,
          inputContract: USDC_ARB,
          inputAmountRaw: 24_000_000n,
          inputAmount: '24',
        })
      );
    const route = await determineSwapRoute(
      input,
      makeRouteOptions({
        oraclePrices: [
          { universe: 'EVM', chainId: ARB_CHAIN, priceUsd: new Decimal('2500'), tokenAddress: ZERO_ADDRESS, tokenSymbol: 'ETH', tokenDecimals: 18, timestamp: 0 },
          { universe: 'EVM', chainId: ARB_CHAIN, priceUsd: new Decimal('1'), tokenAddress: USDC_ARB, tokenSymbol: 'USDC', tokenDecimals: 6, timestamp: 0 },
        ],
        balances: [{ amount: '4000', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_ARB, value: 4000, logo: '', name: 'USDC' }],
      })
    );
    expect(route.destination.inputAmount.max.toString()).toBe('3124');
    const requoted = await route.destination.getDstSwap(0n);
    expect(requoted?.gasSwap?.quote.input.amountRaw).toBe(24_000_000n);
    expect(route.destination.inputAmount.min.toString()).toBe('3124');
    expect(route.destination.inputAmount.max.toString()).toBe('3124');
  });
  it('EXACT_IN getDstSwap accepts a worsened requote (no rate tolerance guard)', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_IN,
      data: {
        sources: [{ chainId: ARB_CHAIN, tokenAddress: USDC_ARB, amountRaw: 5000000n }],
        toChainId: ARB_CHAIN,
        toTokenAddress: WETH,
      },
    };
    vi.mocked(liquidateInputHoldings).mockResolvedValue([]);
    vi.mocked(destinationSwapWithExactIn)
      .mockResolvedValueOnce(
        makeQuoteResponse({
          holding: { chainID: ARB_CHAIN, tokenAddress: USDC_ARB, amountRaw: 5000000n, decimals: 6, symbol: 'USDC' },
          quote: {
            input: {
              contractAddress: USDC_ARB,
              amount: '5',
              amountRaw: 5000000n,
              decimals: 6,
              value: 5,
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
                data: '0xabcdef' as Hex,
                value: '0x0' as Hex,
              },
            },
          },
        })
      )
      .mockResolvedValueOnce(
        makeQuoteResponse({
          holding: { chainID: ARB_CHAIN, tokenAddress: USDC_ARB, amountRaw: 5000000n, decimals: 6, symbol: 'USDC' },
          quote: {
            input: {
              contractAddress: USDC_ARB,
              amount: '5',
              amountRaw: 5000000n,
              decimals: 6,
              value: 5,
              symbol: 'USDC',
            },
            output: {
              contractAddress: WETH,
              amount: '0.99',
              amountRaw: 990000000000000000n,
              decimals: 18,
              value: 2970,
              symbol: 'WETH',
            },
            txData: {
              approvalAddress: '0x1111111111111111111111111111111111111111' as Hex,
              tx: {
                to: '0x2222222222222222222222222222222222222222' as Hex,
                data: '0xabcdef' as Hex,
                value: '0x0' as Hex,
              },
            },
          },
        })
      );
    const route = await determineSwapRoute(
      input,
      makeRouteOptions({
        balances: [{ amount: '5', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_ARB, value: 5, logo: '', name: 'USDC' }],
      })
    );
    // No rate guard for EXACT_IN: a requote 1% worse than the route-time quote is accepted, not thrown.
    const resized = await route.destination.getDstSwap(0n);
    expect(resized?.tokenSwap?.quote.output.amountRaw).toBe(990000000000000000n);
  });
  it('EXACT_OUT passes currencyId to resolveCOT via chainList.getTokenByCurrencyId', async () => {
    const customToken: TokenInfo = {
      contractAddress: USDC_ARB,
      decimals: 8,
      symbol: 'XCOT',
      name: 'Custom COT',
      logo: '',
      currencyId: 42,
    };
    const chainListMock = makeSwapChainList();
    chainListMock.getTokenByCurrencyId = vi.fn().mockImplementation((_chainId: number, cid: number) => {
      if (cid === 42) return customToken;
      throw new Error(`Token not found for currencyId=${cid}`);
    });
    vi.mocked(autoSelectSources).mockResolvedValue({
      quoteResponses: [],
      usedCOTs: [{ holding: { chainID: ARB_CHAIN, tokenAddress: USDC_ARB, amountRaw: 5000000000n, decimals: 6, symbol: 'USDC' }, amountUsed: new Decimal('50'), idx: 0 }],
    });
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: {
        toChainId: ARB_CHAIN,
        toTokenAddress: WETH,
        toAmountRaw: 1000000000000000000n,
      },
    };
    vi.mocked(determineDestinationSwaps).mockResolvedValue(
      makeDestinationQuoteResponse({
        chainID: ARB_CHAIN,
        quote: {
          input: {
            contractAddress: USDC_ARB,
            amount: '31',
            amountRaw: 3100000000n,
            decimals: 8,
            value: 31,
            symbol: 'XCOT',
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
            tx: { to: '0x2222222222222222222222222222222222222222' as Hex, data: '0xabcdef' as Hex, value: '0x0' as Hex },
          },
        },
      })
    );
    const route = await determineSwapRoute(input, makeRouteOptions({
      chainList: chainListMock as unknown as ChainListType,
      cotCurrencyId: 42 as CurrencyID,
        balances: [{ amount: '50', chainID: ARB_CHAIN, decimals: 8, symbol: 'XCOT', tokenAddress: USDC_ARB, value: 50, logo: '', name: 'XCOT' }],
      }));
    // Verify getTokenByCurrencyId was called with the non-default currencyId
    expect(chainListMock.getTokenByCurrencyId).toHaveBeenCalledWith(ARB_CHAIN, 42);
    expect(route.destination.inputAmount).toBeDefined();
  });
  it('EXACT_OUT converts balance amounts to holdings with parseUnits precision', async () => {
    // 999999999999999.999999 USDC (6 decimals) = 999999999999999999999n raw
    // Number() would round to 1000000000000000 → 1000000000000000000000n (WRONG)
    const largeBalance = {
      amount: '999999999999999.999999',
      chainID: ARB_CHAIN,
      decimals: 6,
      symbol: 'USDC',
      tokenAddress: USDC_ARB,
      value: 999999999999999,
      logo: '',
      name: 'USDC',
    };
    vi.mocked(autoSelectSources).mockResolvedValue({
      quoteResponses: [],
      usedCOTs: [{ holding: { chainID: ARB_CHAIN, tokenAddress: USDC_ARB, amountRaw: 1000000000000002999999n, decimals: 6, symbol: 'USDC' }, amountUsed: new Decimal('1000000000000002.999999'), idx: 0 }],
    });
    vi.mocked(determineDestinationSwaps).mockResolvedValue(
      makeDestinationQuoteResponse({
        chainID: ARB_CHAIN,
        quote: {
          input: {
            contractAddress: USDC_ARB,
            amount: '999999999999999.999999',
            amountRaw: 999999999999999999999n,
            decimals: 6,
            value: 999999999999999,
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
              data: '0xabcdef' as Hex,
              value: '0x0' as Hex,
            },
          },
        },
      })
    );
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: ARB_CHAIN, toTokenAddress: WETH, toAmountRaw: 1000000000000000000n },
    };
    await determineSwapRoute(input, makeRouteOptions({ balances: [largeBalance] }));
    // Verify autoSelectSources received the precise raw amount, not Number()-rounded
    const call = vi.mocked(autoSelectSources).mock.calls[0][0];
    const holding = call.holdings[0];
    expect(holding.amountRaw).toBe(999999999999999999999n);
  });

  it('routes source-swap recipient on non-7702 chains to the predicted Safe address', async () => {
    // EXACT_IN cross-chain: WETH on ARB (treated non-7702 via 'safe' hint) → USDC on BASE.
    // Source-swap recipient on ARB must equal the predicted Safe address (matches v1's
    // "taker == receiver = Safe" on non-Pectra source chains).
    const input: SwapData = {
      mode: SwapMode.EXACT_IN,
      data: {
        toChainId: BASE_CHAIN,
        toTokenAddress: USDC_BASE,
        sources: [{ chainId: ARB_CHAIN, tokenAddress: WETH }],
      },
    };
    vi.mocked(liquidateInputHoldings).mockResolvedValue([]);
    vi.mocked(determineDestinationSwaps).mockResolvedValue(null);
    await determineSwapRoute(
      input,
      makeRouteOptions({
        balances: [
          {
            amount: '1',
            chainID: ARB_CHAIN,
            decimals: 18,
            symbol: 'WETH',
            tokenAddress: WETH,
            value: 3000,
            logo: '',
            name: 'WETH',
          },
        ],
        walletPathHints: new Map<number, WalletPath>([
          [ARB_CHAIN, 'safe'],
          [BASE_CHAIN, 'ephemeral'],
        ]),
      })
    );
    const safeAddress = predictSafeAccountAddress(EPHEMERAL_EXECUTOR).address;
    expect(liquidateInputHoldings).toHaveBeenCalledOnce();
    const callArgs = vi.mocked(liquidateInputHoldings).mock.calls[0][0];
    expect(callArgs.recipientAddressByChain.get(ARB_CHAIN)).toBe(safeAddress);
    expect(callArgs.userAddressByChain.get(ARB_CHAIN)).toBe(safeAddress);
  });

  it('throws before any planning when forceMayan and destination USDC is mayanDisabled', async () => {
    const baseChainList = makeSwapChainList() as unknown as ChainListType;
    const chainList = {
      ...baseChainList,
      getTokenByAddress: vi.fn().mockImplementation((chainId: number, addr: Hex) => {
        const token = baseChainList.getTokenByAddress(chainId, addr);
        if (chainId === BASE_CHAIN) {
          return { ...token, mayanEnabled: false };
        }
        return token;
      }),
    } as unknown as ChainListType;

    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: BASE_CHAIN, toTokenAddress: WETH, toAmountRaw: 1000000000000000000n },
    };

    await expect(
      determineSwapRoute(input, makeRouteOptions({ chainList, forceMayan: true }))
    ).rejects.toThrow(/disabled for mayan/i);

    // Confirm we bailed before planning ran.
    expect(autoSelectSources).not.toHaveBeenCalled();
  });

  it('EXACT_IN throws naming the dropped chains when every source is below the Mayan per-leg minimum', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_IN,
      data: {
        sources: [
          { chainId: ARB_CHAIN, tokenAddress: USDC_ARB },
          { chainId: BASE_CHAIN, tokenAddress: USDC_BASE },
        ],
        toChainId: OP_CHAIN,
        toTokenAddress: USDC_OP,
      },
    };

    await expect(
      determineSwapRoute(
        input,
        makeRouteOptions({
          forceMayan: true,
          balances: [
            { amount: '0.5', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_ARB, value: 0.5, logo: '', name: 'USDC' },
            { amount: '0.7', chainID: BASE_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_BASE, value: 0.7, logo: '', name: 'USDC' },
          ],
        })
      )
    ).rejects.toThrow(/mayan.*≥.*1\.10.*USD.*per source.*excluded/is);
  });

  it('EXACT_IN drops sub-minimum chains silently when eligible chains cover the swap', async () => {
    // Sources on ARB (eligible $5) and BASE (sub-minimum $0.50); destination
    // is ARB so no bridge is needed once BASE is dropped — proves the filter
    // removes BASE without ending the route.
    const input: SwapData = {
      mode: SwapMode.EXACT_IN,
      data: {
        sources: [
          { chainId: ARB_CHAIN, tokenAddress: USDC_ARB },
          { chainId: BASE_CHAIN, tokenAddress: USDC_BASE },
        ],
        toChainId: ARB_CHAIN,
        toTokenAddress: USDC_ARB,
      },
    };

    vi.mocked(liquidateInputHoldings).mockResolvedValue([]);
    vi.mocked(destinationSwapWithExactIn).mockResolvedValue(null);

    const route = await determineSwapRoute(
      input,
      makeRouteOptions({
        forceMayan: true,
        dstTokenInfo: makeDstTokenInfo({
          contractAddress: USDC_ARB,
          decimals: 6,
          symbol: 'USDC',
          name: 'USD Coin',
        }),
        walletPathHints: new Map([[ARB_CHAIN, 'ephemeral']]),
        quoteAddressHints: new Map([[ARB_CHAIN, EPHEMERAL_EXECUTOR]]),
        balances: [
          { amount: '5', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_ARB, value: 5, logo: '', name: 'USDC' },
          { amount: '0.5', chainID: BASE_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_BASE, value: 0.5, logo: '', name: 'USDC' },
        ],
      })
    );

    // BASE ($0.50) is below the $1.10 floor — the route should not surface it
    // as a bridge asset, even though it was a candidate source.
    const bridgeChains = new Set(route.bridge?.assets.map((asset) => asset.chainID) ?? []);
    expect(bridgeChains.has(BASE_CHAIN)).toBe(false);
  });

  it('EXACT_IN Mayan floor ignores wallet chains that were not selected as sources', async () => {
    // One source on ARB (below the floor), but the wallet also holds dust on BASE and OP that
    // the user did NOT select. The per-leg floor must judge only the selected source, so the
    // shortfall names ARB alone — not the unselected dust chains.
    const input: SwapData = {
      mode: SwapMode.EXACT_IN,
      data: {
        sources: [{ chainId: ARB_CHAIN, tokenAddress: USDC_ARB }],
        toChainId: BASE_CHAIN,
        toTokenAddress: USDC_BASE,
      },
    };

    const err = await determineSwapRoute(
      input,
      makeRouteOptions({
        forceMayan: true,
        dstTokenInfo: makeDstTokenInfo({ contractAddress: USDC_BASE, decimals: 6, symbol: 'USDC', name: 'USD Coin' }),
        balances: [
          { amount: '0.5', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_ARB, value: 0.5, logo: '', name: 'USDC' },
          { amount: '0.3', chainID: BASE_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_BASE, value: 0.3, logo: '', name: 'USDC' },
          { amount: '0.2', chainID: OP_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_OP, value: 0.2, logo: '', name: 'USDC' },
        ],
      })
    ).catch((e: Error) => e);

    expect(err).toBeInstanceOf(Error);
    // Only the selected ARB chain is reported as excluded.
    expect((err as Error).message).toContain('Chain 42161');
    expect((err as Error).message).not.toContain('Chain 8453');
    expect((err as Error).message).not.toContain('Chain 10:');
  });

  it('EXACT_IN Mayan floor measures the selected amount, not the full chain balance', async () => {
    // ARB holds $5 of USDC but the user selects only $0.50 of it. The bridged leg is $0.50 —
    // below the $1.10 floor — so the route must drop ARB and fail, not pass on the $5 balance.
    const input: SwapData = {
      mode: SwapMode.EXACT_IN,
      data: {
        sources: [{ chainId: ARB_CHAIN, tokenAddress: USDC_ARB, amountRaw: 500_000n }],
        toChainId: BASE_CHAIN,
        toTokenAddress: USDC_BASE,
      },
    };

    vi.mocked(liquidateInputHoldings).mockResolvedValue([makeQuoteResponse({ chainID: ARB_CHAIN })]);
    vi.mocked(destinationSwapWithExactIn).mockResolvedValue(null);

    await expect(
      determineSwapRoute(
        input,
        makeRouteOptions({
          forceMayan: true,
          dstTokenInfo: makeDstTokenInfo({ contractAddress: USDC_BASE, decimals: 6, symbol: 'USDC', name: 'USD Coin' }),
          balances: [
            { amount: '5', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_ARB, value: 5, logo: '', name: 'USDC' },
          ],
        })
      )
    ).rejects.toThrow(/Mayan bridge requires/i);
  });

  it('EXACT_IN Nexus route never applies the per-leg floor (sub-$1.10 source still bridges)', async () => {
    // Default middleware returns nexus. A $0.50 source must NOT be dropped — the per-leg floor is
    // a Mayan-only constraint.
    const input: SwapData = {
      mode: SwapMode.EXACT_IN,
      data: {
        sources: [{ chainId: ARB_CHAIN, tokenAddress: USDC_ARB }],
        toChainId: BASE_CHAIN,
        toTokenAddress: USDC_BASE,
      },
    };

    vi.mocked(liquidateInputHoldings).mockResolvedValue([]);
    vi.mocked(destinationSwapWithExactIn).mockResolvedValue(null);

    const route = await determineSwapRoute(
      input,
      makeRouteOptions({
        dstTokenInfo: makeDstTokenInfo({ contractAddress: USDC_BASE, decimals: 6, symbol: 'USDC', name: 'USD Coin' }),
        balances: [
          { amount: '0.5', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_ARB, value: 0.5, logo: '', name: 'USDC' },
        ],
      })
    );

    expect(route.bridge).not.toBeNull();
    expect(route.bridge!.provider).toBe('nexus');
    expect(route.bridge!.assets.some((asset) => asset.chainID === ARB_CHAIN)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Bridge-provider selection parity (one shared decision helper, correct
// bridged amount, fast path participates)
// ---------------------------------------------------------------------------
describe('determineSwapRoute — bridge provider parity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Middleware that says "mayan" and returns one Mayan quote per requested source.
  const makeMayanMiddleware = () => ({
    getBridgeProvider: vi.fn().mockResolvedValue({ provider: 'mayan' }),
    getMayanQuotes: vi.fn().mockImplementation(
      async (req: {
        sources: { chain_id: Hex; contract_address: Hex; amount: string }[];
        destination: { chain_id: Hex; contract_address: Hex };
      }) => ({
        destination: req.destination,
        quotes: req.sources.map((s) => ({
          source: {
            chainId: Number(BigInt(s.chain_id)),
            tokenAddress: s.contract_address,
            amount: s.amount,
          },
          mayanQuote: { minReceived: s.amount, protocolBps: 3 },
        })),
      })
    ),
  });

  // A chain list where one chain's token reports mayanEnabled:false (non-throwing gate).
  const chainListWithDisabledToken = (chainId: number): ChainListType => {
    const base = makeSwapChainList() as unknown as ChainListType;
    return {
      ...base,
      getTokenByAddress: vi.fn().mockImplementation((cId: number, addr: Hex) => {
        const token = base.getTokenByAddress(cId, addr);
        return cId === chainId && token ? { ...token, mayanEnabled: false } : token;
      }),
    } as unknown as ChainListType;
  };

  it('EXACT_IN COT round-trip judges Mayan eligibility on the bridged COT, not the source token', async () => {
    // Repro: 2.9 USDT(OP) + 2.9 USDT(Arb) → 5.8 USDC(Base). The deployment has USDT NOT
    // mayan-enabled, but USDC (the bridged COT) IS. Source USDT is liquidated to USDC before any
    // bridge, so the bridge moves USDC — the eligibility gate must check USDC, not USDT. Server
    // returns mayan ($5.8 > $4 threshold); the route must NOT downgrade to nexus.
    const baseChainList = makeSwapChainList() as unknown as ChainListType;
    const chainList = {
      ...baseChainList,
      getTokenByAddress: vi.fn().mockImplementation((cId: number, addr: Hex) => {
        const token = baseChainList.getTokenByAddress(cId, addr);
        if (!token) return token;
        const isUsdt = [USDT_OP, USDT_ARB, USDT_BASE].some((a) => equalFold(a, addr));
        return { ...token, mayanEnabled: !isUsdt }; // USDT disabled, USDC enabled
      }),
    } as unknown as ChainListType;

    const THRESHOLD_USD = 4;
    let sentAmountRaw: string | undefined;
    const middleware = {
      getBridgeProvider: vi.fn().mockImplementation(async (req: { destination: { amount: string } }) => {
        sentAmountRaw = req.destination.amount;
        const usdValue = Number(req.destination.amount) / 1e6;
        return { provider: usdValue > THRESHOLD_USD ? 'mayan' : 'nexus' };
      }),
      getMayanQuotes: vi.fn().mockImplementation(async (req: { sources: { chain_id: Hex; contract_address: Hex; amount: string }[]; destination: unknown }) => ({
        destination: req.destination,
        quotes: req.sources.map((s) => ({
          source: { chainId: Number(BigInt(s.chain_id)), tokenAddress: s.contract_address, amount: s.amount },
          mayanQuote: { minReceived: s.amount, protocolBps: 3 },
        })),
      })),
    };

    // USDT → USDC liquidation on each source chain (~2.9 USDC out each).
    vi.mocked(liquidateInputHoldings).mockResolvedValue([
      makeQuoteResponse({
        chainID: OP_CHAIN,
        quote: {
          input: { contractAddress: USDT_OP, amount: '2.9', amountRaw: 2_900_000n, decimals: 6, value: 2.9, symbol: 'USDT' },
          output: { contractAddress: USDC_OP, amount: '2.9', amountRaw: 2_900_000n, decimals: 6, value: 2.9, symbol: 'USDC' },
          txData: { approvalAddress: '0x1111111111111111111111111111111111111111' as Hex, tx: { to: '0x2222222222222222222222222222222222222222' as Hex, data: '0xabcdef' as Hex, value: '0x0' as Hex } },
        },
        holding: { chainID: OP_CHAIN, tokenAddress: USDT_OP, amountRaw: 2_900_000n, decimals: 6, symbol: 'USDT' },
      }),
      makeQuoteResponse({
        chainID: ARB_CHAIN,
        quote: {
          input: { contractAddress: USDT_ARB, amount: '2.9', amountRaw: 2_900_000n, decimals: 6, value: 2.9, symbol: 'USDT' },
          output: { contractAddress: USDC_ARB, amount: '2.9', amountRaw: 2_900_000n, decimals: 6, value: 2.9, symbol: 'USDC' },
          txData: { approvalAddress: '0x1111111111111111111111111111111111111111' as Hex, tx: { to: '0x2222222222222222222222222222222222222222' as Hex, data: '0xabcdef' as Hex, value: '0x0' as Hex } },
        },
        holding: { chainID: ARB_CHAIN, tokenAddress: USDT_ARB, amountRaw: 2_900_000n, decimals: 6, symbol: 'USDT' },
      }),
    ]);
    vi.mocked(destinationSwapWithExactIn).mockResolvedValue(null); // dst IS COT (USDC) → no dst swap

    const route = await determineSwapRoute(
      {
        mode: SwapMode.EXACT_IN,
        data: {
          sources: [
            { chainId: OP_CHAIN, tokenAddress: USDT_OP },
            { chainId: ARB_CHAIN, tokenAddress: USDT_ARB },
          ],
          toChainId: BASE_CHAIN,
          toTokenAddress: USDC_BASE,
        },
      },
      makeRouteOptions({
        middlewareClient: middleware as never,
        chainList,
        dstTokenInfo: makeDstTokenInfo({ contractAddress: USDC_BASE, decimals: 6, symbol: 'USDC', name: 'USD Coin' }),
        balances: [
          { amount: '2.9', chainID: OP_CHAIN, decimals: 6, symbol: 'USDT', tokenAddress: USDT_OP, value: 2.9, logo: '', name: 'Tether USD' },
          { amount: '2.9', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDT', tokenAddress: USDT_ARB, value: 2.9, logo: '', name: 'Tether USD' },
        ],
        walletPathHints: new Map([[OP_CHAIN, 'ephemeral'], [ARB_CHAIN, 'ephemeral'], [BASE_CHAIN, 'ephemeral']]),
        quoteAddressHints: new Map([[OP_CHAIN, EPHEMERAL_EXECUTOR], [ARB_CHAIN, EPHEMERAL_EXECUTOR], [BASE_CHAIN, EPHEMERAL_EXECUTOR]]),
      })
    );

    expect(sentAmountRaw).toBe('5800000'); // $5.8 of bridged USDC was sent to the provider check
    expect(route.bridge!.provider).toBe('mayan');
    expect(route.bridge!.mayanQuotesBySource?.size).toBe(2);
  });

  it('EXACT_IN sends only the remote (non-dst, in-source) bridged USD, not all balances', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_IN,
      data: {
        sources: [
          { chainId: ARB_CHAIN, tokenAddress: USDC_ARB },
          { chainId: BASE_CHAIN, tokenAddress: USDC_BASE },
        ],
        toChainId: BASE_CHAIN,
        toTokenAddress: USDC_BASE,
      },
    };
    await determineSwapRoute(
      input,
      makeRouteOptions({
        dstTokenInfo: makeDstTokenInfo({ contractAddress: USDC_BASE, decimals: 6, symbol: 'USDC', name: 'USD Coin' }),
        balances: [
          { amount: '5', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_ARB, value: 5, logo: '', name: 'USDC' },
          { amount: '3', chainID: BASE_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_BASE, value: 3, logo: '', name: 'USDC' },
          // Not a requested source and on no bridged leg — must be ignored entirely.
          { amount: '100', chainID: OP_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_OP, value: 100, logo: '', name: 'USDC' },
        ],
      })
    );
    expect(mockMiddleware.getBridgeProvider).toHaveBeenCalledTimes(1);
    const req = mockMiddleware.getBridgeProvider.mock.calls[0][0];
    // Only ARB ($5) bridges: BASE sits on the dst chain, OP isn't a source.
    expect(req.destination.amount).toBe('5000000');
    expect(equalFold(req.destination.contract_address, USDC_BASE)).toBe(true);
    expect(req.destination.chain_id).toBe(toHex(BASE_CHAIN));
  });

  it('EXACT_IN: server says mayan but a remote source is mayan-disabled → downgrades to nexus without throwing', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_IN,
      data: {
        sources: [
          { chainId: ARB_CHAIN, tokenAddress: USDC_ARB },
          { chainId: OP_CHAIN, tokenAddress: USDC_OP },
        ],
        toChainId: BASE_CHAIN,
        toTokenAddress: USDC_BASE,
      },
    };
    const route = await determineSwapRoute(
      input,
      makeRouteOptions({
        middlewareClient: makeMayanMiddleware() as never,
        chainList: chainListWithDisabledToken(OP_CHAIN),
        dstTokenInfo: makeDstTokenInfo({ contractAddress: USDC_BASE, decimals: 6, symbol: 'USDC', name: 'USD Coin' }),
        balances: [
          { amount: '5', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_ARB, value: 5, logo: '', name: 'USDC' },
          { amount: '5', chainID: OP_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_OP, value: 5, logo: '', name: 'USDC' },
        ],
      })
    );
    expect(route.bridge).not.toBeNull();
    expect(route.bridge!.provider).toBe('nexus');
    expect(route.bridge!.mayanQuotesBySource).toBeUndefined();
  });

  it('EXACT_IN: server says mayan and every remote source is enabled → mayan with per-source quotes', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_IN,
      data: {
        sources: [
          { chainId: ARB_CHAIN, tokenAddress: USDC_ARB },
          { chainId: OP_CHAIN, tokenAddress: USDC_OP },
        ],
        toChainId: BASE_CHAIN,
        toTokenAddress: USDC_BASE,
      },
    };
    const route = await determineSwapRoute(
      input,
      makeRouteOptions({
        middlewareClient: makeMayanMiddleware() as never,
        dstTokenInfo: makeDstTokenInfo({ contractAddress: USDC_BASE, decimals: 6, symbol: 'USDC', name: 'USD Coin' }),
        balances: [
          { amount: '5', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_ARB, value: 5, logo: '', name: 'USDC' },
          { amount: '5', chainID: OP_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_OP, value: 5, logo: '', name: 'USDC' },
        ],
      })
    );
    expect(route.bridge).not.toBeNull();
    expect(route.bridge!.provider).toBe('mayan');
    expect(route.bridge!.mayanQuotesBySource?.size).toBe(2);
  });

  it('EXACT_OUT sends the bridged (non-dst) rough prefix as the amount and still buffers autoSelect', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: ARB_CHAIN, toTokenAddress: WETH, toAmountRaw: 1000000000000000000n },
    };
    vi.mocked(determineDestinationSwaps).mockResolvedValue(
      makeDestinationQuoteResponse({ chainID: ARB_CHAIN })
    );
    vi.mocked(autoSelectSources).mockResolvedValue({
      quoteResponses: [],
      usedCOTs: [
        {
          holding: { chainID: BASE_CHAIN, tokenAddress: USDC_BASE, amountRaw: 3103000000n, decimals: 6, symbol: 'USDC' },
          amountUsed: new Decimal('3103'),
          idx: 0,
        },
      ],
    });
    await determineSwapRoute(
      input,
      makeRouteOptions({
        balances: [
          // dst-chain holding ($1000) — covers part of the requirement but never bridges.
          { amount: '1000', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_ARB, value: 1000, logo: '', name: 'USDC' },
          // remote holding ($5000) — the only one that bridges.
          { amount: '5000', chainID: BASE_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_BASE, value: 5000, logo: '', name: 'USDC' },
        ],
      })
    );
    const req = mockMiddleware.getBridgeProvider.mock.calls[0][0];
    // Bridged prefix excludes the $1000 dst-chain holding → $5000 raw (not $6000).
    expect(req.destination.amount).toBe('5000000000');
    expect(equalFold(req.destination.contract_address, USDC_ARB)).toBe(true);
    // autoSelect still gets the full buffered requirement (3100 + buffers).
    expect(vi.mocked(autoSelectSources).mock.calls[0][0].outputRequired.toString()).toBe('3103');
  });

  it('EXACT_OUT: server says mayan but a bridged source is mayan-disabled → nexus', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: ARB_CHAIN, toTokenAddress: WETH, toAmountRaw: 1000000000000000000n },
    };
    vi.mocked(determineDestinationSwaps).mockResolvedValue(
      makeDestinationQuoteResponse({ chainID: ARB_CHAIN })
    );
    vi.mocked(autoSelectSources).mockResolvedValue({
      quoteResponses: [],
      usedCOTs: [
        {
          holding: { chainID: BASE_CHAIN, tokenAddress: USDC_BASE, amountRaw: 3103000000n, decimals: 6, symbol: 'USDC' },
          amountUsed: new Decimal('3103'),
          idx: 0,
        },
      ],
    });
    const route = await determineSwapRoute(
      input,
      makeRouteOptions({
        middlewareClient: makeMayanMiddleware() as never,
        chainList: chainListWithDisabledToken(BASE_CHAIN),
        balances: [
          { amount: '5000', chainID: BASE_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_BASE, value: 5000, logo: '', name: 'USDC' },
        ],
      })
    );
    expect(route.bridge).not.toBeNull();
    expect(route.bridge!.provider).toBe('nexus');
  });

  it('EXACT_OUT Mayan: folds the pre-estimated bridge fee (input − minReceived) into the source selection', async () => {
    // Before the real source quoting, the route rough-selects ~110% of the 1000 USDC requirement,
    // quotes Mayan, and folds the haircut (a flat $22 on the 1100 rough leg) into the target that
    // autoSelectSources must cover — so the real selection produces enough COT to survive the bridge
    // fee. Net dst-need + buffers is 1003; with the fee, autoSelect is asked for 1025.
    const mayanMw = {
      getBridgeProvider: vi.fn().mockResolvedValue({ provider: 'mayan' }),
      getMayanQuotes: vi.fn().mockImplementation(
        async (req: {
          sources: { chain_id: Hex; contract_address: Hex; amount: string }[];
          destination: { chain_id: Hex; contract_address: Hex };
        }) => ({
          destination: req.destination,
          quotes: req.sources.map((s) => ({
            source: { chainId: Number(BigInt(s.chain_id)), tokenAddress: s.contract_address, amount: s.amount },
            mayanQuote: { minReceived: Number(s.amount) / 1e6 - 22, protocolBps: 0 }, // flat $22 haircut/leg
          })),
        })
      ),
    };
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: ARB_CHAIN, toTokenAddress: USDC_ARB, toAmountRaw: 1_000_000_000n },
    };
    vi.mocked(determineDestinationSwaps).mockResolvedValue(null); // toToken IS COT → no dst swap
    vi.mocked(autoSelectSources).mockResolvedValue({
      quoteResponses: [],
      usedCOTs: [
        {
          holding: { chainID: BASE_CHAIN, tokenAddress: USDC_BASE, amountRaw: 1_100_000_000n, decimals: 6, symbol: 'USDC' },
          amountUsed: new Decimal('1100'),
          idx: 0,
        },
      ],
    });
    await determineSwapRoute(
      input,
      makeRouteOptions({
        middlewareClient: mayanMw as never,
        dstTokenInfo: makeDstTokenInfo({ contractAddress: USDC_ARB, decimals: 6, symbol: 'USDC', name: 'USD Coin' }),
        balances: [
          { amount: '1100', chainID: BASE_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_BASE, value: 1100, logo: '', name: 'USDC' },
        ],
      })
    );
    expect(autoSelectSources).toHaveBeenCalled();
    const { outputRequired } = vi.mocked(autoSelectSources).mock.calls[0][0];
    expect(outputRequired.toFixed()).toBe('1025');
  });

  it('EXACT_OUT Mayan: estimatedFees records the haircut (gross − Σ minReceived), not Nexus fees', async () => {
    // Symmetric to the Nexus gross-base fee test: 1100 USDC bridged via Mayan with a flat $22/leg
    // haircut → estimatedFees.protocol = 22, and the Nexus fulfilment/protocol are zeroed (Mayan's
    // fee is the minReceived shortfall, not the server's bps).
    const mayanMw = {
      getBridgeProvider: vi.fn().mockResolvedValue({ provider: 'mayan' }),
      getMayanQuotes: vi.fn().mockImplementation(
        async (req: {
          sources: { chain_id: Hex; contract_address: Hex; amount: string }[];
          destination: { chain_id: Hex; contract_address: Hex };
        }) => ({
          destination: req.destination,
          quotes: req.sources.map((s) => ({
            source: { chainId: Number(BigInt(s.chain_id)), tokenAddress: s.contract_address, amount: s.amount },
            mayanQuote: { minReceived: Number(s.amount) / 1e6 - 22, protocolBps: 0 },
          })),
        })
      ),
    };
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: ARB_CHAIN, toTokenAddress: USDC_ARB, toAmountRaw: 1_000_000_000n },
    };
    vi.mocked(determineDestinationSwaps).mockResolvedValue(null);
    vi.mocked(autoSelectSources).mockResolvedValue({
      quoteResponses: [],
      usedCOTs: [
        {
          holding: { chainID: BASE_CHAIN, tokenAddress: USDC_BASE, amountRaw: 1_100_000_000n, decimals: 6, symbol: 'USDC' },
          amountUsed: new Decimal('1100'),
          idx: 0,
        },
      ],
    });
    const route = await determineSwapRoute(
      input,
      makeRouteOptions({
        middlewareClient: mayanMw as never,
        dstTokenInfo: makeDstTokenInfo({ contractAddress: USDC_ARB, decimals: 6, symbol: 'USDC', name: 'USD Coin' }),
        balances: [
          { amount: '1100', chainID: BASE_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_BASE, value: 1100, logo: '', name: 'USDC' },
        ],
      })
    );
    expect(route.bridge!.provider).toBe('mayan');
    expect(route.bridge!.estimatedFees.protocol.toString()).toBe('22');
    expect(route.bridge!.estimatedFees.fulfilment.toString()).toBe('0');
    expect(route.bridge!.estimatedFees.collection.toString()).toBe('0');
  });

  it('fast path: queries the provider with the same-token (not USDC) and stays nexus by default', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_IN,
      data: {
        sources: [{ chainId: ARB_CHAIN, tokenAddress: USDT_ARB, amountRaw: 1_000_000n }],
        toChainId: BASE_CHAIN,
        toTokenAddress: USDT_BASE,
      },
    };
    const route = await determineSwapRoute(
      input,
      makeRouteOptions({
        dstTokenInfo: makeDstTokenInfo({ contractAddress: USDT_BASE, decimals: 6, symbol: 'USDT', name: 'Tether USD' }),
        balances: [
          { amount: '1', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDT', tokenAddress: USDT_ARB, value: 1, logo: '', name: 'Tether USD' },
        ],
      })
    );
    expect(mockMiddleware.getBridgeProvider).toHaveBeenCalledTimes(1);
    const req = mockMiddleware.getBridgeProvider.mock.calls[0][0];
    expect(equalFold(req.destination.contract_address, USDT_BASE)).toBe(true);
    expect(req.destination.amount).toBe('1000000');
    expect(route.bridge!.provider).toBe('nexus');
  });

  it('fast path: server says mayan and sources are enabled → mayan bridge with quotes', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_IN,
      data: {
        sources: [
          { chainId: ARB_CHAIN, tokenAddress: USDT_ARB, amountRaw: 1_000_000n },
          { chainId: OP_CHAIN, tokenAddress: USDT_OP, amountRaw: 1_000_000n },
        ],
        toChainId: BASE_CHAIN,
        toTokenAddress: USDT_BASE,
      },
    };
    const route = await determineSwapRoute(
      input,
      makeRouteOptions({
        middlewareClient: makeMayanMiddleware() as never,
        dstTokenInfo: makeDstTokenInfo({ contractAddress: USDT_BASE, decimals: 6, symbol: 'USDT', name: 'Tether USD' }),
        balances: [
          { amount: '1', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDT', tokenAddress: USDT_ARB, value: 1, logo: '', name: 'Tether USD' },
          { amount: '1', chainID: OP_CHAIN, decimals: 6, symbol: 'USDT', tokenAddress: USDT_OP, value: 1, logo: '', name: 'Tether USD' },
        ],
      })
    );
    expect(route.bridge!.provider).toBe('mayan');
    expect(route.bridge!.mayanQuotesBySource?.size).toBe(2);
  });

  it('fast path native dst participates in provider selection (calls the provider endpoint with the normalized zero-address)', async () => {
    const mayanMw = makeMayanMiddleware();
    const input: SwapData = {
      mode: SwapMode.EXACT_IN,
      data: {
        sources: [{ chainId: ARB_CHAIN, tokenAddress: EADDRESS, amountRaw: 1_000_000_000_000_000_000n }],
        toChainId: BASE_CHAIN,
        toTokenAddress: EADDRESS,
      },
    };
    const route = await determineSwapRoute(
      input,
      makeRouteOptions({
        middlewareClient: mayanMw as never,
        dstTokenInfo: makeDstTokenInfo({ contractAddress: EADDRESS, decimals: 18, symbol: 'ETH', name: 'Ether' }),
        balances: [
          { amount: '1', chainID: ARB_CHAIN, decimals: 18, symbol: 'ETH', tokenAddress: EADDRESS, value: 3000, logo: '', name: 'Ether' },
        ],
      })
    );
    // Native is no longer a hard Nexus default — it goes through provider selection like any token,
    // with the destination normalized to the zero address for the server request.
    expect(mayanMw.getBridgeProvider).toHaveBeenCalledTimes(1);
    expect(mayanMw.getBridgeProvider.mock.calls[0][0].destination.contract_address).toBe(
      '0x0000000000000000000000000000000000000000'
    );
    // Server picks mayan, but the native source isn't Mayan-verifiable in this fixture
    // (getTokenByAddress(native) is unresolved) → downgraded to nexus. forceMayan would keep mayan.
    expect(route.bridge!.provider).toBe('nexus');
  });

  it('EXACT_IN with a zero-value remote holding sends amount 0 (biasing to nexus)', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_IN,
      data: {
        sources: [{ chainId: ARB_CHAIN, tokenAddress: USDC_ARB }],
        toChainId: BASE_CHAIN,
        toTokenAddress: USDC_BASE,
      },
    };
    await determineSwapRoute(
      input,
      makeRouteOptions({
        dstTokenInfo: makeDstTokenInfo({ contractAddress: USDC_BASE, decimals: 6, symbol: 'USDC', name: 'USD Coin' }),
        // value: 0 and no oracle price → no USD basis → 0.
        balances: [
          { amount: '5', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC_ARB, value: 0, logo: '', name: 'USDC' },
        ],
      })
    );
    expect(mockMiddleware.getBridgeProvider.mock.calls[0][0].destination.amount).toBe('0');
  });
});
