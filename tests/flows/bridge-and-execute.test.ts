import Decimal from 'decimal.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hex } from 'viem';
import type {
  AllowanceHookSources,
  BridgeAndExecuteEvent,
  BridgeAndExecuteIntent,
  BridgeAndExecutePlan,
  BridgeAndExecuteOnIntentHookData,
  BridgeIntent,
  Chain,
  ChainListType,
  TokenInfo,
  TokenBalance,
} from '../../src';
import { Universe } from '../../src/domain/chain-abstraction';

const mockPublicClient = vi.hoisted(() => ({}));

const estimateTotalFeesMock = vi.hoisted(() => vi.fn());
const bridgeExecuteMock = vi.hoisted(() => vi.fn());
const bridgeSimulateMock = vi.hoisted(() => vi.fn());
const getBalancesForBridgeMock = vi.hoisted(() => vi.fn());

vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem');
  return {
    ...actual,
    createPublicClient: vi.fn().mockReturnValue(mockPublicClient),
    http: vi.fn().mockReturnValue({}),
  };
});

vi.mock(
  '../../src/services/fee-estimation',
  () => ({
    estimateTotalFees: estimateTotalFeesMock,
  })
);

vi.mock('../../src/services/evm', () => ({
  packERC20Approve: vi.fn().mockReturnValue('0xapprove' as Hex),
  switchChain: vi.fn().mockResolvedValue(undefined),
  waitForTxReceipt: vi.fn().mockResolvedValue([
    {
      status: 'success',
      transactionHash: '0xreceipt' as Hex,
      blockNumber: 1n,
      effectiveGasPrice: 1n,
      gasUsed: 21_000n,
    },
    null,
  ]),
}));

vi.mock('../../src/services/allowance-utils', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/allowance-utils')>(
    '../../src/services/allowance-utils'
  );
  return {
    ...actual,
    erc20GetAllowance: vi.fn().mockResolvedValue(0n),
    getAllowances: vi.fn().mockResolvedValue({}),
  };
});

vi.mock('../../src/services/balances', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/balances')>(
    '../../src/services/balances'
  );
  return {
    ...actual,
    getBalancesForBridge: (...args: unknown[]) => getBalancesForBridgeMock(...args),
  };
});

vi.mock('../../src/flows/bridge', async () => {
  const actual = await vi.importActual<typeof import('../../src/flows/bridge')>(
    '../../src/flows/bridge'
  );
  return {
    ...actual,
    executeBridge: (...args: unknown[]) => bridgeExecuteMock(...args),
    simulateBridge: (...args: unknown[]) => bridgeSimulateMock(...args),
  };
});

import {
  bridgeAndExecute,
  simulateBridgeAndExecute,
} from '../../src/flows/bridge-and-execute';
import { makeBridgeAndExecuteMiddlewareClient } from '../helpers/middleware-client';

const TX_HASH = '0x1111111111111111111111111111111111111111111111111111111111111111' as Hex;
const USER_ADDRESS = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Hex;
const TARGET_CONTRACT = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Hex;
const SPENDER = '0xcccccccccccccccccccccccccccccccccccccccc' as Hex;
const TOKEN_ADDRESS = '0xdddddddddddddddddddddddddddddddddddddddd' as Hex;
const NATIVE_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as Hex;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Hex;

const token: TokenInfo = {
  contractAddress: TOKEN_ADDRESS,
  decimals: 6,
  logo: 'https://token.example/logo.png',
  name: 'USD Coin',
  symbol: 'USDC',
};

const chain: Chain = {
  id: 42161,
  name: 'Arbitrum',
  universe: Universe.ETHEREUM,
  multicallAddress: '0x',
  nativeCurrency: {
    decimals: 18,
    logo: '',
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: {
      http: ['https://arb.example'],
      webSocket: ['wss://arb.example'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Arbiscan',
      url: 'https://arbiscan.io',
    },
  },
  custom: {
    icon: 'https://arb.example/logo.png',
    knownTokens: [token],
  },
};

const sourceChain: Chain = {
  ...chain,
  id: 1,
  name: 'Ethereum',
  custom: {
    ...chain.custom,
    icon: 'https://eth.example/logo.png',
  },
};

const makeChainList = (): ChainListType =>
  ({
    getChainAndTokenFromSymbol: vi.fn().mockReturnValue({
      chain,
      token,
      isNativeToken: false,
    }),
    getChainByID: vi.fn().mockImplementation((chainId: number) =>
      chainId === sourceChain.id ? sourceChain : chain
    ),
    getTokenInfoBySymbol: vi.fn().mockReturnValue(token),
    getTokenByAddress: vi.fn().mockImplementation((_chainId: number, address: Hex) =>
      address.toLowerCase() === token.contractAddress.toLowerCase() ? token : null
    ),
    getChainAndTokenByAddress: vi.fn().mockImplementation((chainId: number, _address: Hex) => ({
      chain: chainId === sourceChain.id ? sourceChain : chain,
      token,
    })),
    getNativeToken: vi.fn().mockReturnValue({
      contractAddress: NATIVE_ADDRESS,
      decimals: chain.nativeCurrency.decimals,
      logo: '',
      name: chain.nativeCurrency.name,
      symbol: chain.nativeCurrency.symbol,
    }),
    getVaultContractAddress: vi
      .fn()
      .mockReturnValue('0xffffffffffffffffffffffffffffffffffffffff' as Hex),
    getTokenByCurrencyId: vi.fn().mockImplementation(() => {
      throw new Error('Token not found');
    }),
    chains: [chain, sourceChain],
  }) as unknown as ChainListType;

const makeEvmClient = () => ({
  getAddresses: vi.fn().mockResolvedValue([USER_ADDRESS]),
  sendTransaction: vi.fn().mockResolvedValue(TX_HASH),
});

type BridgeAndExecuteMiddlewareClient = ReturnType<typeof makeBridgeAndExecuteMiddlewareClient>;

const makeMiddlewareClient = (overrides?: {
  simulateBundleV2?: (...args: unknown[]) => Promise<{ gas: bigint[] }>;
  getOraclePrices?: () => Promise<
    Array<{
      universe: 'EVM' | 'TRON' | 'FUEL' | 'SVM';
      chainId: number;
      priceUsd: Decimal;
      tokenAddress: Hex;
      tokenSymbol: string;
      tokenDecimals: number;
      timestamp: number;
    }>
  >;
}): BridgeAndExecuteMiddlewareClient =>
  makeBridgeAndExecuteMiddlewareClient({
    simulateBundleV2:
      overrides?.simulateBundleV2 ?? vi.fn().mockResolvedValue({ gas: [21_000n] }),
    getRFFStatus: vi.fn().mockResolvedValue({ status: 'created' }),
    getOraclePrices:
      overrides?.getOraclePrices ??
      (async () => [
        {
          universe: 'EVM',
          chainId: chain.id,
          priceUsd: new Decimal(1),
          tokenAddress: token.contractAddress,
          tokenSymbol: token.symbol,
          tokenDecimals: token.decimals,
          timestamp: 1,
        },
        {
          universe: 'EVM',
          chainId: chain.id,
          priceUsd: new Decimal(2500),
          tokenAddress: ZERO_ADDRESS,
          tokenSymbol: chain.nativeCurrency.symbol,
          tokenDecimals: chain.nativeCurrency.decimals,
          timestamp: 1,
        },
      ]),
    getQuote: vi.fn().mockResolvedValue({
      fulfillmentBps: 0,
      sources: [
        {
          chainId: sourceChain.id,
          tokenAddress: TOKEN_ADDRESS,
          depositFeeUsd: '0',
          depositFeeToken: '0',
        },
      ],
      destination: {
        chainId: chain.id,
        tokenAddress: TOKEN_ADDRESS,
        fulfillmentFeeUsd: '0',
        fulfillmentFeeToken: '0',
      },
    }),
  });

const makeReadableIntent = (): BridgeIntent => ({
  availableSources: [],
  destination: {
    amount: '1',
    amountRaw: 1_000_000n,
    chain: { id: chain.id, name: chain.name, logo: chain.custom.icon },
    token: {
      decimals: token.decimals,
      symbol: token.symbol,
      logo: token.logo,
      contractAddress: token.contractAddress,
    },
    value: '0.00',
    nativeAmount: '0.000000000000000000',
    nativeAmountRaw: 0n,
    nativeAmountValue: '0.00',
    nativeAmountInToken: '0.000000',
    nativeToken: {
      decimals: chain.nativeCurrency.decimals,
      symbol: chain.nativeCurrency.symbol,
      logo: '',
      contractAddress: NATIVE_ADDRESS,
    },
  },
  fees: {
    caGas: '0',
    protocol: '0',
    solver: '0',
    total: '0',
    totalValue: '0.00',
  },
  selectedSources: [],
  sourcesTotal: '0',
  sourcesTotalValue: '0.00',
  provider: 'nexus',
});

const makeBridgeResult = () => ({
  intentExplorerUrl: 'https://bridge.example/rff/0xabc',
  intent: makeReadableIntent(),
  sourceTxs: [],
});

const toBridgeParams = (input: {
  dstChain: Chain;
  dstToken: TokenInfo;
  tokenAmount: bigint;
  nativeAmount: bigint;
  sourceChains: number[];
}): import('../../src/bridge/types').BridgeFlowParams => ({
  recipient: USER_ADDRESS,
  dstChain: input.dstChain,
  dstToken: input.dstToken,
  tokenAmount: input.tokenAmount,
  nativeAmount: input.nativeAmount,
  sourceChains: input.sourceChains,
});

const createBridgeAndExecuteQuery = (
  chainList: ChainListType,
  evmClient: ReturnType<typeof makeEvmClient>,
  bridgeExecuteImpl: (...args: unknown[]) => Promise<unknown>,
  bridgeSimulateImpl: (...args: unknown[]) => Promise<unknown>,
  getUnifiedBalances: () => Promise<TokenBalance[]>,
  middlewareClient: BridgeAndExecuteMiddlewareClient
) => {
  getBalancesForBridgeMock.mockImplementation(() => getUnifiedBalances());
  bridgeExecuteMock.mockImplementation(
    (
      params: Parameters<typeof toBridgeParams>[0],
      _deps: unknown,
      options?: { emit?: (event: BridgeAndExecuteEvent) => void; hooks?: unknown }
    ) =>
      bridgeExecuteImpl(
        {
          toTokenSymbol: params.dstToken.symbol,
          toAmountRaw: params.tokenAmount,
          toChainId: params.dstChain.id,
          sources: params.sourceChains,
          toNativeAmountRaw: params.nativeAmount,
        },
        {
          onEvent: options?.emit,
          hooks: options?.hooks,
        }
      )
  );
  bridgeSimulateMock.mockImplementation((params: Parameters<typeof toBridgeParams>[0]) =>
    bridgeSimulateImpl({
      toTokenSymbol: params.dstToken.symbol,
      toAmountRaw: params.tokenAmount,
      toChainId: params.dstChain.id,
      sources: params.sourceChains,
      toNativeAmountRaw: params.nativeAmount,
    })
  );

  const deps = {
    chainList,
    middlewareClient,
    intentExplorerUrl: 'https://bridge.example',
    evm: {
      walletClient: evmClient as never,
      address: USER_ADDRESS,
    },
  };

  return {
    bridgeAndExecute: (
      params: Parameters<typeof bridgeAndExecute>[0],
      options?: Parameters<typeof bridgeAndExecute>[2]
    ) => bridgeAndExecute(params, deps, options),
    simulateBridgeAndExecute: (params: Parameters<typeof simulateBridgeAndExecute>[0]) =>
      simulateBridgeAndExecute(params, deps),
  };
};

const makeAllowanceSources = (): AllowanceHookSources => [
  {
    allowance: {
      current: '0',
      currentRaw: 0n,
      minimum: '1',
      minimumRaw: 1_000_000n,
    },
    chain: {
      id: chain.id,
      logo: chain.custom.icon,
      name: chain.name,
    },
    holderAddress: USER_ADDRESS,
    token: {
      contractAddress: token.contractAddress,
      decimals: token.decimals,
      logo: token.logo,
      name: token.name,
      symbol: token.symbol,
    },
  },
];

const makeParams = (overrides?: Record<string, unknown>) =>
  ({
    toChainId: chain.id,
    toTokenSymbol: token.symbol,
    toAmountRaw: 1_000_000n,
    execute: {
      to: TARGET_CONTRACT,
      data: '0xdeadbeef' as Hex,
      gas: 21_000n,
    },
    ...overrides,
  }) as never;

const richBalances: TokenBalance[] = [
  {
    balance: '10',
    value: '10.00',
    chainBalances: [
      {
        balance: '10',
        value: '10.00',
        chain: {
          id: chain.id,
          logo: chain.custom.icon,
          name: chain.name,
        },
        contractAddress: token.contractAddress,
        decimals: token.decimals,
        symbol: token.symbol,
        universe: Universe.ETHEREUM,
      },
    ],
    decimals: token.decimals,
    logo: token.logo,
    name: token.symbol,
    symbol: token.symbol,
  },
  {
    balance: '1',
    value: '1.00',
    chainBalances: [
      {
        balance: '1',
        value: '1.00',
        chain: {
          id: chain.id,
          logo: chain.custom.icon,
          name: chain.name,
        },
        contractAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as Hex,
        decimals: chain.nativeCurrency.decimals,
        symbol: chain.nativeCurrency.symbol,
        universe: Universe.ETHEREUM,
      },
    ],
    decimals: chain.nativeCurrency.decimals,
    logo: '',
    name: chain.nativeCurrency.symbol,
    symbol: chain.nativeCurrency.symbol,
  },
];

const sourceOnlyBalances: TokenBalance[] = [
  {
    balance: '10',
    value: '10.00',
    chainBalances: [
      {
        balance: '10',
        value: '10.00',
        chain: {
          id: sourceChain.id,
          logo: sourceChain.custom.icon,
          name: sourceChain.name,
        },
        contractAddress: token.contractAddress,
        decimals: token.decimals,
        symbol: token.symbol,
        universe: Universe.ETHEREUM,
      },
    ],
    decimals: token.decimals,
    logo: token.logo,
    name: token.symbol,
    symbol: token.symbol,
  },
];

describe('bridgeAndExecute event model', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    estimateTotalFeesMock.mockImplementation(async (_client, _chainId, items: Array<unknown>) =>
      items.length === 1
        ? [
            {
              l1Fee: 0n,
              l2Fee: 21_000_000_000_000n,
              total: 21_000_000_000_000n,
              recommended: {
                gasLimit: 25_200n,
                maxFeePerGas: 1_000_000_000n,
                maxPriorityFeePerGas: 1_000_000_000n,
                totalMaxCost: 25_200_000_000_000n,
                useLegacyPricing: false,
              },
            },
          ]
        : [
            {
              l1Fee: 0n,
              l2Fee: 70_000_000_000_000n,
              total: 70_000_000_000_000n,
              recommended: {
                gasLimit: 84_000n,
                maxFeePerGas: 1_000_000_000n,
                maxPriorityFeePerGas: 1_000_000_000n,
                totalMaxCost: 84_000_000_000_000n,
                useLegacyPricing: false,
              },
            },
            {
              l1Fee: 0n,
              l2Fee: 21_000_000_000_000n,
              total: 21_000_000_000_000n,
              recommended: {
                gasLimit: 25_200n,
                maxFeePerGas: 1_000_000_000n,
                maxPriorityFeePerGas: 1_000_000_000n,
                totalMaxCost: 25_200_000_000_000n,
                useLegacyPricing: false,
              },
            },
          ]
    );
  });

  it('creates a chain-aware public client for destination execution', async () => {
    const { createPublicClient } = await import('viem');
    const query = createBridgeAndExecuteQuery(
      makeChainList(),
      makeEvmClient() as never,
      vi.fn() as never,
      vi.fn() as never,
      async () => richBalances,
      makeMiddlewareClient()
    );

    await query.bridgeAndExecute(makeParams());

    expect(createPublicClient).toHaveBeenCalledWith(
      expect.objectContaining({
        chain: expect.objectContaining({ id: chain.id }),
      })
    );
  });

  it('passes raw approval and execution gas estimates into the shared estimator', async () => {
    const query = createBridgeAndExecuteQuery(
      makeChainList(),
      makeEvmClient() as never,
      vi.fn() as never,
      vi.fn() as never,
      async () => richBalances,
      makeMiddlewareClient({
        simulateBundleV2: vi.fn().mockResolvedValue({ gas: [70_000n, 21_000n] }),
      })
    );

    await query.bridgeAndExecute(
      makeParams({
        execute: {
          to: TARGET_CONTRACT,
          data: '0xdeadbeef' as Hex,
          tokenApproval: {
            toTokenSymbol: token.symbol,
            amount: 1_000_000n,
            spender: SPENDER,
          },
        },
      })
    );

    expect(estimateTotalFeesMock).toHaveBeenCalledTimes(1);
    expect(estimateTotalFeesMock).toHaveBeenCalledWith(
      mockPublicClient,
      42161,
      [
        expect.objectContaining({
          gasEstimate: 70_000n,
        }),
        expect.objectContaining({
          gasEstimate: 21_000n,
        }),
      ],
      'medium'
    );
    const [, , items] = estimateTotalFeesMock.mock.calls[0] ?? [];
    expect(items).toHaveLength(2);
    expect(items?.every((item: { gasEstimateKind?: 'raw' | 'final' }) => item.gasEstimateKind !== 'final')).toBe(true);
  });

  it('auto-approves the execute-only path when no composite intent hook is provided', async () => {
    const bridgeExecute = vi.fn();
    const query = createBridgeAndExecuteQuery(
      makeChainList(),
      makeEvmClient() as never,
      bridgeExecute as never,
      vi.fn() as never,
      async () => richBalances,
      makeMiddlewareClient()
    );

    const events: BridgeAndExecuteEvent[] = [];

    await query.bridgeAndExecute(makeParams(), {
      onEvent: ((event: BridgeAndExecuteEvent) => {
        events.push(event);
      }) as never,
    } as never);

    expect(bridgeExecute).not.toHaveBeenCalled();
    expect(events).toEqual(
      expect.arrayContaining([
        { type: 'status', status: 'preparing' },
        { type: 'status', status: 'intent_building' },
        { type: 'status', status: 'intent_ready' },
        {
          type: 'plan_preview',
          plan: expect.objectContaining<Partial<BridgeAndExecutePlan>>({
            bridgeRequired: false,
            steps: expect.arrayContaining([
              expect.objectContaining({ type: 'execute_transaction' }),
            ]),
          }),
        },
        { type: 'status', status: 'awaiting_approval' },
        { type: 'status', status: 'approved' },
        {
          type: 'plan_confirmed',
          plan: expect.objectContaining<Partial<BridgeAndExecutePlan>>({
            bridgeRequired: false,
            steps: expect.arrayContaining([
              expect.objectContaining({ type: 'execute_transaction' }),
            ]),
          }),
        },
        { type: 'status', status: 'executing' },
        expect.objectContaining({
          type: 'plan_progress',
          stepType: 'execute_transaction',
          state: 'submitted',
        }),
        expect.objectContaining({
          type: 'plan_progress',
          stepType: 'execute_transaction',
          state: 'confirmed',
        }),
        { type: 'status', status: 'completed' },
      ])
    );
  });

  it('waits for top-level composite approval before executing the skipped path', async () => {
    const evmClient = makeEvmClient();
    const bridgeExecute = vi.fn();
    const query = createBridgeAndExecuteQuery(
      makeChainList(),
      evmClient as never,
      bridgeExecute as never,
      vi.fn() as never,
      async () => richBalances,
      makeMiddlewareClient()
    );

    const events: BridgeAndExecuteEvent[] = [];
    let hookData: BridgeAndExecuteOnIntentHookData | undefined;

    const pending = query.bridgeAndExecute(makeParams(), {
      onEvent: ((event: BridgeAndExecuteEvent) => {
        events.push(event);
      }) as never,
      onIntent: ((data: BridgeAndExecuteOnIntentHookData) => {
        hookData = data;
      }) as never,
    } as never);

    await vi.waitFor(() => {
      expect(hookData).toBeDefined();
    });

    expect(hookData?.intent.bridgeRequired).toBe(false);
    expect(evmClient.sendTransaction).not.toHaveBeenCalled();
    expect(bridgeExecute).not.toHaveBeenCalled();
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

  it('refreshes from bridge-required to execute-only and confirms the latest preview', async () => {
    const bridgeExecute = vi.fn();
    const balances = vi
      .fn<() => Promise<TokenBalance[]>>()
      .mockResolvedValueOnce(sourceOnlyBalances)
      .mockResolvedValueOnce(richBalances);
    const query = createBridgeAndExecuteQuery(
      makeChainList(),
      makeEvmClient() as never,
      bridgeExecute as never,
      vi.fn() as never,
      balances,
      makeMiddlewareClient({
        simulateBundleV2: vi.fn().mockResolvedValue({ gas: [21_000n] }),
      })
    );

    const events: BridgeAndExecuteEvent[] = [];

    await query.bridgeAndExecute(makeParams(), {
      onEvent: ((event: BridgeAndExecuteEvent) => {
        events.push(event);
      }) as never,
      onIntent: ((data: BridgeAndExecuteOnIntentHookData) => {
        expect(data.intent.bridgeRequired).toBe(true);
        void data.refresh().then((nextIntent: BridgeAndExecuteIntent) => {
          expect(nextIntent.bridgeRequired).toBe(false);
          data.allow();
        });
      }) as never,
    } as never);

    expect(bridgeExecute).not.toHaveBeenCalled();
    const previewEvents = events.filter(
      (event): event is Extract<BridgeAndExecuteEvent, { type: 'plan_preview' }> =>
        event.type === 'plan_preview'
    );
    const confirmedEvent = events.find(
      (event): event is Extract<BridgeAndExecuteEvent, { type: 'plan_confirmed' }> =>
        event.type === 'plan_confirmed'
    );

    expect(previewEvents).toHaveLength(2);
    expect(previewEvents[0]?.plan.bridgeRequired).toBe(true);
    expect(previewEvents[1]?.plan.bridgeRequired).toBe(false);
    expect(confirmedEvent?.plan).toEqual(previewEvents[1]?.plan);
  });

  it('refreshes from execute-only to bridge-required and suppresses internal bridge pre-approval events', async () => {
    const balances = vi
      .fn<() => Promise<TokenBalance[]>>()
      .mockResolvedValueOnce(richBalances)
      .mockResolvedValueOnce(sourceOnlyBalances);
    const bridgeExecute = vi.fn(
      async (
        _params: unknown,
        options?: {
          onEvent?: (event: BridgeAndExecuteEvent) => void;
          hooks?: {
            onIntent?: (data: {
              allow: () => void;
              deny: () => void;
              intent: BridgeIntent;
              refresh: () => Promise<BridgeIntent>;
            }) => void;
            onAllowance?: (data: { sources: AllowanceHookSources; allow: (values: Array<'min' | 'max' | bigint | string>) => void; deny: () => void }) => void;
          };
        }
      ) => {
        let intentApproved = false;
        options?.hooks?.onIntent?.({
          allow: () => {
            intentApproved = true;
          },
          deny: () => {
            throw new Error('deny should not be called');
          },
          intent: makeReadableIntent(),
          refresh: async () => makeReadableIntent(),
        });
        expect(intentApproved).toBe(true);

        let allowanceSelections: Array<'min' | 'max' | bigint | string> | undefined;
        options?.hooks?.onAllowance?.({
          sources: makeAllowanceSources(),
          allow: (values) => {
            allowanceSelections = values;
          },
          deny: () => {
            throw new Error('allowance deny should not be called');
          },
        });
        expect(allowanceSelections).toEqual(['min']);

        const emit = options?.onEvent as ((event: any) => void) | undefined;
        emit?.({ type: 'status', status: 'intent_building' });
        emit?.({ type: 'status', status: 'intent_ready' });
        emit?.({
          type: 'plan_preview',
          plan: {
            steps: [{ type: 'request_signing', id: 'request_signing' }],
          },
        });
        emit?.({ type: 'status', status: 'awaiting_approval' });
        emit?.({ type: 'status', status: 'approved' });
        emit?.({
          type: 'plan_confirmed',
          plan: {
            steps: [{ type: 'request_signing', id: 'request_signing' }],
          },
        });
        emit?.({ type: 'status', status: 'executing' });
        emit?.({
          type: 'plan_progress',
          stepType: 'request_signing',
          state: 'completed',
          step: { type: 'request_signing', id: 'request_signing' },
          intentRequestHash: '0xreq',
        });
        emit?.({ type: 'status', status: 'completed' });
        return makeBridgeResult();
      }
    );

    const query = createBridgeAndExecuteQuery(
      makeChainList(),
      makeEvmClient() as never,
      bridgeExecute as never,
      vi.fn() as never,
      balances,
      makeMiddlewareClient({
        simulateBundleV2: vi.fn().mockResolvedValue({ gas: [21_000n] }),
      })
    );

    const events: BridgeAndExecuteEvent[] = [];
    let hookData: BridgeAndExecuteOnIntentHookData | undefined;

    await query.bridgeAndExecute(makeParams(), {
      onEvent: ((event: BridgeAndExecuteEvent) => {
        events.push(event);
      }) as never,
      onIntent: ((data: BridgeAndExecuteOnIntentHookData) => {
        hookData = data;
        void data.refresh().then((nextIntent: BridgeAndExecuteIntent) => {
          expect(nextIntent.bridgeRequired).toBe(true);
          data.allow();
        });
      }) as never,
    } as never);

    expect(hookData?.intent.bridgeRequired).toBe(false);
    expect(bridgeExecute).toHaveBeenCalledTimes(1);

    const previewEvents = events.filter((event) => event.type === 'plan_preview');
    const confirmedEvents = events.filter((event) => event.type === 'plan_confirmed');
    const statuses = events
      .filter((event): event is Extract<BridgeAndExecuteEvent, { type: 'status' }> => event.type === 'status')
      .map((event) => event.status);
    const firstProgressIndex = events.findIndex((event) => event.type === 'plan_progress');
    const executingIndex = events.findIndex(
      (event) => event.type === 'status' && event.status === 'executing'
    );

    expect(previewEvents).toHaveLength(2);
    expect(confirmedEvents).toHaveLength(1);
    expect(statuses.filter((status) => status === 'intent_building')).toHaveLength(1);
    expect(statuses.filter((status) => status === 'intent_ready')).toHaveLength(1);
    expect(statuses.filter((status) => status === 'awaiting_approval')).toHaveLength(1);
    expect(statuses.filter((status) => status === 'approved')).toHaveLength(1);
    expect(statuses.filter((status) => status === 'executing')).toHaveLength(1);
    expect(executingIndex).toBeGreaterThan(-1);
    expect(firstProgressIndex).toBeGreaterThan(executingIndex);
    expect(confirmedEvents[0]?.plan).toEqual(previewEvents[1]?.plan);
  });

  it('merges execute steps into bridge preview and confirmed plans when bridge is required', async () => {
    const bridgeExecute = vi.fn(
      async (
        _params: unknown,
        options?: {
          onEvent?: (event: BridgeAndExecuteEvent) => void;
        }
      ) => {
        const emit = options?.onEvent as ((event: any) => void) | undefined;
        emit?.({ type: 'status', status: 'intent_building' });
        emit?.({ type: 'status', status: 'intent_ready' });
        emit?.({
          type: 'plan_preview',
          plan: {
            steps: [{ type: 'request_signing', id: 'request_signing' }],
          },
        });
        emit?.({ type: 'status', status: 'awaiting_approval' });
        emit?.({ type: 'status', status: 'approved' });
        emit?.({
          type: 'plan_confirmed',
          plan: {
            steps: [{ type: 'request_signing', id: 'request_signing' }],
          },
        });
        emit?.({ type: 'status', status: 'executing' });
        emit?.({
          type: 'plan_progress',
          stepType: 'request_signing',
          state: 'completed',
          step: { type: 'request_signing', id: 'request_signing' },
          intentRequestHash: '0xreq',
        });
        emit?.({ type: 'status', status: 'completed' });
        return makeBridgeResult();
      }
    );

    const query = createBridgeAndExecuteQuery(
      makeChainList(),
      makeEvmClient() as never,
      bridgeExecute as never,
      vi.fn() as never,
      async () => sourceOnlyBalances,
      makeMiddlewareClient({
        simulateBundleV2: vi.fn().mockResolvedValue({ gas: [21_000n] }),
      })
    );

    const events: BridgeAndExecuteEvent[] = [];

    await query.bridgeAndExecute(makeParams(), {
      onEvent: ((event: BridgeAndExecuteEvent) => {
        events.push(event);
      }) as never,
    } as never);

    const previewEvent = events.find((event) => event.type === 'plan_preview');
    const confirmedEvent = events.find((event) => event.type === 'plan_confirmed');

    expect(previewEvent).toMatchObject({
      type: 'plan_preview',
      plan: {
        bridgeRequired: true,
      },
    });
    expect(confirmedEvent).toMatchObject({
      type: 'plan_confirmed',
      plan: {
        bridgeRequired: true,
      },
    });

    if (!previewEvent || previewEvent.type !== 'plan_preview') {
      throw new Error('plan_preview not found');
    }
    if (!confirmedEvent || confirmedEvent.type !== 'plan_confirmed') {
      throw new Error('plan_confirmed not found');
    }

    expect(previewEvent.plan.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'request_signing' }),
        expect.objectContaining({ type: 'execute_transaction' }),
      ])
    );
    expect(confirmedEvent.plan.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'request_signing' }),
        expect.objectContaining({ type: 'execute_transaction' }),
      ])
    );
  });

  it('does not fail the public flow when onEvent throws during bridge plan progress', async () => {
    const evmClient = makeEvmClient();
    const bridgeExecute = vi.fn(
      async (
        _params: unknown,
        options?: {
          onEvent?: (event: BridgeAndExecuteEvent) => void;
          hooks?: {
            onIntent?: (data: {
              allow: () => void;
              deny: () => void;
              intent: BridgeIntent;
              refresh: () => Promise<BridgeIntent>;
            }) => void;
            onAllowance?: (data: {
              sources: AllowanceHookSources;
              allow: (values: Array<'min' | 'max' | bigint | string>) => void;
              deny: () => void;
            }) => void;
          };
        }
      ) => {
        options?.hooks?.onIntent?.({
          allow: () => undefined,
          deny: () => undefined,
          intent: makeReadableIntent(),
          refresh: async () => makeReadableIntent(),
        });
        options?.hooks?.onAllowance?.({
          sources: makeAllowanceSources(),
          allow: () => undefined,
          deny: () => undefined,
        });
        options?.onEvent?.({
          type: 'plan_progress',
          stepType: 'request_signing',
          state: 'completed',
          step: { type: 'request_signing', id: 'request_signing' },
          intentRequestHash: '0xreq',
        } as BridgeAndExecuteEvent);
        return makeBridgeResult();
      }
    );
    const query = createBridgeAndExecuteQuery(
      makeChainList(),
      evmClient as never,
      bridgeExecute as never,
      vi.fn() as never,
      async () => sourceOnlyBalances,
      makeMiddlewareClient({
        simulateBundleV2: vi.fn().mockResolvedValue({ gas: [21_000n] }),
      })
    );

    await expect(
      query.bridgeAndExecute(makeParams(), {
        onEvent: ((event: BridgeAndExecuteEvent) => {
          if (event.type === 'plan_progress') {
            throw new Error('boom');
          }
        }) as never,
      } as never)
    ).resolves.toMatchObject({
      bridgeSkipped: false,
      execute: { txHash: TX_HASH },
      bridgeResult: expect.objectContaining({
        intentExplorerUrl: 'https://bridge.example/rff/0xabc',
      }),
    });

    expect(bridgeExecute).toHaveBeenCalledTimes(1);
    expect(evmClient.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it('succeeds on execute-only path even when /quote fails', async () => {
    const evmClient = makeEvmClient();

    const failingQuoteMw = makeMiddlewareClient();
    (failingQuoteMw as any).getQuote = vi.fn().mockRejectedValue(new Error('quote service down'));

    const query = createBridgeAndExecuteQuery(
      makeChainList(),
      evmClient as never,
      vi.fn() as never,
      vi.fn() as never,
      async () => richBalances,
      failingQuoteMw
    );

    // richBalances has enough on destination → skipFunding, quote failure should not matter
    await expect(
      query.bridgeAndExecute(makeParams())
    ).resolves.toMatchObject({
      bridgeSkipped: true,
      execute: { txHash: TX_HASH },
      bridgeResult: undefined,
    });
  });

  it('passes EIP-1559 feeParams when useLegacyPricing is false', async () => {
    const evmClient = makeEvmClient();
    const query = createBridgeAndExecuteQuery(
      makeChainList(),
      evmClient as never,
      vi.fn() as never,
      vi.fn() as never,
      async () => richBalances,
      makeMiddlewareClient()
    );

    await query.bridgeAndExecute(makeParams());

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
      return items.length === 1 ? [makeFee(25_200n)] : [makeFee(84_000n), makeFee(25_200n)];
    });

    const evmClient = makeEvmClient();
    const query = createBridgeAndExecuteQuery(
      makeChainList(),
      evmClient as never,
      vi.fn() as never,
      vi.fn() as never,
      async () => richBalances,
      makeMiddlewareClient()
    );

    await query.bridgeAndExecute(makeParams());

    expect(evmClient.sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        gasPrice: 1_000_000_000n,
      })
    );
    expect(evmClient.sendTransaction).not.toHaveBeenCalledWith(
      expect.objectContaining({ maxFeePerGas: expect.anything() })
    );
  });

  it('simulateBridgeAndExecute returns combined approval + tx gas units', async () => {
    const evmClient = makeEvmClient();
    const query = createBridgeAndExecuteQuery(
      makeChainList(),
      evmClient as never,
      vi.fn() as never,
      vi.fn() as never,
      async () => richBalances,
      makeMiddlewareClient()
    );

    const paramsWithApproval = makeParams({
      execute: {
        to: TARGET_CONTRACT,
        data: '0xdeadbeef' as Hex,
        gas: 21_000n,
        tokenApproval: {
          toTokenSymbol: token.symbol,
          amount: 1_000_000n,
          spender: SPENDER,
        },
      },
    });

    const result = await query.simulateBridgeAndExecute(paramsWithApproval);

    // approval gasLimit (84_000) + tx gasLimit (25_200) from the 2-item mock
    expect(result.executeSimulation.estimatedGasUnits).toBe(84_000n + 25_200n);
    expect(result.executeSimulation.estimatedTotalCost).toBeGreaterThan(0n);
    expect(result.executeSimulation.feeParams.type).toBe('eip1559');
  });

  it('simulateBridgeAndExecute returns tx-only gas units when no approval needed', async () => {
    // erc20GetAllowance returns MAX so no approval is needed
    const { erc20GetAllowance: mockAllowance } = await import(
      '../../src/services/allowance-utils'
    );
    vi.mocked(mockAllowance).mockResolvedValueOnce(BigInt(Number.MAX_SAFE_INTEGER));

    const evmClient = makeEvmClient();
    const query = createBridgeAndExecuteQuery(
      makeChainList(),
      evmClient as never,
      vi.fn() as never,
      vi.fn() as never,
      async () => richBalances,
      makeMiddlewareClient()
    );

    const paramsWithApproval = makeParams({
      execute: {
        to: TARGET_CONTRACT,
        data: '0xdeadbeef' as Hex,
        gas: 21_000n,
        tokenApproval: {
          toTokenSymbol: token.symbol,
          amount: 1_000_000n,
          spender: SPENDER,
        },
      },
    });

    const result = await query.simulateBridgeAndExecute(paramsWithApproval);

    // only tx gasLimit (25_200) from the 1-item mock since allowance is sufficient
    expect(result.executeSimulation.estimatedGasUnits).toBe(25_200n);
  });
});
