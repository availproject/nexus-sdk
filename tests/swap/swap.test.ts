import { describe, expect, it, vi, beforeEach } from 'vitest';
import Decimal from 'decimal.js';
import type { Hex, WalletClient } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import { createSwapPlan } from '../../src/swap/swap-steps-builder';

vi.mock('../../src/swap/route', () => ({
  determineSwapRoute: vi.fn(),
}));

vi.mock('../../src/swap/intent', () => ({
  createSwapIntent: vi.fn(),
}));

vi.mock('../../src/swap/execution/source-swaps', () => ({
  executeSourceSwaps: vi.fn(),
}));

vi.mock('../../src/swap/execution/bridge', () => ({
  executeSwapBridge: vi.fn(),
}));

vi.mock('../../src/swap/execution/destination-swap', () => ({
  executeDestinationSwap: vi.fn(),
}));

vi.mock('../../src/swap/execution/failure-cleanup', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/swap/execution/failure-cleanup')>()),
  cleanupStrandedCot: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/services/balances', () => ({
  getBalancesForSwap: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/services/sbc', () => ({
  createSBCTxFromCalls: vi.fn().mockResolvedValue({
    chainId: 42161,
    address: '0x0000000000000000000000000000000000000abc' as Hex,
    calls: [],
    deadline: '0x1' as Hex,
    keyHash: '0x0' as Hex,
    nonce: '0x1' as Hex,
    revertOnFailure: true,
    signature: '0x1234' as Hex,
  }),
  requireSuccessfulSbcResult: vi.fn((results, chainId) => {
    const result = results.find((entry: { chainId: number }) => entry.chainId === chainId);
    if (!result || result.errored) {
      throw new Error(result?.message ?? 'cleanup failed');
    }
    return result.txHash;
  }),
}));

vi.mock('../../src/swap/preflight', () => ({
  buildSwapPreflight: vi.fn(),
}));

import { swap as flowSwap } from '../../src/flows/swap';
import { cleanupStrandedCot } from '../../src/swap/execution/failure-cleanup';
import { buildSwapPreflight } from '../../src/swap/preflight';
import { determineSwapRoute } from '../../src/swap/route';
import { createSwapIntent } from '../../src/swap/intent';
import { executeSourceSwaps } from '../../src/swap/execution/source-swaps';
import { executeSwapBridge } from '../../src/swap/execution/bridge';
import { executeDestinationSwap } from '../../src/swap/execution/destination-swap';
import { SwapMode } from '../../src/swap/types';
import type { BridgeAsset, SwapData, SwapRoute, SwapIntent, OnSwapIntentHookData, SwapParams } from '../../src/swap/types';
import type { ChainListType, TokenInfo } from '../../src/domain';
import { CurrencyID } from '../../src/swap/cot';
import { makeMiddlewareClient } from '../helpers/middleware-client';
import {
  ARB_CHAIN,
  USDC_ARB,
  WETH,
  makeSwapChainList,
  makeSwapPreflight,
} from '../helpers/swap';

const makeBridge = (
  overrides?: Partial<NonNullable<SwapRoute['bridge']>>
): NonNullable<SwapRoute['bridge']> => ({
  amount: new Decimal('3000'),
  amounts: {
    tokenAmount: new Decimal('3000'),
    gasInCot: new Decimal(0),
    totalAmount: new Decimal('3000'),
  },
  assets: [],
  chainID: 8453,
  decimals: 6,
  tokenAddress: USDC_ARB,
  estimatedFees: {
    collection: new Decimal(0),
    fulfilment: new Decimal(0),
    caGas: new Decimal(0),
    protocol: new Decimal(0),
    solver: new Decimal(0),
  },
  ...overrides,
});

const makeRoute = (): SwapRoute => ({
  type: SwapMode.EXACT_OUT,
  settlementCurrencyId: CurrencyID.USDC,
  sameTokenBridge: false,
  source: { swaps: [], creationTime: Date.now(), srcBuffer: new Decimal(0) },
  bridge: null,
  destination: {
    chainId: ARB_CHAIN,
    eoaToEphemeral: null,
    inputAmount: { min: new Decimal('3000'), max: new Decimal('3150') },
    swap: { tokenSwap: null, gasSwap: null },
    getDstSwap: vi.fn().mockResolvedValue(null),
  },
  buffer: { amount: '0' },
  dstTokenInfo: { contractAddress: WETH, decimals: 18, symbol: 'WETH', name: 'Wrapped Ether', logo: '' } as TokenInfo,
  extras: { aggregators: [], oraclePrices: [], balances: [], assetsUsed: [] },
  sourceExecutionPaths: new Map(),
});

const makeIntent = (): SwapIntent => ({
  destination: {
    amount: '1.0',
    chain: { id: ARB_CHAIN, logo: '', name: 'Arbitrum' },
    token: { contractAddress: WETH, decimals: 18, symbol: 'WETH' },
    gas: { amount: '0', token: { contractAddress: '0x' as Hex, decimals: 18, symbol: 'ETH' } },
  },
  feesAndBuffer: { buffer: '0', bridge: null },
  sources: [],
});

const makeSwapParams = (overrides?: {
  onIntent?: (data: OnSwapIntentHookData) => void;
  emit?: SwapParams['emit'];
  timing?: SwapParams['timing'];
  middlewareClient?: SwapParams['middlewareClient'];
}): SwapParams => ({
  chainList: makeSwapChainList() as unknown as ChainListType,
  eoaWallet: { getCapabilities: vi.fn().mockResolvedValue({}) } as unknown as WalletClient,
  eoaAddress: '0xaaaa' as Hex,
  ephemeralWallet: {
    address: '0xbbbb000000000000000000000000000000000002' as Hex,
  } as unknown as PrivateKeyAccount,
  cotCurrencyId: CurrencyID.USDC,
  middlewareClient:
    overrides?.middlewareClient ??
    makeMiddlewareClient({
      getSwapBalances: vi.fn().mockResolvedValue([]),
      getOraclePrices: vi.fn().mockResolvedValue([]),
      getRFFStatus: vi.fn().mockResolvedValue({ status: 'created' }),
      submitSBCs: vi.fn().mockResolvedValue([
        {
          chainId: ARB_CHAIN,
          address: '0x0000000000000000000000000000000000000abc' as Hex,
          errored: false,
          txHash: '0xcleanup' as Hex,
        },
      ]),
    }),
  intentExplorerUrl: '',
  onIntent: overrides?.onIntent,
  emit: overrides?.emit ?? vi.fn(),
  timing: overrides?.timing,
});

const toSwapDeps = (params: SwapParams): Parameters<typeof flowSwap>[1] => ({
  chainList: params.chainList,
  timing: params.timing,
  middlewareClient: params.middlewareClient,
  intentExplorerUrl: params.intentExplorerUrl,
  evm: {
    walletClient: params.eoaWallet,
    address: params.eoaAddress,
  },
  swap: {
    ephemeralWallet: params.ephemeralWallet,
    cotCurrencyId: params.cotCurrencyId,
  },
});

const toSwapOptions = (params: SwapParams): Parameters<typeof flowSwap>[2] => ({
  onIntent: params.onIntent,
  onEvent: params.emit,
  preloadedBalances: params.preloadedBalances,
  slippageTolerance: params.slippage,
});

const swap = (input: SwapData, params: SwapParams) =>
  flowSwap(input, toSwapDeps(params), toSwapOptions(params));

describe('swap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(buildSwapPreflight).mockResolvedValue(makeSwapPreflight());
    vi.mocked(determineSwapRoute).mockResolvedValue(makeRoute());
    vi.mocked(createSwapIntent).mockReturnValue(makeIntent());
    vi.mocked(executeSourceSwaps).mockResolvedValue([]);
    vi.mocked(executeSwapBridge).mockResolvedValue(undefined);
    vi.mocked(executeDestinationSwap).mockResolvedValue(undefined);
  });

  it('full flow: route → intent → source → result', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: ARB_CHAIN, toTokenAddress: WETH, toAmountRaw: 1000000000000000000n },
    };

    // Auto-approve (no intent hook)
    const result = await swap(input, makeSwapParams());

    expect(determineSwapRoute).toHaveBeenCalled();
    expect(executeSourceSwaps).toHaveBeenCalled();
    expect(result).toBeDefined();
    expect(result.sourceSwaps).toBeDefined();
  });

  it('intent hook called with allow/deny', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: ARB_CHAIN, toTokenAddress: WETH, toAmountRaw: 1000000000000000000n },
    };

    let hookData: OnSwapIntentHookData | undefined;
    const onIntent = vi.fn().mockImplementation((data) => {
      hookData = data;
      data.allow(); // approve
    });

    await swap(input, makeSwapParams({ onIntent }));

    expect(onIntent).toHaveBeenCalledTimes(1);
    expect(hookData).toBeDefined();
    expect(hookData?.intent).toBeDefined();
    expect(typeof hookData?.allow).toBe('function');
    expect(typeof hookData?.deny).toBe('function');
  });

  it('user denies intent → throws', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: ARB_CHAIN, toTokenAddress: WETH, toAmountRaw: 1000000000000000000n },
    };

    const onIntent = vi.fn().mockImplementation((data) => {
      data.deny();
    });

    await expect(swap(input, makeSwapParams({ onIntent }))).rejects.toThrow();
  });

  it('allow() without refresh() returns original route, not empty object', async () => {
    const originalRoute = makeRoute();
    vi.mocked(determineSwapRoute).mockResolvedValue(originalRoute);

    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: ARB_CHAIN, toTokenAddress: WETH, toAmountRaw: 1000000000000000000n },
    };

    let capturedRoute: unknown;
    const onIntent = vi.fn().mockImplementation((data: OnSwapIntentHookData) => {
      // Call allow() immediately without refresh() — should use originalRoute
      data.allow();
    });

    const result = await swap(input, makeSwapParams({ onIntent }));

    // The route used for execution should be the original route, not {}
    // We can verify by checking executeSourceSwaps was called with the original route's source
    expect(vi.mocked(executeSourceSwaps)).toHaveBeenCalledTimes(1);
    const sourceArg = vi.mocked(executeSourceSwaps).mock.calls[0][0];
    expect(sourceArg).toBe(originalRoute.source);
  });

  it('same-chain swap skips bridge', async () => {
    const route = makeRoute();
    route.bridge = null;
    vi.mocked(determineSwapRoute).mockResolvedValue(route);

    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: ARB_CHAIN, toTokenAddress: WETH, toAmountRaw: 1000000000000000000n },
    };

    await swap(input, makeSwapParams());

    expect(executeSwapBridge).not.toHaveBeenCalled();
  });

  it('does not gate non-7702 sources for plain swap route construction (Safe handles them)', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: ARB_CHAIN, toTokenAddress: WETH, toAmountRaw: 1000000000000000000n },
    };

    await swap(input, makeSwapParams());

    expect(vi.mocked(determineSwapRoute).mock.calls[0][1]).not.toMatchObject({
      excludeNon7702Sources: true,
    });
  });

  it('refresh re-routes and returns new intent', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: ARB_CHAIN, toTokenAddress: WETH, toAmountRaw: 1000000000000000000n },
    };

    // Second route returned on refresh
    const refreshedRoute = makeRoute();
    const refreshedIntent = makeIntent();
    refreshedIntent.destination.amount = '2.0';

    vi.mocked(determineSwapRoute)
      .mockResolvedValueOnce(makeRoute())    // initial
      .mockResolvedValueOnce(refreshedRoute); // refresh
    vi.mocked(createSwapIntent)
      .mockReturnValueOnce(makeIntent())       // initial
      .mockReturnValueOnce(refreshedIntent);   // refresh

    const onIntent = vi.fn().mockImplementation((data: OnSwapIntentHookData) => {
      // Call refresh, then allow once it resolves
      data.refresh().then((newIntent) => {
        expect(newIntent.destination.amount).toBe('2.0');
        data.allow();
      });
    });

    await swap(input, makeSwapParams({ onIntent }));

    expect(onIntent).toHaveBeenCalledTimes(1);
    expect(determineSwapRoute).toHaveBeenCalledTimes(2);
  });

  it('does not gate non-7702 sources during intent refresh rerouting (Safe handles them)', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: ARB_CHAIN, toTokenAddress: WETH, toAmountRaw: 1000000000000000000n },
    };

    vi.mocked(determineSwapRoute)
      .mockResolvedValueOnce(makeRoute())
      .mockResolvedValueOnce(makeRoute());
    vi.mocked(createSwapIntent)
      .mockReturnValueOnce(makeIntent())
      .mockReturnValueOnce(makeIntent());

    const onIntent = vi.fn().mockImplementation((data: OnSwapIntentHookData) => {
      void data.refresh().then(() => data.allow());
    });

    await swap(input, makeSwapParams({ onIntent }));

    expect(vi.mocked(determineSwapRoute).mock.calls[0][1]).not.toMatchObject({
      excludeNon7702Sources: true,
    });
    expect(vi.mocked(determineSwapRoute).mock.calls[1][1]).not.toMatchObject({
      excludeNon7702Sources: true,
    });
  });

  it('re-emits plan_preview for the refreshed route before approval', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: ARB_CHAIN, toTokenAddress: WETH, toAmountRaw: 1000000000000000000n },
    };

    const initialRoute = makeRoute();
    const refreshedRoute = makeRoute();
    refreshedRoute.bridge = makeBridge();
    const initialIntent = makeIntent();
    const refreshedIntent = makeIntent();
    refreshedIntent.destination.amount = '2.0';

    vi.mocked(determineSwapRoute)
      .mockResolvedValueOnce(initialRoute)
      .mockResolvedValueOnce(refreshedRoute);
    vi.mocked(createSwapIntent)
      .mockReturnValueOnce(initialIntent)
      .mockReturnValueOnce(refreshedIntent);

    const emit = vi.fn();
    const onIntent = vi.fn().mockImplementation((data: OnSwapIntentHookData) => {
      void data.refresh().then((nextIntent) => {
        expect(nextIntent.destination.amount).toBe('2.0');
        data.allow();
      });
    });

    await swap(input, makeSwapParams({ onIntent, emit }));

    expect(onIntent).toHaveBeenCalledTimes(1);
    expect(determineSwapRoute).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls.map(([event]) => event)).toEqual(
      expect.arrayContaining([
        { type: 'status', status: 'route_building' },
        { type: 'status', status: 'route_ready' },
        {
          type: 'plan_preview',
          plan: createSwapPlan(initialRoute, makeSwapParams().chainList),
        },
        { type: 'status', status: 'awaiting_approval' },
        {
          type: 'plan_preview',
          plan: createSwapPlan(refreshedRoute, makeSwapParams().chainList),
        },
        { type: 'status', status: 'approved' },
      ])
    );
  });

  it('does not re-route when refresh is called after allow', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: ARB_CHAIN, toTokenAddress: WETH, toAmountRaw: 1000000000000000000n },
    };

    const originalIntent = makeIntent();
    vi.mocked(createSwapIntent).mockReturnValue(originalIntent);

    let refreshPromise: Promise<SwapIntent> | undefined;
    const onIntent = vi.fn().mockImplementation((data: OnSwapIntentHookData) => {
      data.allow();
      refreshPromise = data.refresh();
    });

    await swap(input, makeSwapParams({ onIntent }));
    await refreshPromise;

    expect(determineSwapRoute).toHaveBeenCalledTimes(1);
  });

  it('records timing spans for preflight, route, hooks, and execution stages', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: ARB_CHAIN, toTokenAddress: WETH, toAmountRaw: 1000000000000000000n },
    };

    const route = makeRoute();
    route.bridge = makeBridge();
    vi.mocked(determineSwapRoute).mockResolvedValue(route);

    const timing = {
      startSpan: vi.fn().mockImplementation((name: string) => name),
      endSpan: vi.fn(),
      withSpan: vi.fn(),
    };

    await swap(input, makeSwapParams({ timing }));

    const spanNames = timing.startSpan.mock.calls.map(([name]) => name);
    // Approach D: per-flow `flow.swap.root` was removed; runOp's opId is now
    // the dev-timing root. Children parent to the opId via the scoped timing
    // hook (validated separately in tests/analytics/run-op-timing.test.ts).
    expect(spanNames).toEqual(
      expect.arrayContaining([
        'flow.swap.preflight',
        'flow.swap.determine_route',
        'flow.swap.create_intent',
        'flow.swap.hooks',
        'flow.swap.execute_source',
        'flow.swap.execute_bridge',
        'flow.swap.execute_destination',
      ])
    );
    expect(spanNames).not.toContain('flow.swap.root');
  });

  it('emits the typed swap event stream', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: ARB_CHAIN, toTokenAddress: WETH, toAmountRaw: 1000000000000000000n },
    };

    const emit = vi.fn();
    const params = makeSwapParams();
    params.emit = emit;

    await swap(input, params);

    expect(emit).toHaveBeenCalled();
    expect(emit.mock.calls.map(([event]) => event)).toEqual(
      expect.arrayContaining([
        { type: 'status', status: 'route_building' },
        { type: 'status', status: 'route_ready' },
        expect.objectContaining({ type: 'plan_preview' }),
        { type: 'status', status: 'awaiting_approval' },
        { type: 'status', status: 'approved' },
        expect.objectContaining({ type: 'plan_confirmed' }),
        { type: 'status', status: 'executing' },
        { type: 'status', status: 'completed' },
      ])
    );
  });

  it('throws destination execution failures and does not emit status: completed', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: ARB_CHAIN, toTokenAddress: WETH, toAmountRaw: 1000000000000000000n },
    };

    const emit = vi.fn();
    vi.mocked(executeDestinationSwap).mockRejectedValueOnce(new Error('destination failed'));

    await expect(swap(input, makeSwapParams({ emit }))).rejects.toThrow('destination failed');

    expect(emit.mock.calls.map(([event]) => event)).not.toContainEqual({
      type: 'status',
      status: 'completed',
    });
  });

  it('source failure triggers best-effort cleanup', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: ARB_CHAIN, toTokenAddress: WETH, toAmountRaw: 1000000000000000000n },
    };

    vi.mocked(executeSourceSwaps).mockRejectedValueOnce(new Error('source failed'));

    await expect(swap(input, makeSwapParams())).rejects.toThrow('source failed');

    expect(cleanupStrandedCot).toHaveBeenCalledTimes(1);
  });

  it('bridge failure triggers best-effort cleanup', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: 8453, toTokenAddress: WETH, toAmountRaw: 1000000000000000000n },
    };

    const route = makeRoute();
    route.bridge = makeBridge({
      assets: [
        {
          chainID: ARB_CHAIN,
          contractAddress: USDC_ARB,
          decimals: 6,
          eoaBalance: new Decimal(0),
          ephemeralBalance: new Decimal('3'),
        },
      ],
    });
    vi.mocked(determineSwapRoute).mockResolvedValue(route);
    vi.mocked(executeSwapBridge).mockRejectedValueOnce(new Error('bridge failed'));

    await expect(swap(input, makeSwapParams())).rejects.toThrow('bridge failed');

    expect(cleanupStrandedCot).toHaveBeenCalledTimes(1);
  });

  it('destination failure cleans up only the destination chain', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: ARB_CHAIN, toTokenAddress: WETH, toAmountRaw: 1000000000000000000n },
    };

    vi.mocked(executeDestinationSwap).mockRejectedValueOnce(new Error('destination failed'));

    await expect(swap(input, makeSwapParams())).rejects.toThrow('destination failed');

    // Reached the destination swap → cleanup targets only the destination chain.
    expect(cleanupStrandedCot).toHaveBeenCalledWith(
      expect.objectContaining({ chainIds: [ARB_CHAIN] })
    );
  });

  it('does not attempt cleanup for non-execution failures', async () => {
    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: ARB_CHAIN, toTokenAddress: WETH, toAmountRaw: 1000000000000000000n },
    };

    const onIntent = vi.fn().mockImplementation((data) => data.deny());

    await expect(swap(input, makeSwapParams({ onIntent }))).rejects.toThrow();

    expect(cleanupStrandedCot).not.toHaveBeenCalled();
  });

  it('cross-chain swap calls bridge', async () => {
    const route = makeRoute();
    route.bridge = makeBridge();
    vi.mocked(determineSwapRoute).mockResolvedValue(route);

    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: 8453, toTokenAddress: WETH, toAmountRaw: 1000000000000000000n },
    };

    await swap(input, makeSwapParams());

    expect(executeSwapBridge).toHaveBeenCalled();
  });

  it('passes preflight-resolved dstTokenInfo into route construction', async () => {
    const USDC_ADDR = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' as Hex;
    const resolvedToken: TokenInfo = {
      contractAddress: USDC_ADDR,
      decimals: 6,
      symbol: 'USDC',
      name: 'USD Coin',
      logo: 'https://example.com/usdc.png',
    };

    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: ARB_CHAIN, toTokenAddress: USDC_ADDR, toAmountRaw: 1000000n },
    };

    const params = makeSwapParams();
    vi.mocked(buildSwapPreflight).mockResolvedValueOnce(
      makeSwapPreflight({ dstTokenInfo: resolvedToken })
    );

    await swap(input, params);

    const routeOptionsArg = vi.mocked(determineSwapRoute).mock.calls[0][1];
    expect(routeOptionsArg.dstTokenInfo.decimals).toBe(6);
    expect(routeOptionsArg.dstTokenInfo.symbol).toBe('USDC');
  });

  it('intentExplorerUrl populated when bridge sets intent_request_hash', async () => {
    const route = makeRoute();
    route.bridge = makeBridge();
    vi.mocked(determineSwapRoute).mockResolvedValue(route);

    // Simulate bridge setting intent_request_hash on metadata
    vi.mocked(executeSwapBridge).mockImplementation(async (_bridge, _assets, _ctx, metadata) => {
      metadata.intent_request_hash = '0xabc123' as Hex;
    });

    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: 8453, toTokenAddress: WETH, toAmountRaw: 1000000000000000000n },
    };

    const params = makeSwapParams();
    params.intentExplorerUrl = 'https://explorer.example';

    const result = await swap(input, params);

    expect(result.intentExplorerUrl).toBe('https://explorer.example/rff/0xabc123');
  });

  it('refresh re-fetches oracle prices as well as balances before rerouting', async () => {
    const middlewareClient = makeMiddlewareClient({
      getSwapBalances: vi.fn().mockResolvedValue([]),
      getOraclePrices: vi.fn().mockResolvedValue([]),
    });

    // Override preflight mock to delegate to middleware client (as the real code does)
    vi.mocked(buildSwapPreflight).mockImplementation(async (_input, options) => {
      await options.middlewareClient.getOraclePrices();
      await options.middlewareClient.getSwapBalances(options.eoaAddress);
      return makeSwapPreflight();
    });

    const refreshedIntent = makeIntent();
    refreshedIntent.destination.amount = '2.0';

    vi.mocked(determineSwapRoute)
      .mockResolvedValueOnce(makeRoute())
      .mockResolvedValueOnce(makeRoute());
    vi.mocked(createSwapIntent)
      .mockReturnValueOnce(makeIntent())
      .mockReturnValueOnce(refreshedIntent);

    const onIntent = vi.fn().mockImplementation((data: OnSwapIntentHookData) => {
      void data.refresh().then(() => data.allow());
    });

    await swap(
      {
        mode: SwapMode.EXACT_OUT,
        data: { toChainId: ARB_CHAIN, toTokenAddress: WETH, toAmountRaw: 1000000000000000000n },
      },
      makeSwapParams({ onIntent, middlewareClient })
    );

    expect(middlewareClient.getSwapBalances).toHaveBeenCalledTimes(2);
    expect(middlewareClient.getOraclePrices).toHaveBeenCalledTimes(2);
  });

  it('bridges from executed source assets instead of route-time bridge estimates', async () => {
    const route = makeRoute();
    route.bridge = makeBridge();
    vi.mocked(determineSwapRoute).mockResolvedValue(route);

    const executedAssets: BridgeAsset[] = [
      {
        chainID: ARB_CHAIN,
        contractAddress: USDC_ARB,
        decimals: 6,
        eoaBalance: new Decimal(0),
        ephemeralBalance: new Decimal('2'),
      },
    ];
    vi.mocked(executeSourceSwaps).mockResolvedValueOnce(executedAssets);

    const input: SwapData = {
      mode: SwapMode.EXACT_OUT,
      data: { toChainId: 8453, toTokenAddress: WETH, toAmountRaw: 1000000000000000000n },
    };

    await swap(input, makeSwapParams());

    expect(vi.mocked(executeSwapBridge).mock.calls[0]?.[1]).toEqual(executedAssets);
  });
});
