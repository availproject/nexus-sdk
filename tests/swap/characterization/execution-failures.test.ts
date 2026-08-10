// Failure-path characterization for the real swap flow. SDK internals stay real; the tests
// control only public-client reads, middleware submissions, aggregator HTTP responses, and the
// wallet/network boundary.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hex } from 'viem';
import { swap } from '../../../src/flows/swap';
import type {
  CreateSafeExecuteTxV2Request,
  CreateSafeExecuteTxV2Response,
} from '../../../src/swap/safe/types';
import { SwapMode, type FlatBalance } from '../../../src/swap/types';
import {
  EOA,
  EPH_ACCOUNT,
  decodeSafeRequest,
  makeBebopResponse,
  makeCharChainList,
  makeCharMiddleware,
  makeRealEoaWallet,
  makeRequoteDrift,
  readContractStub,
  executionBatchesForChain,
  type CharMiddleware,
} from '../../helpers/swap-characterization';
import {
  ARB_CHAIN,
  BASE_CHAIN,
  USDC_ARB,
  USDC_BASE,
  WETH,
} from '../../helpers/swap';

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

const balance = (
  chainID: number,
  tokenAddress: Hex,
  symbol: string,
  decimals: number,
  amount: string
): FlatBalance => ({
  amount,
  chainID,
  decimals,
  symbol,
  tokenAddress,
  value: Number(amount),
  name: symbol,
  logo: '',
});

const makeDeps = (
  middlewareClient: CharMiddleware,
  wallet = makeRealEoaWallet().wallet
): Parameters<typeof swap>[1] => ({
  chainList: makeCharChainList(),
  intentExplorerUrl: 'https://intent.example',
  evm: { walletClient: wallet, address: EOA },
  forceMayan: false,
  middlewareClient,
  swap: { ephemeralWallet: EPH_ACCOUNT, cotCurrencyId: 1 },
});

const runDirectCotBridge = (
  middlewareClient: CharMiddleware,
  wallet = makeRealEoaWallet().wallet
) =>
  swap(
    {
      mode: SwapMode.EXACT_IN,
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
    },
    makeDeps(middlewareClient, wallet),
    { onIntent: ({ allow }) => allow() }
  );

const bridgeSubmissionCalls = (middlewareClient: CharMiddleware) =>
  middlewareClient.createSafeExecuteTx.mock.calls.filter(([request]) =>
    decodeSafeRequest(request).some((call) => call.fn === 'deposit')
  );

describe('swap execution failure and retry characterization', () => {
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

  it('retries a transient permit nonce read before any bridge broadcast', async () => {
    const middlewareClient = makeCharMiddleware({
      balances: [balance(ARB_CHAIN, USDC_ARB, 'USDC', 6, '50')],
    });
    let nonceReads = 0;
    hoisted.readContract.mockImplementation(async (request: {
      address: Hex;
      functionName: string;
    }) => {
      if (request.functionName === 'nonces' && nonceReads++ === 0) {
        throw new Error('RPC temporarily unavailable');
      }
      return readContractStub(request);
    });

    await runDirectCotBridge(middlewareClient);

    expect(nonceReads).toBe(3);
    expect(bridgeSubmissionCalls(middlewareClient)).toHaveLength(1);
  });

  it('does not retry a rejected Safe bridge request', async () => {
    const middlewareClient = makeCharMiddleware({
      balances: [balance(ARB_CHAIN, USDC_ARB, 'USDC', 6, '50')],
    });
    middlewareClient.createSafeExecuteTx.mockRejectedValueOnce(new Error('not broadcast'));

    await expect(runDirectCotBridge(middlewareClient)).rejects.toThrow('not broadcast');

    const submissions = bridgeSubmissionCalls(middlewareClient);
    expect(submissions).toHaveLength(1);
  });

  it('does not retry an ambiguous bridge transport failure', async () => {
    const middlewareClient = makeCharMiddleware({
      balances: [balance(ARB_CHAIN, USDC_ARB, 'USDC', 6, '50')],
    });
    middlewareClient.createSafeExecuteTx.mockRejectedValueOnce(new Error('request timed out'));

    await expect(runDirectCotBridge(middlewareClient)).rejects.toThrow('request timed out');

    expect(bridgeSubmissionCalls(middlewareClient)).toHaveLength(1);
  });

  it('submits one Safe bridge request when a transaction hash is returned', async () => {
    const middlewareClient = makeCharMiddleware({
      balances: [balance(ARB_CHAIN, USDC_ARB, 'USDC', 6, '50')],
    });
    await runDirectCotBridge(middlewareClient);

    expect(bridgeSubmissionCalls(middlewareClient)).toHaveLength(1);
  });

  it('reuses Safe funding authorization when a failed source leg is requoted', async () => {
    hoisted.getCode.mockImplementation(
      async ({ address }: { address: Hex }) =>
        address.toLowerCase() === EOA.toLowerCase()
          ? ('0xef010000000000000000000000000000000000000000' as Hex)
          : undefined
    );
    const middlewareClient = makeCharMiddleware({
      balances: [balance(ARB_CHAIN, WETH, 'WETH', 18, '1')],
      drift: makeRequoteDrift({
        chainId: ARB_CHAIN,
        sourceToken: WETH,
        factor: 1,
      }),
    });
    const walletHarness = makeRealEoaWallet();

    await swap(
      {
        mode: SwapMode.EXACT_IN,
        data: {
          sources: [
            {
              chainId: ARB_CHAIN,
              tokenAddress: WETH,
              amountRaw: 1_000_000_000_000_000_000n,
            },
          ],
          toChainId: BASE_CHAIN,
          toTokenAddress: USDC_BASE,
        },
      },
      makeDeps(middlewareClient, walletHarness.wallet),
      { onIntent: ({ allow }) => allow() }
    );

    expect(walletHarness.sentTxs).toEqual([]);
    expect(
      executionBatchesForChain(middlewareClient, ARB_CHAIN).filter((batch) =>
        batch.some((call) => call.fn === 'swap')
      )
    ).toHaveLength(2);
  });

  it('stops after requote dispatch exhaustion and never submits an intent', async () => {
    const middlewareClient = makeCharMiddleware({
      balances: [balance(ARB_CHAIN, WETH, 'WETH', 18, '1')],
    });
    const defaultCreate = middlewareClient.createSafeExecuteTx.getMockImplementation() as
      | ((request: CreateSafeExecuteTxV2Request) => Promise<CreateSafeExecuteTxV2Response>)
      | undefined;
    if (!defaultCreate) throw new Error('missing default createSafeExecuteTx implementation');
    middlewareClient.createSafeExecuteTx.mockImplementation(async (request) => {
      if (decodeSafeRequest(request).some((call) => call.fn === 'swap')) {
        throw new Error('source swap rejected');
      }
      return defaultCreate(request);
    });

    await expect(
      swap(
        {
          mode: SwapMode.EXACT_IN,
          data: {
            sources: [
              {
                chainId: ARB_CHAIN,
                tokenAddress: WETH,
                amountRaw: 1_000_000_000_000_000_000n,
              },
            ],
            toChainId: BASE_CHAIN,
            toTokenAddress: USDC_BASE,
          },
        },
        makeDeps(middlewareClient),
        { onIntent: ({ allow }) => allow() }
      )
    ).rejects.toThrow('source swap rejected');

    expect(
      middlewareClient.createSafeExecuteTx.mock.calls.filter(([request]) =>
        decodeSafeRequest(request).some((call) => call.fn === 'swap')
      )
    ).toHaveLength(2);
    expect(middlewareClient.submitRFF).not.toHaveBeenCalled();
  });

  it('refreshes an expired destination quote before dispatch', async () => {
    const middlewareClient = makeCharMiddleware({
      balances: [balance(ARB_CHAIN, USDC_ARB, 'USDC', 6, '1000')],
    });
    let destinationQuoteCalls = 0;
    middlewareClient.getBebopQuote.mockImplementation(
      async (params: Record<string, string>) => {
        const response = makeBebopResponse(params);
        if (
          params.chain === 'base' &&
          params.sell_tokens?.toLowerCase() === USDC_BASE.toLowerCase() &&
          params.buy_tokens?.toLowerCase() === WETH.toLowerCase()
        ) {
          destinationQuoteCalls += 1;
          return {
            ...response,
            expiry:
              destinationQuoteCalls === 1
                ? Math.floor(Date.now() / 1000) - 60
                : Math.floor(Date.now() / 1000) + 60,
          };
        }
        return response;
      }
    );

    await swap(
      {
        mode: SwapMode.EXACT_IN,
        data: {
          sources: [
            {
              chainId: ARB_CHAIN,
              tokenAddress: USDC_ARB,
              amountRaw: 1_000_000_000n,
            },
          ],
          toChainId: BASE_CHAIN,
          toTokenAddress: WETH,
        },
      },
      makeDeps(middlewareClient),
      { onIntent: ({ allow }) => allow() }
    );

    expect(destinationQuoteCalls).toBeGreaterThanOrEqual(2);
    expect(
      executionBatchesForChain(middlewareClient, BASE_CHAIN).some((batch) =>
        batch.some((call) => call.fn === 'swap')
      )
    ).toBe(true);
  });

  it('retries mandatory destination balance reads and fails closed after exhaustion', async () => {
    const middlewareClient = makeCharMiddleware({
      balances: [balance(ARB_CHAIN, USDC_ARB, 'USDC', 6, '1000')],
    });
    let destinationBalanceReads = 0;
    hoisted.readContract.mockImplementation(async (request: {
      address: Hex;
      functionName: string;
    }) => {
      if (
        request.functionName === 'balanceOf' &&
        request.address.toLowerCase() === USDC_BASE.toLowerCase()
      ) {
        destinationBalanceReads += 1;
        throw new Error('destination RPC unavailable');
      }
      return readContractStub(request);
    });

    await expect(
      swap(
        {
          mode: SwapMode.EXACT_IN,
          data: {
            sources: [
              {
                chainId: ARB_CHAIN,
                tokenAddress: USDC_ARB,
                amountRaw: 1_000_000_000n,
              },
            ],
            toChainId: BASE_CHAIN,
            toTokenAddress: WETH,
          },
        },
        makeDeps(middlewareClient),
        { onIntent: ({ allow }) => allow() }
      )
    ).rejects.toMatchObject({
      context: expect.objectContaining({
        chainId: BASE_CHAIN,
        stepType: 'destination_swap',
      }),
    });

    expect(destinationBalanceReads).toBeGreaterThanOrEqual(3);
    expect(
      executionBatchesForChain(middlewareClient, BASE_CHAIN).some((batch) =>
        batch.some((call) => call.fn === 'swap')
      )
    ).toBe(false);
  });

  it('falls back to a decoded COT sweep when the optional surplus read fails', async () => {
    const middlewareClient = makeCharMiddleware({
      balances: [balance(ARB_CHAIN, USDC_ARB, 'USDC', 6, '4000')],
    });
    hoisted.readContract.mockImplementation(async (request: {
      address: Hex;
      functionName: string;
    }) => {
      if (
        request.functionName === 'balanceOf' &&
        request.address.toLowerCase() === USDC_BASE.toLowerCase()
      ) {
        throw new Error('surplus read unavailable');
      }
      return readContractStub(request);
    });

    await swap(
      {
        mode: SwapMode.EXACT_OUT,
        data: {
          sources: [{ chainId: ARB_CHAIN, tokenAddress: USDC_ARB }],
          toChainId: BASE_CHAIN,
          toTokenAddress: WETH,
          toAmountRaw: 1_000_000_000_000_000_000n,
        },
      },
      makeDeps(middlewareClient),
      { onIntent: ({ allow }) => allow() }
    );

    const destinationCalls = executionBatchesForChain(middlewareClient, BASE_CHAIN).flat();
    expect(destinationCalls.some((call) => call.fn === 'sweepERC20')).toBe(true);
  });
});
