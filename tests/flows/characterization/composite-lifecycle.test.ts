// Composite-flow characterization. Swap/bridge preview construction, plan merging, fee
// estimation, refresh transitions, nested execution, and simulation stay real. Only injected
// middleware, public-client, aggregator, and wallet/network boundaries are deterministic.
import Decimal from 'decimal.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hex } from 'viem';
import { swapAndExecute } from '../../../src/flows/swap-and-execute';
import {
  bridgeAndExecute,
  simulateBridgeAndExecute,
} from '../../../src/flows/bridge-and-execute';
import { EADDRESS } from '../../../src/swap/constants';
import type { FlatBalance } from '../../../src/swap/types';
import {
  EOA,
  EPH_ACCOUNT,
  makeCharChainList,
  makeCharMiddleware,
  makeRealEoaWallet,
  readContractStub,
  type CharMiddleware,
} from '../../helpers/swap-characterization';
import { makeUnifiedBalance, makeOraclePrice } from '../../helpers/balances';
import { makeBridgeAndExecuteMiddlewareClient } from '../../helpers/middleware-client';
import {
  ARB_CHAIN,
  BASE_CHAIN,
  USDC_ARB,
  USDC_BASE,
} from '../../helpers/swap';

const hoisted = vi.hoisted(() => {
  const call = vi.fn();
  const readContract = vi.fn();
  const multicall = vi.fn();
  const getCode = vi.fn();
  const getTransactionCount = vi.fn();
  const waitForTransactionReceipt = vi.fn();
  const getFeeHistory = vi.fn();
  const estimateGas = vi.fn();
  const getBalance = vi.fn();
  const createPublicClient = vi.fn((options?: { chain?: unknown }) => ({
    chain: options?.chain,
    call,
    readContract,
    multicall,
    getCode,
    getTransactionCount,
    waitForTransactionReceipt,
    getFeeHistory,
    estimateGas,
    getBalance,
  }));

  return {
    call,
    readContract,
    multicall,
    getCode,
    getTransactionCount,
    waitForTransactionReceipt,
    getFeeHistory,
    estimateGas,
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

const TARGET = '0x3333333333333333333333333333333333333333' as Hex;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Hex;

const tokenBalance = (
  chainID: number,
  tokenAddress: Hex,
  symbol: string,
  decimals: number,
  amount: string,
  value = Number(amount)
): FlatBalance => ({
  amount,
  chainID,
  decimals,
  symbol,
  tokenAddress,
  value,
  name: symbol,
  logo: '',
});

const destinationRich = (chainId: number): FlatBalance[] => [
  tokenBalance(
    chainId,
    chainId === ARB_CHAIN ? USDC_ARB : USDC_BASE,
    'USDC',
    6,
    '200'
  ),
  tokenBalance(chainId, EADDRESS as Hex, 'ETH', 18, '1', 2500),
];

const fundingRequired: FlatBalance[] = [
  tokenBalance(
    ARB_CHAIN,
    '0x0000000000000000000000000000000000000da1' as Hex,
    'DAI',
    18,
    '200'
  ),
  tokenBalance(ARB_CHAIN, EADDRESS as Hex, 'ETH', 18, '1', 2500),
];

const makeSwapAndExecuteHarness = (
  chainId: number,
  balances: FlatBalance[]
) => {
  const middlewareClient = makeCharMiddleware({ balances });
  const walletHarness = makeRealEoaWallet();
  const requests: Array<Record<string, unknown>> = [];
  const baseSendTransaction = walletHarness.wallet.sendTransaction.bind(walletHarness.wallet);
  walletHarness.wallet.sendTransaction = vi.fn(async (request: Record<string, unknown>) => {
    requests.push(request);
    return baseSendTransaction(request as never);
  }) as never;

  const deps: Parameters<typeof swapAndExecute>[1] = {
    chainList: makeCharChainList(),
    intentExplorerUrl: 'https://intent.example',
    evm: { walletClient: walletHarness.wallet, address: EOA },
    forceMayan: false,
    middlewareClient,
    swap: { ephemeralWallet: EPH_ACCOUNT, cotCurrencyId: 1 },
  };

  const params: Parameters<typeof swapAndExecute>[0] = {
    toChainId: chainId,
    toTokenAddress: chainId === ARB_CHAIN ? USDC_ARB : USDC_BASE,
    toAmountRaw: 100_000_000n,
    execute: {
      to: TARGET,
      data: '0xdeadbeef',
      gas: 100_000n,
    },
  };

  return { deps, middlewareClient, params, requests, walletHarness };
};

const makeBridgeAndExecuteHarness = (chainId: number) => {
  const chainList = makeCharChainList();
  const tokenAddress = chainId === ARB_CHAIN ? USDC_ARB : USDC_BASE;
  const token = chainList.getTokenByAddress(chainId, tokenAddress)!;
  chainList.getChainAndTokenFromSymbol = vi.fn().mockReturnValue({
    chain: chainList.getChainByID(chainId),
    token,
    isNativeToken: false,
  });
  const middlewareClient = makeBridgeAndExecuteMiddlewareClient({
    getBalances: vi.fn().mockResolvedValue([
      makeUnifiedBalance({
        chainId,
        tokenAddress,
        rawBalance: '200000000',
        value: '200',
      }),
      makeUnifiedBalance({
        chainId,
        tokenAddress: ZERO_ADDRESS,
        rawBalance: '1000000000000000000',
        value: '2500',
      }),
    ]),
    getOraclePrices: vi.fn().mockResolvedValue([
      makeOraclePrice({
        chainId,
        tokenAddress,
        symbol: 'USDC',
        decimals: 6,
        priceUsd: new Decimal(1),
      }),
      makeOraclePrice({
        chainId,
        tokenAddress: ZERO_ADDRESS,
        symbol: 'ETH',
        decimals: 18,
        priceUsd: new Decimal(2500),
      }),
    ]),
  });
  const walletHarness = makeRealEoaWallet();
  const deps: Parameters<typeof bridgeAndExecute>[1] = {
    chainList,
    intentExplorerUrl: 'https://intent.example',
    evm: { walletClient: walletHarness.wallet, address: EOA },
    forceMayan: false,
    middlewareClient,
  };
  const params: Parameters<typeof bridgeAndExecute>[0] = {
    toChainId: chainId,
    toTokenSymbol: 'USDC',
    toAmountRaw: 100_000_000n,
    execute: {
      to: TARGET,
      data: '0xdeadbeef',
      gas: 100_000n,
      tokenApproval: {
        toTokenSymbol: 'USDC',
        amount: 2_000_000n,
        spender: TARGET,
      },
    },
  };

  return { deps, middlewareClient, params, walletHarness };
};

describe('composite flow lifecycle and refresh characterization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.call.mockResolvedValue({ data: '0x' });
    hoisted.readContract.mockImplementation(async (request: {
      address: Hex;
      functionName: string;
    }) => {
      if (request.functionName === 'gasEstimateL1Component') {
        return [1n, 1n, 1n] as const;
      }
      if (request.functionName === 'getL1Fee') {
        return 1n;
      }
      return readContractStub(request);
    });
    hoisted.multicall.mockImplementation(async ({ contracts }: { contracts: unknown[] }) =>
      contracts.map(() => ({ status: 'success', result: 0n }))
    );
    hoisted.getCode.mockResolvedValue(undefined);
    hoisted.getTransactionCount.mockResolvedValue(0n);
    hoisted.waitForTransactionReceipt.mockImplementation(async ({ hash }: { hash: Hex }) => ({
      status: 'success',
      transactionHash: hash,
      blockNumber: 1n,
      effectiveGasPrice: 1n,
      gasUsed: 21_000n,
    }));
    hoisted.getFeeHistory.mockResolvedValue({
      baseFeePerGas: Array.from({ length: 21 }, () => 1n),
      reward: Array.from({ length: 20 }, () => [1n, 1n, 1n]),
      gasUsedRatio: [],
      oldestBlock: 1n,
    });
    hoisted.estimateGas.mockResolvedValue(70_000n);
    hoisted.getBalance.mockResolvedValue(10n ** 20n);
  });

  it('refreshes from execute-only to funding-required and merges swap steps before execute', async () => {
    const harness = makeSwapAndExecuteHarness(ARB_CHAIN, destinationRich(ARB_CHAIN));
    harness.middlewareClient.getSwapBalances
      .mockResolvedValueOnce(destinationRich(ARB_CHAIN))
      .mockResolvedValueOnce(fundingRequired);
    const previews: Array<{ swapRequired: boolean; steps: Array<{ type: string }> }> = [];

    const result = await swapAndExecute(harness.params, harness.deps, {
      onEvent: (event) => {
        if (event.type === 'plan_preview') {
          previews.push(event.plan);
        }
      },
      onIntent: ({ refresh, allow }) => {
        void refresh().then((intent) => {
          expect(intent.swapRequired).toBe(true);
          allow();
        });
      },
    });

    expect(previews.map((plan) => plan.swapRequired)).toEqual([false, true]);
    expect(previews[1]?.steps.at(-1)?.type).toBe('execute_transaction');
    expect(previews[1]?.steps.some((step) => step.type === 'source_swap')).toBe(true);
    expect(result.swapSkipped).toBe(false);
    expect(harness.middlewareClient.getSwapBalances).toHaveBeenCalledTimes(2);
  });

  it('refreshes from funding-required to execute-only and removes swap steps', async () => {
    const harness = makeSwapAndExecuteHarness(ARB_CHAIN, fundingRequired);
    harness.middlewareClient.getSwapBalances
      .mockResolvedValueOnce(fundingRequired)
      .mockResolvedValueOnce(destinationRich(ARB_CHAIN));
    const previews: Array<{ swapRequired: boolean; steps: Array<{ type: string }> }> = [];

    const result = await swapAndExecute(harness.params, harness.deps, {
      onEvent: (event) => {
        if (event.type === 'plan_preview') {
          previews.push(event.plan);
        }
      },
      onIntent: ({ refresh, allow }) => {
        void refresh().then((intent) => {
          expect(intent.swapRequired).toBe(false);
          allow();
        });
      },
    });

    expect(previews.map((plan) => plan.swapRequired)).toEqual([true, false]);
    expect(previews[1]?.steps.map((step) => step.type)).toEqual(['execute_transaction']);
    expect(result.swapSkipped).toBe(true);
    expect(harness.middlewareClient.submitSBCs).not.toHaveBeenCalled();
  });

  it('honors an explicit skip override even when destination funding is short', async () => {
    const harness = makeSwapAndExecuteHarness(ARB_CHAIN, fundingRequired);

    const result = await swapAndExecute(harness.params, harness.deps, {
      onIntent: ({ allow }) => allow(),
      skipSwapOverride: true,
    });

    expect(result.swapSkipped).toBe(true);
    expect(harness.middlewareClient.submitSBCs).not.toHaveBeenCalled();
  });

  it('keeps executing when composite event callbacks throw', async () => {
    const harness = makeSwapAndExecuteHarness(ARB_CHAIN, destinationRich(ARB_CHAIN));

    const result = await swapAndExecute(harness.params, harness.deps, {
      onEvent: () => {
        throw new Error('consumer callback failed');
      },
      onIntent: ({ allow }) => allow(),
    });

    expect(result.swapSkipped).toBe(true);
    expect(result.execute.txHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it.each([ARB_CHAIN, BASE_CHAIN])(
    'executes the approval and transaction with chain-aware fee parameters on %s',
    async (chainId) => {
      const harness = makeBridgeAndExecuteHarness(chainId);

      const result = await bridgeAndExecute(harness.params, harness.deps);

      expect(result.bridgeSkipped).toBe(true);
      expect(result.approval?.txHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(result.execute.txHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(harness.walletHarness.sentTxs).toHaveLength(2);
    }
  );

  it('rebuilds previews for default and selected sources before approval', async () => {
    const harness = makeBridgeAndExecuteHarness(BASE_CHAIN);
    let refreshAfterAllow: Promise<unknown> | undefined;

    const result = await bridgeAndExecute(harness.params, harness.deps, {
      onIntent: ({ refresh, allow }) => {
        void refresh()
          .then(() => refresh([ARB_CHAIN]))
          .then(() => {
            allow();
            refreshAfterAllow = refresh();
          });
      },
    });

    await refreshAfterAllow;
    expect(result.bridgeSkipped).toBe(true);
    expect(harness.middlewareClient.getBalances).toHaveBeenCalledTimes(3);
    expect(harness.middlewareClient.getOraclePrices).toHaveBeenCalledTimes(3);
  });

  it.each([
    {
      chainId: ARB_CHAIN,
      expected: 'legacy',
    },
    {
      chainId: BASE_CHAIN,
      expected: 'eip1559',
    },
  ] as const)(
    'uses $expected fee parameters at the real execute-wallet boundary',
    async ({ chainId, expected }) => {
      const harness = makeSwapAndExecuteHarness(chainId, destinationRich(chainId));

      await swapAndExecute(harness.params, harness.deps, {
        onIntent: ({ allow }) => allow(),
      });

      const executeRequest = harness.requests.at(-1);
      expect(executeRequest).toBeDefined();
      if (expected === 'legacy') {
        expect(executeRequest).toMatchObject({ gasPrice: expect.any(BigInt) });
        expect(executeRequest).not.toHaveProperty('maxFeePerGas');
      } else {
        expect(executeRequest).toMatchObject({
          maxFeePerGas: expect.any(BigInt),
          maxPriorityFeePerGas: expect.any(BigInt),
        });
        expect(executeRequest).not.toHaveProperty('gasPrice');
      }
    }
  );

  it('composes approval and execute gas in bridge-and-execute simulation', async () => {
    const chainList = makeCharChainList();
    const token = chainList.getTokenByAddress(BASE_CHAIN, USDC_BASE)!;
    chainList.getChainAndTokenFromSymbol = vi.fn().mockReturnValue({
      chain: chainList.getChainByID(BASE_CHAIN),
      token,
      isNativeToken: false,
    });
    const simulateBundleV2 = vi.fn().mockResolvedValue({ gas: [70_000n, 21_000n] });
    const middlewareClient = makeBridgeAndExecuteMiddlewareClient({
      getBalances: vi.fn().mockResolvedValue([
        makeUnifiedBalance({
          chainId: BASE_CHAIN,
          tokenAddress: USDC_BASE,
          rawBalance: '200000000',
          value: '200',
        }),
        makeUnifiedBalance({
          chainId: BASE_CHAIN,
          tokenAddress: ZERO_ADDRESS,
          rawBalance: '1000000000000000000',
          value: '2500',
        }),
      ]),
      getOraclePrices: vi.fn().mockResolvedValue([
        makeOraclePrice({
          chainId: BASE_CHAIN,
          tokenAddress: USDC_BASE,
          symbol: 'USDC',
          decimals: 6,
          priceUsd: new Decimal(1),
        }),
        makeOraclePrice({
          chainId: BASE_CHAIN,
          tokenAddress: ZERO_ADDRESS,
          symbol: 'ETH',
          decimals: 18,
          priceUsd: new Decimal(2500),
        }),
      ]),
      simulateBundleV2,
    });

    const result = await simulateBridgeAndExecute(
      {
        toChainId: BASE_CHAIN,
        toTokenSymbol: 'USDC',
        toAmountRaw: 100_000_000n,
        execute: {
          to: TARGET,
          data: '0xdeadbeef',
          tokenApproval: {
            toTokenSymbol: 'USDC',
            amount: 2_000_000n,
            spender: TARGET,
          },
        },
      },
      {
        chainList,
        intentExplorerUrl: 'https://intent.example',
        evm: {
          walletClient: makeRealEoaWallet().wallet,
          address: EOA,
        },
        forceMayan: false,
        middlewareClient,
      }
    );

    expect(simulateBundleV2).toHaveBeenCalledOnce();
    expect(result.bridgeSimulation).toBeNull();
    expect(result.executeSimulation).toMatchObject({
      estimatedGasUnits: 84_000n + 25_200n,
      feeParams: { type: 'eip1559' },
    });
    expect(result.executeSimulation.estimatedTotalCost).toBeGreaterThan(0n);
  });
});
