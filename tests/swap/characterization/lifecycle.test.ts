// Top-level swap lifecycle characterization. The route, intent, plan, preparation, execution, and
// signing paths are real; only injected network boundaries are deterministic.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hex } from 'viem';
import { swap } from '../../../src/flows/swap';
import { SwapMode, type FlatBalance, type SwapIntent } from '../../../src/swap/types';
import {
  EOA,
  EPH_ACCOUNT,
  makeCharChainList,
  makeCharMiddleware,
  makeRealEoaWallet,
  readContractStub,
} from '../../helpers/swap-characterization';
import { makeTimingHooks } from '../../helpers/timing';
import { ARB_CHAIN, BASE_CHAIN, USDC_ARB, USDC_BASE } from '../../helpers/swap';

const hoisted = vi.hoisted(() => {
  const call = vi.fn();
  const readContract = vi.fn();
  const getCode = vi.fn();
  const getTransactionCount = vi.fn();
  const waitForTransactionReceipt = vi.fn();
  const multicall = vi.fn();
  const getBalance = vi.fn();
  const createPublicClient = vi.fn((options?: { chain?: unknown }) => ({
    chain: options?.chain,
    call,
    readContract,
    getCode,
    getTransactionCount,
    waitForTransactionReceipt,
    multicall,
    getBalance,
  }));

  return {
    call,
    readContract,
    getCode,
    getTransactionCount,
    waitForTransactionReceipt,
    multicall,
    getBalance,
    createPublicClient,
  };
});

vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem');
  return {
    ...actual,
    createPublicClient: hoisted.createPublicClient,
    http: vi.fn().mockReturnValue({}),
    fallback: vi.fn().mockReturnValue({}),
  };
});

const balances: FlatBalance[] = [
  {
    amount: '50',
    chainID: ARB_CHAIN,
    decimals: 6,
    symbol: 'USDC',
    tokenAddress: USDC_ARB,
    value: 50,
    name: 'USD Coin',
    logo: '',
  },
];

const input = {
  mode: SwapMode.EXACT_IN as const,
  data: {
    sources: [
      {
        chainId: ARB_CHAIN,
        tokenAddress: USDC_ARB,
        amountRaw: 50_000_000n,
      },
    ],
    toChainId: BASE_CHAIN,
    toTokenAddress: USDC_BASE,
  },
};

const makeHarness = () => {
  const middlewareClient = makeCharMiddleware({ balances });
  const wallet = makeRealEoaWallet();
  const deps: Parameters<typeof swap>[1] = {
    chainList: makeCharChainList(),
    intentExplorerUrl: 'https://intent.example',
    evm: { walletClient: wallet.wallet, address: EOA },
    forceMayan: false,
    middlewareClient,
    swap: { ephemeralWallet: EPH_ACCOUNT, cotCurrencyId: 1 },
  };

  return { deps, middlewareClient, wallet };
};

describe('top-level swap lifecycle characterization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.call.mockResolvedValue({ data: '0x' });
    hoisted.readContract.mockImplementation(readContractStub);
    hoisted.getCode.mockResolvedValue(undefined);
    hoisted.getTransactionCount.mockResolvedValue(0n);
    hoisted.getBalance.mockResolvedValue(0n);
    hoisted.waitForTransactionReceipt.mockImplementation(async ({ hash }: { hash: Hex }) => ({
      status: 'success',
      transactionHash: hash,
    }));
    hoisted.multicall.mockImplementation(async ({ contracts }: { contracts: unknown[] }) =>
      contracts.map(() => ({ status: 'success', result: 0n }))
    );
  });

  it('auto-approves when no intent hook is provided', async () => {
    const { deps, middlewareClient } = makeHarness();

    const result = await swap(input, deps);

    expect(result.intent.destination.token.contractAddress.toLowerCase()).toBe(
      USDC_BASE.toLowerCase()
    );
    expect(middlewareClient.submitRFF).toHaveBeenCalledTimes(1);
  });

  it('denies before execution and emits no wallet or middleware submission', async () => {
    const { deps, middlewareClient, wallet } = makeHarness();

    await expect(
      swap(input, deps, {
        onIntent: ({ deny }) => deny(),
      })
    ).rejects.toThrow('User denied swap intent');

    expect(wallet.sentTxs).toEqual([]);
    expect(middlewareClient.createSafeExecuteTx).not.toHaveBeenCalled();
    expect(middlewareClient.submitRFF).not.toHaveBeenCalled();
  });

  it('allows the original preview without rerouting', async () => {
    const { deps, middlewareClient } = makeHarness();

    const result = await swap(input, deps, {
      onIntent: ({ allow }) => allow(),
    });

    expect(middlewareClient.getSwapBalances).toHaveBeenCalledTimes(1);
    expect(middlewareClient.getOraclePrices).toHaveBeenCalledTimes(1);
    expect(result.intent.destination.token.contractAddress.toLowerCase()).toBe(
      USDC_BASE.toLowerCase()
    );
  });

  it('starts cache reads before showing the intent and reuses them after approval', async () => {
    const { deps } = makeHarness();
    let cacheCallsAtApproval = 0;
    let safeCodeReadsAtApproval = 0;

    await swap(input, deps, {
      onIntent: ({ allow }) => {
        cacheCallsAtApproval = hoisted.multicall.mock.calls.length;
        safeCodeReadsAtApproval = hoisted.getCode.mock.calls.length;
        allow();
      },
    });

    expect(cacheCallsAtApproval).toBeGreaterThan(0);
    expect(safeCodeReadsAtApproval).toBeGreaterThan(0);
    expect(hoisted.multicall).toHaveBeenCalledTimes(cacheCallsAtApproval);
    expect(hoisted.getCode).toHaveBeenCalledTimes(safeCodeReadsAtApproval);
  });

  it('refreshes balances, oracle prices, intent, and plan preview before approval', async () => {
    const { deps, middlewareClient } = makeHarness();
    const events: Array<{ type: string }> = [];
    let refreshedIntent: SwapIntent | undefined;

    await swap(input, deps, {
      onEvent: (event) => {
        events.push(event);
      },
      onIntent: ({ refresh, allow }) => {
        void refresh().then((intent) => {
          refreshedIntent = intent;
          allow();
        });
      },
    });

    expect(refreshedIntent?.destination.token.contractAddress.toLowerCase()).toBe(
      USDC_BASE.toLowerCase()
    );
    expect(middlewareClient.getSwapBalances).toHaveBeenCalledTimes(2);
    expect(middlewareClient.getOraclePrices).toHaveBeenCalledTimes(2);
    expect(events.filter((event) => event.type === 'plan_preview')).toHaveLength(2);
    expect(events.findIndex((event) => event.type === 'plan_confirmed')).toBeGreaterThan(
      events.map((event) => event.type).lastIndexOf('plan_preview')
    );
  });

  it('reuses the cache when a refreshed intent has the same query data', async () => {
    const { deps } = makeHarness();
    let initialCacheCalls = 0;
    let refreshedCacheCalls = 0;
    let initialCodeReads = 0;
    let refreshedCodeReads = 0;

    await swap(input, deps, {
      onIntent: ({ refresh, allow }) => {
        initialCacheCalls = hoisted.multicall.mock.calls.length;
        initialCodeReads = hoisted.getCode.mock.calls.length;
        void refresh().then(() => {
          refreshedCacheCalls = hoisted.multicall.mock.calls.length;
          refreshedCodeReads = hoisted.getCode.mock.calls.length;
          allow();
        });
      },
    });

    expect(initialCacheCalls).toBeGreaterThan(0);
    expect(refreshedCacheCalls).toBe(initialCacheCalls);
    expect(initialCodeReads).toBeGreaterThan(0);
    expect(refreshedCodeReads).toBe(initialCodeReads);
    expect(hoisted.multicall).toHaveBeenCalledTimes(initialCacheCalls);
  });

  it('returns the accepted intent when refresh is called after allow', async () => {
    const { deps, middlewareClient } = makeHarness();
    let refreshAfterAllow: Promise<SwapIntent> | undefined;
    let acceptedIntent: SwapIntent | undefined;

    const result = await swap(input, deps, {
      onIntent: ({ intent, refresh, allow }) => {
        acceptedIntent = intent;
        allow();
        refreshAfterAllow = refresh();
      },
    });
    const refreshed = await refreshAfterAllow;

    expect(refreshed).toBe(acceptedIntent);
    expect(result.intent).toBe(acceptedIntent);
    expect(middlewareClient.getSwapBalances).toHaveBeenCalledTimes(1);
    expect(middlewareClient.getOraclePrices).toHaveBeenCalledTimes(1);
  });

  it('emits the real event lifecycle, timing spans, and intent explorer URL', async () => {
    const { deps } = makeHarness();
    const events: Array<{ type: string; status?: string }> = [];
    const timing = makeTimingHooks();
    deps.timing = timing;

    const result = await swap(input, deps, {
      onEvent: (event) => {
        events.push(event);
      },
      onIntent: ({ allow }) => allow(),
    });

    expect(
      events.filter((event) => event.type === 'status').map((event) => event.status)
    ).toEqual([
      'route_building',
      'route_ready',
      'awaiting_approval',
      'approved',
      'executing',
      'completed',
    ]);
    expect(events.some((event) => event.type === 'plan_preview')).toBe(true);
    expect(events.some((event) => event.type === 'plan_confirmed')).toBe(true);
    expect(events.some((event) => event.type === 'plan_progress')).toBe(true);

    const spanNames = timing.startSpan.mock.calls.map(([name]) => name);
    expect(spanNames).toEqual(
      expect.arrayContaining([
        'flow.swap.preflight',
        'flow.swap.determine_route',
        'flow.swap.create_intent',
        'flow.swap.hooks',
        'flow.swap.prepare_execution',
        'flow.swap.execute_bridge',
      ])
    );
    expect(result.intentExplorerUrl).toMatch(
      /^https:\/\/intent\.example\/rff\/0x[0-9a-f]{64}$/
    );
  });
});
