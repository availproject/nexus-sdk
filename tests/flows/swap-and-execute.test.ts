import Decimal from 'decimal.js';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Hex } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import type { ChainListType, TokenInfo } from '../../src/domain';
import type { SwapAndExecuteEvent, SwapAndExecuteIntent, SwapAndExecuteOnIntentHookData, SwapAndExecutePlan } from '../../src';
import type {
  SwapAndExecuteParams,
  SwapIntent,
  SwapResult,
} from '../../src/swap/types';
import { EADDRESS } from '../../src/swap/constants';
import { SwapMode } from '../../src/swap/types';
import { makeSwapMiddlewareClient } from '../helpers/middleware-client';

// ---------------------------------------------------------------------------
// Mocks — must be before imports of the modules under test
// ---------------------------------------------------------------------------

const mockPublicClient = vi.hoisted(() => ({
  estimateGas: vi.fn(),
}));

const estimateTotalFeesMock = vi.hoisted(() => vi.fn());

vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem');
  return {
    ...actual,
    createPublicClient: vi.fn().mockReturnValue(mockPublicClient),
    http: vi.fn().mockReturnValue({}),
  };
});

vi.mock('../../src/flows/swap', () => ({
  swap: vi.fn(),
  buildSwapPreviewState: vi.fn(),
}));

vi.mock('../../src/swap/preflight', () => ({
  buildSwapPreflight: vi.fn(),
}));

vi.mock(
  '../../src/services/fee-estimation',
  () => ({
    estimateTotalFees: estimateTotalFeesMock,
  })
);

vi.mock('../../src/services/evm', () => ({
  switchChain: vi.fn().mockResolvedValue(undefined),
  waitForTxReceipt: vi.fn().mockResolvedValue([
    { status: 'success', transactionHash: '0xtx123', blockNumber: 1n },
    null,
  ]),
  waitForTxReceiptByChain: vi.fn().mockResolvedValue([
    { status: 'success', transactionHash: '0xtx123', blockNumber: 1n },
    null,
  ]),
  packERC20Approve: vi.fn().mockReturnValue('0x12' as Hex),
}));

vi.mock('../../src/services/allowance-utils', () => ({
  erc20GetAllowance: vi.fn().mockResolvedValue(0n),
}));

import { swapAndExecute } from '../../src/flows/swap-and-execute';
import { buildSwapPreviewState, swap, type SwapPreviewState } from '../../src/flows/swap';
import { switchChain, waitForTxReceipt } from '../../src/services/evm';
import { erc20GetAllowance } from '../../src/services/allowance-utils';
import { buildSwapPreflight } from '../../src/swap/preflight';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const USDC = '0xaf88d065e77c8cc2239327c5edb3a432268e5831' as Hex;
const NATIVE = EADDRESS as Hex;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Hex;
const ARB_CHAIN = 42161;
const USER_ADDRESS = '0xaaaa000000000000000000000000000000000001' as Hex;
const TX_HASH = '0xtx123' as Hex;
const TARGET_CONTRACT = '0x3333333333333333333333333333333333333333' as Hex;

const defaultOraclePrices = [
  {
    universe: 'EVM' as const,
    chainId: ARB_CHAIN,
    tokenAddress: USDC,
    tokenSymbol: 'USDC',
    tokenDecimals: 6,
    priceUsd: new Decimal(1),
    timestamp: 1,
  },
  {
    universe: 'EVM' as const,
    chainId: ARB_CHAIN,
    tokenAddress: ZERO_ADDRESS,
    tokenSymbol: 'ETH',
    tokenDecimals: 18,
    priceUsd: new Decimal(3000),
    timestamp: 1,
  },
];

const usdcToken: TokenInfo = {
  contractAddress: USDC,
  decimals: 6,
  symbol: 'USDC',
  name: 'USD Coin',
  logo: '',
};

const nativeToken: TokenInfo = {
  contractAddress: NATIVE,
  decimals: 18,
  symbol: 'ETH',
  name: 'Ether',
  logo: '',
};

const makeChainList = (): ChainListType =>
  ({
    getChainByID: vi.fn().mockReturnValue({
      id: ARB_CHAIN,
      name: 'Arbitrum',
      nativeCurrency: { decimals: 18, name: 'ETH', symbol: 'ETH' },
      rpcUrls: { default: { http: ['https://arb.rpc'] } },
      blockExplorers: { default: { url: 'https://arbiscan.io' } },
      custom: { icon: 'https://arb.example/icon.png' },
    }),
    getTokenByAddress: vi.fn().mockImplementation((_chainId, tokenAddress) => {
      if (tokenAddress.toLowerCase() === USDC.toLowerCase()) {
        return usdcToken;
      }
      if (tokenAddress.toLowerCase() === NATIVE.toLowerCase()) {
        return nativeToken;
      }
      return null;
    }),
    getTokenInfoBySymbol: vi.fn().mockReturnValue(usdcToken),
    getNativeToken: vi.fn().mockReturnValue(nativeToken),
  }) as unknown as ChainListType;

const makeEvmClient = () =>
  ({
    sendTransaction: vi.fn().mockResolvedValue(TX_HASH),
  }) as unknown as import('viem').WalletClient;

type QueryMiddlewareClient = ReturnType<typeof makeSwapMiddlewareClient>;

const makeMiddlewareClient = (balances: Array<{
  amount: string;
  chainID: number;
  decimals: number;
  symbol: string;
  tokenAddress: Hex;
  value: number;
}> = []): QueryMiddlewareClient =>
  makeSwapMiddlewareClient({
    getSwapBalances: vi.fn().mockResolvedValue(balances),
    getOraclePrices: vi.fn().mockResolvedValue(defaultOraclePrices),
    getRFFStatus: vi.fn().mockResolvedValue({ status: 'created' }),
  });

const makeEphemeralWallet = (): PrivateKeyAccount =>
  ({
    address: '0xbbbb000000000000000000000000000000000002' as Hex,
  }) as unknown as PrivateKeyAccount;

const createSwapAndExecuteQuery = (input: {
  chainList: ChainListType;
  evmClient: ReturnType<typeof makeEvmClient>;
  middlewareClient: QueryMiddlewareClient;
  ephemeralWallet: PrivateKeyAccount;
  eoaAddress: Hex;
  skipSwapOverride?: boolean;
}) => {
  const deps = {
    chainList: input.chainList,
    middlewareClient: input.middlewareClient,
    intentExplorerUrl: 'https://intent.example',
    evm: {
      walletClient: input.evmClient,
      address: input.eoaAddress,
    },
    swap: {
      ephemeralWallet: input.ephemeralWallet,
      cotCurrencyId: 1,
    },
  };

  return {
    swapAndExecute: (
      params: SwapAndExecuteParams,
      options?: Parameters<typeof swapAndExecute>[2]
    ) =>
      swapAndExecute(params, deps, {
        ...options,
        skipSwapOverride: input.skipSwapOverride ?? options?.skipSwapOverride,
      }),
  };
};

const makeSwapResult = (): SwapResult => ({
  sourceSwaps: [],
  intentExplorerUrl: '',
  destinationSwap: null,
  intent: makeSwapIntent(),
});

const makeSwapPreviewState = (): SwapPreviewState =>
  ({
    route: {
      type: SwapMode.EXACT_OUT,
      source: {
        swaps: [],
        creationTime: Date.now(),
      },
      bridge: null,
      destination: {
        chainId: ARB_CHAIN,
        eoaToEphemeral: null,
        inputAmount: {
          min: new Decimal(0),
          max: new Decimal(0),
        },
        swap: {
          tokenSwap: null,
        },
        getDstSwap: vi.fn().mockResolvedValue(null),
      },
      buffer: { amount: '0' },
      dstTokenInfo: usdcToken,
      extras: {
        aggregators: [],
        oraclePrices: defaultOraclePrices,
        balances: [],
        assetsUsed: [],
      },
      sourceExecutionPaths: new Map([[ARB_CHAIN, 'eoa']]),
    },
    intent: {
      destination: {
        amount: '60',
        value: '60.00',
        chain: {
          id: ARB_CHAIN,
          name: 'Arbitrum',
          logo: 'https://arb.example/icon.png',
        },
        token: {
          contractAddress: USDC,
          decimals: 6,
          symbol: 'USDC',
        },
        gas: {
          amount: '0.0001',
          value: '0.30',
          token: {
            contractAddress: NATIVE,
            decimals: 18,
            symbol: 'ETH',
          },
        },
      },
      feesAndBuffer: {
        buffer: '0',
        bridge: null,
      },
      sources: [],
    },
    plan: {
      hasBridge: false,
      hasDestinationSwap: false,
      steps: [
        {
          type: 'source_swap',
          id: 'source_swap:8453',
          chainId: 8453,
          chainName: 'Base',
          walletPath: 'eoa',
          inputToken: {
            tokenAddress: USDC,
            tokenDecimals: 6,
            amount: '1',
            amountRaw: '1000000',
          },
          outputToken: {
            tokenAddress: USDC,
            tokenDecimals: 6,
            amount: '1',
            amountRaw: '1000000',
          },
        },
      ],
    },
  }) as unknown as SwapPreviewState;

const makePreflight = (balances: Array<{
  amount: string;
  chainID: number;
  decimals: number;
  symbol: string;
  tokenAddress: Hex;
  value: number;
}>) =>
  ({
    aggregators: [],
    balances,
    dstTokenInfo: usdcToken,
    oraclePrices: defaultOraclePrices,
    publicClientList: {},
    walletPathHints: new Map([[ARB_CHAIN, 'eoa']]),
  }) as never;

const makeParams = (overrides?: Partial<SwapAndExecuteParams>): SwapAndExecuteParams => ({
  toChainId: ARB_CHAIN,
  toTokenAddress: USDC,
  toAmountRaw: 100000000n,
  execute: {
    to: TARGET_CONTRACT,
    data: '0xdeadbeef' as Hex,
    gas: 100000n,
  },
  ...overrides,
});

const makeSwapIntent = (destinationAmount = '60'): SwapIntent => ({
  destination: {
    amount: destinationAmount,
    value: destinationAmount,
    chain: {
      id: ARB_CHAIN,
      name: 'Arbitrum',
      logo: 'https://arb.example/icon.png',
    },
    token: {
      contractAddress: USDC,
      decimals: 6,
      symbol: 'USDC',
    },
    gas: {
      amount: '0.0001',
      value: '0.30',
      token: {
        contractAddress: NATIVE,
        decimals: 18,
        symbol: 'ETH',
      },
    },
  },
  feesAndBuffer: {
    buffer: '0',
    bridge: null,
  },
  sources: [],
});

const makeExecuteOnlyBalances = () => [
  { amount: '200', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC, value: 200 },
  { amount: '1', chainID: ARB_CHAIN, decimals: 18, symbol: 'ETH', tokenAddress: NATIVE, value: 3000 },
];

const makeFundingRequiredBalances = () => [
  { amount: '40', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC, value: 40 },
  { amount: '0', chainID: ARB_CHAIN, decimals: 18, symbol: 'ETH', tokenAddress: NATIVE, value: 0 },
];

const makeSurplusGasBalances = () => [
  { amount: '40', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC, value: 40 },
  { amount: '0.5', chainID: ARB_CHAIN, decimals: 18, symbol: 'ETH', tokenAddress: NATIVE, value: 1500 },
];

const makeApprovalShortfallBalances = () => [
  { amount: '200', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC, value: 200 },
  { amount: '0.0001', chainID: ARB_CHAIN, decimals: 18, symbol: 'ETH', tokenAddress: NATIVE, value: 0.3 },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createSwapAndExecuteQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPublicClient.estimateGas.mockResolvedValue(50000n);
    estimateTotalFeesMock.mockImplementation(async (_client, _chainId, items: Array<unknown>) =>
      items.length === 1
        ? [
            {
              l1Fee: 0n,
              l2Fee: 100_000_000_000_000n,
              total: 100_000_000_000_000n,
              recommended: {
                gasLimit: 120_000n,
                maxFeePerGas: 1_000_000_000n,
                maxPriorityFeePerGas: 1_000_000_000n,
                totalMaxCost: 120_000_000_000_000n,
                useLegacyPricing: false,
              },
            },
          ]
        : [
            {
              l1Fee: 0n,
              l2Fee: 50_000_000_000_000n,
              total: 50_000_000_000_000n,
              recommended: {
                gasLimit: 60_000n,
                maxFeePerGas: 1_000_000_000n,
                maxPriorityFeePerGas: 1_000_000_000n,
                totalMaxCost: 60_000_000_000_000n,
                useLegacyPricing: false,
              },
            },
            {
              l1Fee: 0n,
              l2Fee: 100_000_000_000_000n,
              total: 100_000_000_000_000n,
              recommended: {
                gasLimit: 120_000n,
                maxFeePerGas: 1_000_000_000n,
                maxPriorityFeePerGas: 1_000_000_000n,
                totalMaxCost: 120_000_000_000_000n,
                useLegacyPricing: false,
              },
            },
          ]
    );
    vi.mocked(swap).mockResolvedValue(makeSwapResult());
    vi.mocked(buildSwapPreviewState).mockResolvedValue(makeSwapPreviewState());
    vi.mocked(buildSwapPreflight).mockImplementation(async (_input, options) =>
      makePreflight(options.preloadedBalances ?? [])
    );
  });

  it('calls swap then executes on-chain tx', async () => {
    const query = createSwapAndExecuteQuery({
      chainList: makeChainList(),
      evmClient: makeEvmClient(),
      middlewareClient: makeMiddlewareClient(),
      ephemeralWallet: makeEphemeralWallet(),
      eoaAddress: USER_ADDRESS,
    });

    const result = await query.swapAndExecute(makeParams());

    // Swap was called
    expect(swap).toHaveBeenCalledTimes(1);
    expect(result.swapSkipped).toBe(false);
    expect(result.swapResult).toBeDefined();

    // ExecuteOnChain was called
    expect(switchChain).toHaveBeenCalledTimes(1);
    expect(result.execute.txHash).toBe(TX_HASH);
  });

  it('skips swap when skipSwapOverride is true', async () => {
    const query = createSwapAndExecuteQuery({
      chainList: makeChainList(),
      evmClient: makeEvmClient(),
      middlewareClient: makeMiddlewareClient(),
      ephemeralWallet: makeEphemeralWallet(),
      eoaAddress: USER_ADDRESS,
      skipSwapOverride: true,
    });

    const result = await query.swapAndExecute(makeParams());

    expect(swap).not.toHaveBeenCalled();
    expect(result.swapSkipped).toBe(true);
    expect(result.swapResult).toBeUndefined();
    // Still executes on-chain
    expect(switchChain).toHaveBeenCalledTimes(1);
    expect(result.execute.txHash).toBe(TX_HASH);
  });

  it('returns SwapAndExecuteResult with nested execute and approval fields', async () => {
    const query = createSwapAndExecuteQuery({
      chainList: makeChainList(),
      evmClient: makeEvmClient(),
      middlewareClient: makeMiddlewareClient(),
      ephemeralWallet: makeEphemeralWallet(),
      eoaAddress: USER_ADDRESS,
    });

    const result = await query.swapAndExecute(makeParams());

    expect(result.execute).toBeDefined();
    expect(result.execute.txHash).toBe(TX_HASH);
    expect(result.execute.receipt).toBeDefined();
    expect(result.approval).toBeUndefined();
  });

  it('handles token approval when needed', async () => {
    const evmClient = makeEvmClient();
    const query = createSwapAndExecuteQuery({
      chainList: makeChainList(),
      evmClient,
      middlewareClient: makeMiddlewareClient(),
      ephemeralWallet: makeEphemeralWallet(),
      eoaAddress: USER_ADDRESS,
      skipSwapOverride: true,
    });

    const params = makeParams({
      execute: {
        to: TARGET_CONTRACT,
        data: '0xdeadbeef' as Hex,
        gas: 100000n,
        tokenApproval: {
          toTokenAddress: USDC,
          amount: 100000000n,
          spender: TARGET_CONTRACT,
        },
      },
    });

    // erc20GetAllowance returns 0n (insufficient) — already mocked
    const result = await query.swapAndExecute(params);

    // Approval tx + main tx = 2 sendTransaction calls
    expect(evmClient.sendTransaction).toHaveBeenCalledTimes(2);
    expect(result.approval?.txHash).toBe(TX_HASH);
    // waitForTxReceipt called for approval + main tx
    expect(waitForTxReceipt).toHaveBeenCalledTimes(2);
  });

  it('creates a chain-aware public client for destination execution', async () => {
    const { createPublicClient } = await import('viem');
    const query = createSwapAndExecuteQuery({
      chainList: makeChainList(),
      evmClient: makeEvmClient(),
      middlewareClient: makeMiddlewareClient(),
      ephemeralWallet: makeEphemeralWallet(),
      eoaAddress: USER_ADDRESS,
      skipSwapOverride: true,
    });

    await query.swapAndExecute(makeParams());

    expect(createPublicClient).toHaveBeenCalledWith(
      expect.objectContaining({
        chain: expect.objectContaining({ id: ARB_CHAIN }),
      })
    );
  });

  it('marks approval gas as final and execution gas as raw when estimating Arbitrum fees', async () => {
    const query = createSwapAndExecuteQuery({
      chainList: makeChainList(),
      evmClient: makeEvmClient(),
      middlewareClient: makeMiddlewareClient(),
      ephemeralWallet: makeEphemeralWallet(),
      eoaAddress: USER_ADDRESS,
      skipSwapOverride: true,
    });

    await query.swapAndExecute(
      makeParams({
        execute: {
          to: TARGET_CONTRACT,
          data: '0xdeadbeef' as Hex,
          gas: 100000n,
          tokenApproval: {
            toTokenAddress: USDC,
            amount: 100000000n,
            spender: TARGET_CONTRACT,
          },
        },
      })
    );

    expect(estimateTotalFeesMock).toHaveBeenCalledTimes(1);
    expect(estimateTotalFeesMock).toHaveBeenCalledWith(
      mockPublicClient,
      ARB_CHAIN,
      [
        expect.objectContaining({
          gasEstimate: 50000n,
          gasEstimateKind: 'final',
        }),
        expect.objectContaining({
          gasEstimate: 100000n,
        }),
      ],
      'medium'
    );
  });

  it('skips approval when allowance is sufficient', async () => {
    vi.mocked(erc20GetAllowance).mockResolvedValueOnce(999999999n);

    const evmClient = makeEvmClient();
    const query = createSwapAndExecuteQuery({
      chainList: makeChainList(),
      evmClient,
      middlewareClient: makeMiddlewareClient(),
      ephemeralWallet: makeEphemeralWallet(),
      eoaAddress: USER_ADDRESS,
      skipSwapOverride: true,
    });

    const params = makeParams({
      execute: {
        to: TARGET_CONTRACT,
        data: '0xdeadbeef' as Hex,
        gas: 100000n,
        tokenApproval: {
          toTokenAddress: USDC,
          amount: 100000000n,
          spender: TARGET_CONTRACT,
        },
      },
    });

    const result = await query.swapAndExecute(params);

    // Only main tx, no approval
    expect(evmClient.sendTransaction).toHaveBeenCalledTimes(1);
    expect(result.approval).toBeUndefined();
  });

  it('skips swap when destination has sufficient balance from middleware', async () => {
    const mw = makeSwapMiddlewareClient({
      getSwapBalances: vi.fn().mockResolvedValue([
        // Destination chain has 200 USDC (enough for toAmount=100)
        { amount: '200', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC, value: 200 },
        // Destination chain has 1 ETH gas (enough for gas=100000)
        { amount: '1', chainID: ARB_CHAIN, decimals: 18, symbol: 'ETH', tokenAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', value: 3000 },
      ]),
    });

    const query = createSwapAndExecuteQuery({
      chainList: makeChainList(),
      evmClient: makeEvmClient(),
      middlewareClient: mw,
      ephemeralWallet: makeEphemeralWallet(),
      eoaAddress: USER_ADDRESS,
    });

    const result = await query.swapAndExecute(makeParams());

    // Swap should be skipped because destination already has enough
    expect(swap).not.toHaveBeenCalled();
    expect(result.swapSkipped).toBe(true);
    expect(result.swapResult).toBeUndefined();
    // But on-chain tx still executes
    expect(result.execute.txHash).toBe(TX_HASH);
  });

  it('does not skip swap when destination has insufficient balance', async () => {
    const mw = makeSwapMiddlewareClient({
      getSwapBalances: vi.fn().mockResolvedValue([
        // Only 10 USDC — not enough for toAmount=100000000 (100 USDC raw)
        { amount: '10', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC, value: 10 },
      ]),
    });

    const query = createSwapAndExecuteQuery({
      chainList: makeChainList(),
      evmClient: makeEvmClient(),
      middlewareClient: mw,
      ephemeralWallet: makeEphemeralWallet(),
      eoaAddress: USER_ADDRESS,
    });

    const result = await query.swapAndExecute(makeParams());

    expect(swap).toHaveBeenCalledTimes(1);
    expect(result.swapSkipped).toBe(false);
  });

  it('passes sources to swap as EXACT_OUT input', async () => {
    const query = createSwapAndExecuteQuery({
      chainList: makeChainList(),
      evmClient: makeEvmClient(),
      middlewareClient: makeMiddlewareClient([
        { amount: '10', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC, value: 10 },
      ]),
      ephemeralWallet: makeEphemeralWallet(),
      eoaAddress: USER_ADDRESS,
    });

    // A held balance matching `sources` (partial → still a shortfall, so swap runs).
    const sources = [{ tokenAddress: USDC, chainId: ARB_CHAIN }];
    const params = makeParams({ sources });

    await query.swapAndExecute(params);

    // Verify swap was called with EXACT_OUT containing sources
    const swapCall = vi.mocked(swap).mock.calls[0];
    expect(swapCall[0].mode).toBe(SwapMode.EXACT_OUT);
    expect((swapCall[0].data as { sources?: unknown }).sources).toEqual(sources);
  });

  it('passes preloaded balances into swap when a swap is required', async () => {
    const balances = [
      { amount: '40', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC, value: 40 },
      {
        amount: '0',
        chainID: ARB_CHAIN,
        decimals: 18,
        symbol: 'ETH',
        tokenAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
        value: 0,
      },
    ];
    const middlewareClient = makeSwapMiddlewareClient({
      getSwapBalances: vi.fn().mockResolvedValue(balances),
    });

    const query = createSwapAndExecuteQuery({
      chainList: makeChainList(),
      evmClient: makeEvmClient(),
      middlewareClient,
      ephemeralWallet: makeEphemeralWallet(),
      eoaAddress: USER_ADDRESS,
    });

    await query.swapAndExecute(makeParams());

    expect(middlewareClient.getSwapBalances).toHaveBeenCalledTimes(1);
    expect(swap).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        swap: expect.any(Object),
      }),
      expect.objectContaining({
        preloadedBalances: balances,
      })
    );
  });

  it('passes the optimal token shortfall and gas shortfall into swap as toAmount and toNativeAmount', async () => {
    const balances = [
      { amount: '40', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC, value: 40 },
      {
        amount: '0',
        chainID: ARB_CHAIN,
        decimals: 18,
        symbol: 'ETH',
        tokenAddress: EADDRESS as Hex,
        value: 0,
      },
    ];
    const middlewareClient = makeSwapMiddlewareClient({
      getSwapBalances: vi.fn().mockResolvedValue(balances),
    });

    const query = createSwapAndExecuteQuery({
      chainList: makeChainList(),
      evmClient: makeEvmClient(),
      middlewareClient,
      ephemeralWallet: makeEphemeralWallet(),
      eoaAddress: USER_ADDRESS,
    });

    await query.swapAndExecute(makeParams());

    const swapCall = vi.mocked(swap).mock.calls[0];
    expect(swapCall[0]).toMatchObject({
      mode: SwapMode.EXACT_OUT,
      data: {
        toChainId: ARB_CHAIN,
        toTokenAddress: USDC,
        toAmountRaw: 60000000n,
        toNativeAmountRaw: 120000000000000n,
      },
    });
  });

  it('passes a negative toNativeAmountRaw into swap when destination gas is already covered', async () => {
    const middlewareClient = makeSwapMiddlewareClient({
      getSwapBalances: vi.fn().mockResolvedValue(makeSurplusGasBalances()),
    });

    const query = createSwapAndExecuteQuery({
      chainList: makeChainList(),
      evmClient: makeEvmClient(),
      middlewareClient,
      ephemeralWallet: makeEphemeralWallet(),
      eoaAddress: USER_ADDRESS,
    });

    await query.swapAndExecute(makeParams());

    const swapCall = vi.mocked(swap).mock.calls[0];
    expect(swapCall[0]).toMatchObject({
      mode: SwapMode.EXACT_OUT,
      data: {
        toChainId: ARB_CHAIN,
        toTokenAddress: USDC,
        toAmountRaw: 60000000n,
        toNativeAmountRaw: -120000000000000n,
      },
    });
  });

  it('emits execute-only typed events when swap is skipped', async () => {
    const balances = [
      { amount: '200', chainID: ARB_CHAIN, decimals: 6, symbol: 'USDC', tokenAddress: USDC, value: 200 },
      {
        amount: '1',
        chainID: ARB_CHAIN,
        decimals: 18,
        symbol: 'ETH',
        tokenAddress: EADDRESS as Hex,
        value: 3000,
      },
    ];
    const middlewareClient = makeSwapMiddlewareClient({
      getSwapBalances: vi.fn().mockResolvedValue(balances),
    });
    const onEvent = vi.fn<(event: SwapAndExecuteEvent) => void>();

    const query = createSwapAndExecuteQuery({
      chainList: makeChainList(),
      evmClient: makeEvmClient(),
      middlewareClient,
      ephemeralWallet: makeEphemeralWallet(),
      eoaAddress: USER_ADDRESS,
    });

    await query.swapAndExecute(makeParams(), { onEvent } as never);

    expect(swap).not.toHaveBeenCalled();
    expect(onEvent).toHaveBeenCalledWith({ type: 'status', status: 'preparing' });
    expect(onEvent).toHaveBeenCalledWith({
      type: 'plan_preview',
      plan: expect.objectContaining<Partial<SwapAndExecutePlan>>({
        swapRequired: false,
        steps: expect.arrayContaining([expect.objectContaining({ type: 'execute_transaction' })]),
      }),
    });
    expect(onEvent).toHaveBeenCalledWith({
      type: 'plan_confirmed',
      plan: expect.objectContaining<Partial<SwapAndExecutePlan>>({
        swapRequired: false,
        steps: expect.arrayContaining([expect.objectContaining({ type: 'execute_transaction' })]),
      }),
    });
    expect(onEvent).toHaveBeenCalledWith({ type: 'status', status: 'executing' });
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'plan_progress',
        stepType: 'execute_transaction',
        state: 'submitted',
      })
    );
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'plan_progress',
        stepType: 'execute_transaction',
        state: 'confirmed',
      })
    );
    expect(onEvent).toHaveBeenLastCalledWith({ type: 'status', status: 'completed' });
  });

  it('merges swap and execute steps into typed preview and confirmed plans', async () => {
    vi.mocked(swap).mockImplementation(async (_input, _deps, options) => {
      const emit = options?.onEvent as ((event: SwapAndExecuteEvent) => void) | undefined;
      emit?.({ type: 'status', status: 'route_building' });
      emit?.({ type: 'status', status: 'route_ready' });
      emit?.({
        type: 'plan_preview',
        plan: {
          hasBridge: false,
          hasDestinationSwap: false,
          steps: [
            {
              type: 'source_swap',
              id: 'source_swap:8453',
              chainId: 8453,
              chainName: 'Base',
              walletPath: 'eoa',
              inputToken: {
                tokenAddress: USDC,
                tokenDecimals: 6,
                amount: '1',
                amountRaw: '1000000',
              },
              outputToken: {
                tokenAddress: USDC,
                tokenDecimals: 6,
                amount: '1',
                amountRaw: '1000000',
              },
            },
          ],
        },
      } as never);
      emit?.({ type: 'status', status: 'awaiting_approval' });
      emit?.({ type: 'status', status: 'approved' });
      emit?.({
        type: 'plan_confirmed',
        plan: {
          hasBridge: false,
          hasDestinationSwap: false,
          steps: [
            {
              type: 'source_swap',
              id: 'source_swap:8453',
              chainId: 8453,
              chainName: 'Base',
              walletPath: 'eoa',
              inputToken: {
                tokenAddress: USDC,
                tokenDecimals: 6,
                amount: '1',
                amountRaw: '1000000',
              },
              outputToken: {
                tokenAddress: USDC,
                tokenDecimals: 6,
                amount: '1',
                amountRaw: '1000000',
              },
            },
          ],
        },
      } as never);
      emit?.({ type: 'status', status: 'executing' });
      emit?.({
        type: 'plan_progress',
        stepType: 'source_swap',
        state: 'submitted',
        step: {
          type: 'source_swap',
          id: 'source_swap:8453',
          chainId: 8453,
          chainName: 'Base',
          walletPath: 'eoa',
          inputToken: {
            tokenAddress: USDC,
            tokenDecimals: 6,
            amount: '1',
            amountRaw: '1000000',
          },
          outputToken: {
            tokenAddress: USDC,
            tokenDecimals: 6,
            amount: '1',
            amountRaw: '1000000',
          },
        },
        txHash: TX_HASH,
        explorerUrl: 'https://basescan.org/tx/0x1',
      } as never);
      emit?.({ type: 'status', status: 'completed' });
      return makeSwapResult();
    });

    const onEvent = vi.fn<(event: SwapAndExecuteEvent) => void>();
    const query = createSwapAndExecuteQuery({
      chainList: makeChainList(),
      evmClient: makeEvmClient(),
      middlewareClient: makeMiddlewareClient(),
      ephemeralWallet: makeEphemeralWallet(),
      eoaAddress: USER_ADDRESS,
    });

    await query.swapAndExecute(makeParams(), { onEvent } as never);

    expect(onEvent).toHaveBeenCalledWith({ type: 'status', status: 'preparing' });
    expect(onEvent).toHaveBeenCalledWith({
      type: 'plan_preview',
      plan: expect.objectContaining<Partial<SwapAndExecutePlan>>({
        swapRequired: true,
        steps: expect.arrayContaining([
          expect.objectContaining({ type: 'source_swap' }),
          expect.objectContaining({ type: 'execute_transaction' }),
        ]),
      }),
    });
    expect(onEvent).toHaveBeenCalledWith({
      type: 'plan_confirmed',
      plan: expect.objectContaining<Partial<SwapAndExecutePlan>>({
        swapRequired: true,
        steps: expect.arrayContaining([
          expect.objectContaining({ type: 'source_swap' }),
          expect.objectContaining({ type: 'execute_transaction' }),
        ]),
      }),
    });
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'plan_progress',
        stepType: 'source_swap',
        state: 'submitted',
      })
    );
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'plan_progress',
        stepType: 'execute_transaction',
        state: 'submitted',
      })
    );
    expect(onEvent).toHaveBeenLastCalledWith({ type: 'status', status: 'completed' });
    expect(onEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'SWAP_STEP_COMPLETE',
      })
    );
  });
});

describe('swapAndExecute composite flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPublicClient.estimateGas.mockResolvedValue(50000n);
    estimateTotalFeesMock.mockImplementation(async (_client, _chainId, items: Array<unknown>) =>
      items.length === 1
        ? [
            {
              l1Fee: 0n,
              l2Fee: 100_000_000_000_000n,
              total: 100_000_000_000_000n,
              recommended: {
                gasLimit: 120_000n,
                maxFeePerGas: 1_000_000_000n,
                maxPriorityFeePerGas: 1_000_000_000n,
                totalMaxCost: 120_000_000_000_000n,
                useLegacyPricing: false,
              },
            },
          ]
        : [
            {
              l1Fee: 0n,
              l2Fee: 50_000_000_000_000n,
              total: 50_000_000_000_000n,
              recommended: {
                gasLimit: 60_000n,
                maxFeePerGas: 1_000_000_000n,
                maxPriorityFeePerGas: 1_000_000_000n,
                totalMaxCost: 60_000_000_000_000n,
                useLegacyPricing: false,
              },
            },
            {
              l1Fee: 0n,
              l2Fee: 100_000_000_000_000n,
              total: 100_000_000_000_000n,
              recommended: {
                gasLimit: 120_000n,
                maxFeePerGas: 1_000_000_000n,
                maxPriorityFeePerGas: 1_000_000_000n,
                totalMaxCost: 120_000_000_000_000n,
                useLegacyPricing: false,
              },
            },
          ]
    );
    vi.mocked(buildSwapPreflight).mockResolvedValue(makePreflight(makeFundingRequiredBalances()));
    vi.mocked(buildSwapPreviewState).mockResolvedValue(makeSwapPreviewState());
    vi.mocked(swap).mockResolvedValue({
      sourceSwaps: [],
      intentExplorerUrl: '',
      destinationSwap: null,
      intent: makeSwapIntent(),
    });
  });

  it('waits for top-level composite approval before executing the skipped path', async () => {
    const evmClient = makeEvmClient();
    const query = createSwapAndExecuteQuery({
      chainList: makeChainList(),
      evmClient,
      middlewareClient: makeMiddlewareClient(makeExecuteOnlyBalances()),
      ephemeralWallet: makeEphemeralWallet(),
      eoaAddress: USER_ADDRESS,
    });

    const events: SwapAndExecuteEvent[] = [];
    let hookData: SwapAndExecuteOnIntentHookData | undefined;

    const pending = query.swapAndExecute(makeParams(), {
      onEvent: ((event: SwapAndExecuteEvent) => {
        events.push(event);
      }) as never,
      onIntent: ((data: SwapAndExecuteOnIntentHookData) => {
        hookData = data;
      }) as never,
    } as never);

    await vi.waitFor(() => {
      expect(hookData).toBeDefined();
    });

    expect(hookData?.intent.swapRequired).toBe(false);
    expect(evmClient.sendTransaction).not.toHaveBeenCalled();
    expect(swap).not.toHaveBeenCalled();
    expect(events).toEqual(
      expect.arrayContaining([
        { type: 'status', status: 'awaiting_approval' },
      ])
    );
    expect(events.find((event) => event.type === 'plan_confirmed')).toBeUndefined();

    hookData?.allow();
    await pending;

    expect(events).toEqual(
      expect.arrayContaining([
        { type: 'status', status: 'approved' },
        { type: 'status', status: 'executing' },
        { type: 'status', status: 'completed' },
      ])
    );
  });

  it('refreshes from swap-required to no-funding and confirms the latest preview object', async () => {
    const getSwapBalances = vi
      .fn()
      .mockResolvedValueOnce(makeFundingRequiredBalances())
      .mockResolvedValueOnce(makeExecuteOnlyBalances());
    const middlewareClient = makeSwapMiddlewareClient({
      getSwapBalances,
      getOraclePrices: vi.fn().mockResolvedValue(defaultOraclePrices),
    });
    vi.mocked(buildSwapPreflight)
      .mockResolvedValueOnce(makePreflight(makeFundingRequiredBalances()))
      .mockResolvedValueOnce(makePreflight(makeExecuteOnlyBalances()));

    const query = createSwapAndExecuteQuery({
      chainList: makeChainList(),
      evmClient: makeEvmClient(),
      middlewareClient,
      ephemeralWallet: makeEphemeralWallet(),
      eoaAddress: USER_ADDRESS,
    });

    const events: SwapAndExecuteEvent[] = [];
    let initialIntent: SwapAndExecuteIntent | undefined;

    await query.swapAndExecute(makeParams(), {
      onEvent: ((event: SwapAndExecuteEvent) => {
        events.push(event);
      }) as never,
      onIntent: ((data: SwapAndExecuteOnIntentHookData) => {
        initialIntent = data.intent;
        void data.refresh().then((nextIntent: SwapAndExecuteIntent) => {
          expect(nextIntent.swapRequired).toBe(false);
          data.allow();
        });
      }) as never,
    } as never);

    const previewEvents = events.filter(
      (event): event is Extract<SwapAndExecuteEvent, { type: 'plan_preview' }> =>
        event.type === 'plan_preview'
    );
    const confirmedEvent = events.find(
      (event): event is Extract<SwapAndExecuteEvent, { type: 'plan_confirmed' }> =>
        event.type === 'plan_confirmed'
    );

    expect(initialIntent?.swapRequired).toBe(true);
    expect(previewEvents).toHaveLength(2);
    expect(previewEvents[0]?.plan.swapRequired).toBe(true);
    expect(previewEvents[1]?.plan.swapRequired).toBe(false);
    expect(confirmedEvent?.plan).toBe(previewEvents[1]?.plan);
    expect(swap).not.toHaveBeenCalled();
  });

  it('refreshes from no-funding to swap-required, suppresses internal swap pre-approval events, and confirms the latest preview object', async () => {
    const getSwapBalances = vi
      .fn()
      .mockResolvedValueOnce(makeExecuteOnlyBalances())
      .mockResolvedValueOnce(makeFundingRequiredBalances());
    const middlewareClient = makeSwapMiddlewareClient({
      getSwapBalances,
      getOraclePrices: vi.fn().mockResolvedValue(defaultOraclePrices),
    });
    vi.mocked(buildSwapPreflight)
      .mockResolvedValueOnce(makePreflight(makeExecuteOnlyBalances()))
      .mockResolvedValueOnce(makePreflight(makeFundingRequiredBalances()));
    vi.mocked(buildSwapPreviewState).mockResolvedValueOnce(makeSwapPreviewState());

    vi.mocked(swap).mockImplementation(async (_input, _deps, options) => {
      options?.onIntent?.({
        allow: () => undefined,
        deny: () => undefined,
        intent: makeSwapIntent(),
        refresh: async () => makeSwapIntent(),
      });
      options?.onEvent?.({ type: 'status', status: 'route_building' } as never);
      options?.onEvent?.({ type: 'status', status: 'route_ready' } as never);
      options?.onEvent?.({ type: 'status', status: 'awaiting_approval' } as never);
      options?.onEvent?.({ type: 'status', status: 'approved' } as never);
      options?.onEvent?.({
        type: 'plan_preview',
        plan: makeSwapPreviewState().plan,
      } as never);
      options?.onEvent?.({
        type: 'plan_confirmed',
        plan: makeSwapPreviewState().plan,
      } as never);
      options?.onEvent?.({ type: 'status', status: 'executing' } as never);
      options?.onEvent?.({
        type: 'plan_progress',
        stepType: 'source_swap',
        state: 'submitted',
        step: makeSwapPreviewState().plan.steps[0] as never,
        txHash: TX_HASH,
        explorerUrl: 'https://basescan.org/tx/0x1',
      } as never);
      options?.onEvent?.({ type: 'status', status: 'completed' } as never);
      return {
        sourceSwaps: [],
        intentExplorerUrl: '',
        destinationSwap: null,
        intent: makeSwapIntent(),
      };
    });

    const query = createSwapAndExecuteQuery({
      chainList: makeChainList(),
      evmClient: makeEvmClient(),
      middlewareClient,
      ephemeralWallet: makeEphemeralWallet(),
      eoaAddress: USER_ADDRESS,
    });

    const events: SwapAndExecuteEvent[] = [];

    await query.swapAndExecute(makeParams(), {
      onEvent: ((event: SwapAndExecuteEvent) => {
        events.push(event);
      }) as never,
      onIntent: ((data: SwapAndExecuteOnIntentHookData) => {
        void data.refresh().then((nextIntent: SwapAndExecuteIntent) => {
          expect(nextIntent.swapRequired).toBe(true);
          data.allow();
        });
      }) as never,
    } as never);

    const statuses = events
      .filter((event): event is Extract<SwapAndExecuteEvent, { type: 'status' }> => event.type === 'status')
      .map((event) => event.status);
    const confirmedEvent = events.find(
      (event): event is Extract<SwapAndExecuteEvent, { type: 'plan_confirmed' }> =>
        event.type === 'plan_confirmed'
    );
    const confirmedEvents = events.filter((event) => event.type === 'plan_confirmed');
    const previewEvents = events.filter(
      (event): event is Extract<SwapAndExecuteEvent, { type: 'plan_preview' }> =>
        event.type === 'plan_preview'
    );
    const progressEvent = events.find(
      (event): event is Extract<SwapAndExecuteEvent, { type: 'plan_progress' }> =>
        event.type === 'plan_progress'
    );

    expect(previewEvents).toHaveLength(2);
    expect(previewEvents[0]?.plan.swapRequired).toBe(false);
    expect(previewEvents[1]?.plan.swapRequired).toBe(true);
    expect(confirmedEvents).toHaveLength(1);
    expect(confirmedEvent?.plan).toBe(previewEvents[1]?.plan);
    expect(statuses.filter((status) => status === 'route_building')).toHaveLength(1);
    expect(statuses.filter((status) => status === 'route_ready')).toHaveLength(1);
    expect(statuses.filter((status) => status === 'awaiting_approval')).toHaveLength(1);
    expect(statuses.filter((status) => status === 'approved')).toHaveLength(1);
    expect(statuses.filter((status) => status === 'executing')).toHaveLength(1);
    expect(progressEvent?.stepType).toBe('source_swap');
  });

  it('accounts for execute approval gas when deciding whether swap funding is required', async () => {
    const query = createSwapAndExecuteQuery({
      chainList: makeChainList(),
      evmClient: makeEvmClient(),
      middlewareClient: makeMiddlewareClient(makeApprovalShortfallBalances()),
      ephemeralWallet: makeEphemeralWallet(),
      eoaAddress: USER_ADDRESS,
    });

    await query.swapAndExecute(
      makeParams({
        execute: {
          to: TARGET_CONTRACT,
          data: '0xdeadbeef' as Hex,
          gas: 100000n,
          tokenApproval: {
            toTokenAddress: USDC,
            amount: 100000000n,
            spender: TARGET_CONTRACT,
          },
        },
      }),
      undefined
    );

    const swapCall = vi.mocked(swap).mock.calls[0];
    expect(swapCall?.[0]).toMatchObject({
      mode: SwapMode.EXACT_OUT,
      data: {
        toTokenAddress: USDC,
        // tokenShortfall=0 (user has the required USDC on dst), so the negative reserve
        // sentinel kicks in — the funding swap will run for gas, but must NOT consume
        // the user's USDC as a source.
        toAmountRaw: -100000000n,
        toNativeAmountRaw: 80000000000000n,
      },
    });
  });

  it('passes final approval gas and raw execution gas into the estimator for Arbitrum', async () => {
    const query = createSwapAndExecuteQuery({
      chainList: makeChainList(),
      evmClient: makeEvmClient(),
      middlewareClient: makeMiddlewareClient(makeApprovalShortfallBalances()),
      ephemeralWallet: makeEphemeralWallet(),
      eoaAddress: USER_ADDRESS,
    });

    await query.swapAndExecute(
      makeParams({
        execute: {
          to: TARGET_CONTRACT,
          data: '0xdeadbeef' as Hex,
          gas: 100000n,
          tokenApproval: {
            toTokenAddress: USDC,
            amount: 100000000n,
            spender: TARGET_CONTRACT,
          },
        },
      })
    );

    expect(estimateTotalFeesMock).toHaveBeenCalledWith(
      mockPublicClient,
      ARB_CHAIN,
      [
        expect.objectContaining({
          gasEstimate: 50000n,
          gasEstimateKind: 'final',
        }),
        expect.objectContaining({
          gasEstimate: 100000n,
        }),
      ],
      'medium'
    );
  });

  it('auto-approves the execute-only path when no composite intent hook is provided', async () => {
    const events: SwapAndExecuteEvent[] = [];
    const query = createSwapAndExecuteQuery({
      chainList: makeChainList(),
      evmClient: makeEvmClient(),
      middlewareClient: makeMiddlewareClient(makeExecuteOnlyBalances()),
      ephemeralWallet: makeEphemeralWallet(),
      eoaAddress: USER_ADDRESS,
    });

    await query.swapAndExecute(makeParams(), {
      onEvent: ((event: SwapAndExecuteEvent) => {
        events.push(event);
      }) as never,
    } as never);

    expect(events).toEqual(
      expect.arrayContaining([
        { type: 'status', status: 'preparing' },
        { type: 'status', status: 'route_building' },
        { type: 'status', status: 'route_ready' },
        { type: 'status', status: 'awaiting_approval' },
        { type: 'status', status: 'approved' },
        { type: 'status', status: 'executing' },
        { type: 'status', status: 'completed' },
        {
          type: 'plan_confirmed',
          plan: expect.objectContaining<Partial<SwapAndExecutePlan>>({
            swapRequired: false,
          }),
        },
      ])
    );
  });

  it('does not fail the public flow when onEvent throws during swap plan progress', async () => {
    vi.mocked(buildSwapPreflight).mockResolvedValue(makePreflight(makeFundingRequiredBalances()));
    vi.mocked(buildSwapPreviewState).mockResolvedValue(makeSwapPreviewState());
    vi.mocked(swap).mockImplementation(async (_input, _deps, options) => {
      options?.onIntent?.({
        allow: () => undefined,
        deny: () => undefined,
        intent: makeSwapIntent(),
        refresh: async () => makeSwapIntent(),
      });
      options?.onEvent?.({
        type: 'plan_progress',
        stepType: 'source_swap',
        state: 'submitted',
        step: makeSwapPreviewState().plan.steps[0] as never,
        txHash: TX_HASH,
        explorerUrl: 'https://basescan.org/tx/0x1',
      } as never);
      return {
        sourceSwaps: [],
        intentExplorerUrl: '',
        destinationSwap: null,
        intent: makeSwapIntent(),
      };
    });

    const evmClient = makeEvmClient();
    const query = createSwapAndExecuteQuery({
      chainList: makeChainList(),
      evmClient,
      middlewareClient: makeMiddlewareClient(makeFundingRequiredBalances()),
      ephemeralWallet: makeEphemeralWallet(),
      eoaAddress: USER_ADDRESS,
    });

    await expect(
      query.swapAndExecute(makeParams(), {
        onEvent: ((event: SwapAndExecuteEvent) => {
          if (event.type === 'plan_progress') {
            throw new Error('boom');
          }
        }) as never,
      } as never)
    ).resolves.toMatchObject({
      swapSkipped: false,
      execute: expect.objectContaining({
        txHash: TX_HASH,
      }),
    });

    expect(swap).toHaveBeenCalledTimes(1);
    expect(evmClient.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it('passes EIP-1559 feeParams when useLegacyPricing is false', async () => {
    vi.mocked(buildSwapPreflight).mockResolvedValue(makePreflight(makeExecuteOnlyBalances()) as never);

    const evmClient = makeEvmClient();
    const query = createSwapAndExecuteQuery({
      chainList: makeChainList(),
      evmClient,
      middlewareClient: makeMiddlewareClient(makeExecuteOnlyBalances()),
      ephemeralWallet: makeEphemeralWallet(),
      eoaAddress: USER_ADDRESS,
      skipSwapOverride: true,
    });

    await query.swapAndExecute(makeParams());

    expect(evmClient.sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        maxFeePerGas: 1_000_000_000n,
        maxPriorityFeePerGas: 1_000_000_000n,
      })
    );
    expect(evmClient.sendTransaction).not.toHaveBeenCalledWith(
      expect.objectContaining({ gasPrice: expect.anything() })
    );
  });

  it('passes legacy feeParams when useLegacyPricing is true (Arbitrum)', async () => {
    estimateTotalFeesMock.mockImplementation(async (_client: unknown, _chainId: unknown, items: Array<unknown>) => {
      const makeFee = (gasLimit: bigint) => ({
        l1Fee: 0n,
        l2Fee: gasLimit * 1_000_000_000n,
        total: gasLimit * 1_000_000_000n,
        recommended: {
          gasLimit,
          maxFeePerGas: 1_000_000_000n,
          maxPriorityFeePerGas: 0n,
          totalMaxCost: gasLimit * 1_000_000_000n,
          useLegacyPricing: true,
        },
      });
      return items.length === 1 ? [makeFee(120_000n)] : [makeFee(60_000n), makeFee(120_000n)];
    });
    vi.mocked(buildSwapPreflight).mockResolvedValue(makePreflight(makeExecuteOnlyBalances()) as never);

    const evmClient = makeEvmClient();
    const query = createSwapAndExecuteQuery({
      chainList: makeChainList(),
      evmClient,
      middlewareClient: makeMiddlewareClient(makeExecuteOnlyBalances()),
      ephemeralWallet: makeEphemeralWallet(),
      eoaAddress: USER_ADDRESS,
      skipSwapOverride: true,
    });

    await query.swapAndExecute(makeParams());

    expect(evmClient.sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        gasPrice: 1_000_000_000n,
      })
    );
    expect(evmClient.sendTransaction).not.toHaveBeenCalledWith(
      expect.objectContaining({ maxFeePerGas: expect.anything() })
    );
  });
});
