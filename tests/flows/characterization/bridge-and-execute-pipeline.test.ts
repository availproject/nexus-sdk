import Decimal from 'decimal.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hex } from 'viem';
import { maxUint256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type {
  BridgeAndExecuteEvent,
  BridgeParams,
  Chain,
  ChainListType,
  TokenInfo,
  TokenBalance,
} from '../../../src';
import {
  executeBridge as executeBridgeWithDeps,
  simulateBridge as simulateBridgeWithDeps,
} from '../../../src/flows/bridge';
import {
  bridgeAndExecute,
  simulateBridgeAndExecute,
} from '../../../src/flows/bridge-and-execute';
import { Universe } from '../../../src/domain/chain-abstraction';
import { encodeChainIdToBytes32, parseHexToTokenBytes } from '../../../src/transport/encoding';
import { makeBridgeAndExecuteMiddlewareClient } from '../../helpers/middleware-client';
import { UnifiedBalanceResponseData } from '../../../src/domain/types';
import { BridgeDeps } from '../../../src/flows/deps';

const hoisted = vi.hoisted(() => {
  const readContract = vi.fn();
  const getFeeHistory = vi.fn();
  const waitForTransactionReceipt = vi.fn();
  const watchContractEvent = vi.fn();
  const estimateFeesPerGas = vi.fn();
  const createPublicClient = vi.fn((options?: { chain?: unknown }) => ({
    chain: options?.chain,
    readContract,
    getFeeHistory,
    waitForTransactionReceipt,
    watchContractEvent,
    estimateFeesPerGas,
  }));

  return {
    createPublicClient,
    readContract,
    getFeeHistory,
    waitForTransactionReceipt,
    watchContractEvent,
    estimateFeesPerGas,
  };
});

const getBalancesForBridgeMock = vi.hoisted(() => vi.fn());

vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem');
  return {
    ...actual,
    createPublicClient: hoisted.createPublicClient,
    http: vi.fn().mockReturnValue({}),
    fallback: vi.fn().mockReturnValue({}),
  };
});

vi.mock('../../../src/services/balances', async () => {
  const actual = await vi.importActual<typeof import('../../../src/services/balances')>(
    '../../../src/services/balances'
  );
  return {
    ...actual,
    getBalancesForBridge: (...args: unknown[]) => getBalancesForBridgeMock(...args),
  };
});

const SOURCE_CHAIN_ID = 9000;
const DEST_CHAIN_ID = 9001;
const TOKEN_ADDRESS = '0xdddddddddddddddddddddddddddddddddddddddd' as Hex;
const NATIVE_ADDRESS = '0x0000000000000000000000000000000000000000' as Hex;
const USER_PRIVATE_KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4e7b5d3b9c2a5' as const;
const USER_ACCOUNT = privateKeyToAccount(USER_PRIVATE_KEY);
const USER_ADDRESS = USER_ACCOUNT.address;
const TARGET_CONTRACT = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Hex;
const VAULT_ADDRESS = '0xffffffffffffffffffffffffffffffffffffffff' as Hex;
const EXECUTE_TX_HASH =
  '0x1111111111111111111111111111111111111111111111111111111111111111' as Hex;
const REQUEST_HASH =
  '0x2222222222222222222222222222222222222222222222222222222222222222' as Hex;

const token: TokenInfo = {
  contractAddress: TOKEN_ADDRESS,
  decimals: 6,
  logo: 'https://token.example/logo.png',
  name: 'USD Coin',
  symbol: 'USDC',
};

const makeChain = (id: number, name: string): Chain => ({
  id,
  name,
  universe: Universe.ETHEREUM,
  multicallAddress: '0x00000000000000000000000000000000000000aa',
  nativeCurrency: {
    decimals: 18,
    logo: '',
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: {
      http: [`https://${name.toLowerCase()}.example`],
      webSocket: [`wss://${name.toLowerCase()}.example`],
    },
  },
  blockExplorers: {
    default: {
      name: `${name}Scan`,
      url: `https://${name.toLowerCase()}scan.example`,
    },
  },
  custom: {
    icon: `https://${name.toLowerCase()}.example/icon.png`,
    knownTokens: [token],
  },
  supports7702: true,
});

const sourceChain = makeChain(SOURCE_CHAIN_ID, 'Source');
const dstChain = makeChain(DEST_CHAIN_ID, 'Destination');

const nativeToken = {
  contractAddress: NATIVE_ADDRESS,
  decimals: 18,
  logo: '',
  name: 'Ether',
  symbol: 'ETH',
};

const makeChainList = (): ChainListType =>
  ({
    chains: [sourceChain, dstChain],
    getVaultContractAddress: vi.fn().mockReturnValue(VAULT_ADDRESS),
    getTokenInfoBySymbol: vi.fn().mockReturnValue(token),
    getChainAndTokenFromSymbol: vi.fn().mockImplementation((chainId: number) => ({
      chain: chainId === SOURCE_CHAIN_ID ? sourceChain : dstChain,
      token,
      isNativeToken: false,
    })),
    getTokenByAddress: vi.fn().mockImplementation((_chainId: number, address: Hex) => {
      if (address.toLowerCase() === TOKEN_ADDRESS.toLowerCase()) {
        return token;
      }
      if (address.toLowerCase() === NATIVE_ADDRESS.toLowerCase()) {
        return nativeToken;
      }
      return null;
    }),
    getChainAndTokenByAddress: vi.fn().mockImplementation((chainId: number, address: Hex) => ({
      chain: chainId === SOURCE_CHAIN_ID ? sourceChain : dstChain,
      token: address.toLowerCase() === TOKEN_ADDRESS.toLowerCase() ? token : nativeToken,
    })),
    getNativeToken: vi.fn().mockReturnValue(nativeToken),
    getChainByID: vi.fn().mockImplementation((chainId: number) => {
      if (chainId === SOURCE_CHAIN_ID) return sourceChain;
      return dstChain;
    }),
    getTokenByCurrencyId: vi.fn(),
  }) as unknown as ChainListType;

const makeUnifiedBalance = (input: {
  chainId: number;
  tokenAddress: Hex;
  rawBalance: string;
  value: string;
}): UnifiedBalanceResponseData => ({
  chain_id: encodeChainIdToBytes32(input.chainId),
  currencies: [
    {
      balance: input.rawBalance,
      token_address: parseHexToTokenBytes(input.tokenAddress),
      value: input.value,
    },
  ],
  total_usd: input.value,
  universe: Universe.ETHEREUM,
  errored: false,
});

const makeUserAsset = (input: {
  chain: Chain;
  tokenAddress: Hex;
  balance: string;
  value: number;
}) => ({
  balance: input.balance,
  value: input.value.toFixed(2),
  chainBalances: [
    {
      balance: input.balance,
      value: input.value.toFixed(2),
      chain: {
        id: input.chain.id,
        logo: input.chain.custom.icon,
        name: input.chain.name,
      },
      contractAddress: input.tokenAddress,
      decimals:
        input.tokenAddress.toLowerCase() === TOKEN_ADDRESS.toLowerCase()
          ? token.decimals
          : nativeToken.decimals,
      symbol: input.tokenAddress.toLowerCase() === TOKEN_ADDRESS.toLowerCase() ? token.symbol : 'ETH',
      universe: Universe.ETHEREUM,
    },
  ],
  decimals:
    input.tokenAddress.toLowerCase() === TOKEN_ADDRESS.toLowerCase()
      ? token.decimals
      : nativeToken.decimals,
  logo: input.tokenAddress.toLowerCase() === TOKEN_ADDRESS.toLowerCase() ? token.logo : '',
  name: input.tokenAddress.toLowerCase() === TOKEN_ADDRESS.toLowerCase() ? token.symbol : 'ETH',
  symbol: input.tokenAddress.toLowerCase() === TOKEN_ADDRESS.toLowerCase() ? token.symbol : 'ETH',
}) satisfies TokenBalance;

const sourceOnlyBalances: TokenBalance[] = [
  makeUserAsset({
    chain: sourceChain,
    tokenAddress: TOKEN_ADDRESS,
    balance: '10',
    value: 10,
  }),
];

const destinationRichBalances: TokenBalance[] = [
  makeUserAsset({
    chain: dstChain,
    tokenAddress: TOKEN_ADDRESS,
    balance: '10',
    value: 10,
  }),
  makeUserAsset({
    chain: dstChain,
    tokenAddress: NATIVE_ADDRESS,
    balance: '1',
    value: 2500,
  }),
];

const oraclePrices = [
  {
    universe: 'EVM' as const,
    chainId: DEST_CHAIN_ID,
    priceUsd: new Decimal(1),
    tokenAddress: TOKEN_ADDRESS,
    tokenSymbol: token.symbol,
    tokenDecimals: token.decimals,
    timestamp: 1,
  },
  {
    universe: 'EVM' as const,
    chainId: DEST_CHAIN_ID,
    priceUsd: new Decimal(2500),
    tokenAddress: NATIVE_ADDRESS,
    tokenSymbol: nativeToken.symbol,
    tokenDecimals: nativeToken.decimals,
    timestamp: 1,
  },
];

const makeMiddlewareClient = (
  balances: UnifiedBalanceResponseData[]
) =>
  makeBridgeAndExecuteMiddlewareClient({
    getBalances: vi.fn().mockResolvedValue(balances),
    getOraclePrices: vi.fn().mockResolvedValue(oraclePrices),
    simulateBundleV2: vi.fn().mockResolvedValue({ gas: [21_000n] }),
    submitRFF: vi.fn().mockResolvedValue({ request_hash: REQUEST_HASH }),
    getRFF: vi.fn().mockResolvedValue({
      request_hash: REQUEST_HASH,
      status: 'created',
      request: {
        sources: [],
        destination_universe: 'EVM',
        destination_chain_id: '0x',
        recipient_address: USER_ADDRESS,
        destinations: [],
        nonce: '0',
        expiry: '0',
        parties: [],
      },
      solver: null,
    }),
    getRFFStatus: vi.fn().mockResolvedValue({ status: 'created' }),
    getQuote: vi.fn().mockResolvedValue({
      fulfillmentBps: 0,
      sources: [
        {
          chainId: SOURCE_CHAIN_ID,
          tokenAddress: TOKEN_ADDRESS,
          depositFeeUsd: '0',
          depositFeeToken: '0',
        },
      ],
      destination: {
        chainId: DEST_CHAIN_ID,
        tokenAddress: TOKEN_ADDRESS,
        fulfillmentFeeUsd: '0',
        fulfillmentFeeToken: '0',
      },
    }),
  });

const makeEvmClient = () => {
  let currentChainId = DEST_CHAIN_ID;

  return {
    getAddresses: vi.fn().mockResolvedValue([USER_ADDRESS]),
    getChainId: vi.fn().mockImplementation(async () => currentChainId),
    switchChain: vi.fn().mockImplementation(async ({ id }: { id: number }) => {
      currentChainId = id;
    }),
    addChain: vi.fn().mockResolvedValue(undefined),
    signMessage: vi.fn().mockImplementation(async ({ message }: { message: string }) =>
      USER_ACCOUNT.signMessage({ message })
    ),
    sendTransaction: vi.fn().mockResolvedValue(EXECUTE_TX_HASH),
    writeContract: vi.fn().mockResolvedValue(
      '0x3333333333333333333333333333333333333333333333333333333333333333' as Hex
    ),
    request: vi.fn().mockResolvedValue('0x2329'),
  };
};

const makeRealBridgeAdapters = (
  chainList: ChainListType,
  evmClient: ReturnType<typeof makeEvmClient>,
  middlewareClient: ReturnType<typeof makeMiddlewareClient>
) => {
  const baseOptions = {
    evm: {
      address: USER_ADDRESS,
      client: evmClient as never,
      provider: {
        on() {
          return this;
        },
        removeListener() {
          return this;
        },
        async request() {
          return undefined;
        },
      },
    },
    hooks: {
      onAllowance: () => undefined,
      onIntent: () => undefined,
    },
    chainList,
    middlewareClient,
    intentExplorerUrl: 'https://bridge.example',
  } as const;

  const bridgeDeps: BridgeDeps = {
    chainList,
    middlewareClient,
    intentExplorerUrl: baseOptions.intentExplorerUrl,
    evm: {
      walletClient: evmClient as never,
      address: USER_ADDRESS,
    },
  };

  return {
    execute: (
      params: BridgeParams,
      options?: { onEvent?: (event: BridgeAndExecuteEvent) => void; hooks?: { onIntent?: any; onAllowance?: any } }
    ) =>
      executeBridgeWithDeps(
        {
          recipient: USER_ADDRESS,
          dstChain: chainList.getChainByID(params.toChainId),
          dstToken: chainList.getTokenInfoBySymbol(params.toChainId, params.toTokenSymbol),
          tokenAmount: params.toAmountRaw,
          nativeAmount: params.toNativeAmountRaw ?? 0n,
          sourceChains: params.sources ?? [],
        },
        bridgeDeps,
        {
          hooks: {
            onIntent: options?.hooks?.onIntent ?? baseOptions.hooks.onIntent,
            onAllowance: options?.hooks?.onAllowance ?? baseOptions.hooks.onAllowance,
          },
          emit: options?.onEvent as never,
        }
      ),
    simulate: (params: BridgeParams) =>
      simulateBridgeWithDeps(
        {
          recipient: USER_ADDRESS,
          dstChain: chainList.getChainByID(params.toChainId),
          dstToken: chainList.getTokenInfoBySymbol(params.toChainId, params.toTokenSymbol),
          tokenAmount: params.toAmountRaw,
          nativeAmount: params.toNativeAmountRaw ?? 0n,
          sourceChains: params.sources ?? [],
        },
        bridgeDeps
      ),
  };
};

const createBridgeAndExecuteQuery = (
  chainList: ChainListType,
  evmClient: ReturnType<typeof makeEvmClient>,
  _bridgeExecute: unknown,
  _bridgeSimulate: unknown,
  _getUnifiedBalances: () => Promise<TokenBalance[]>,
  middlewareClient: ReturnType<typeof makeMiddlewareClient>
) => {
  getBalancesForBridgeMock.mockImplementation(() => _getUnifiedBalances());
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

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.readContract.mockResolvedValue(maxUint256);
  hoisted.getFeeHistory.mockResolvedValue({
    baseFeePerGas: Array.from({ length: 21 }, () => 1n),
    reward: Array.from({ length: 20 }, () => [1n, 1n, 1n]),
    gasUsedRatio: [],
    oldestBlock: 1n,
  });
  hoisted.waitForTransactionReceipt.mockResolvedValue({
    status: 'success',
    transactionHash: EXECUTE_TX_HASH,
    blockNumber: 1n,
    effectiveGasPrice: 1n,
    gasUsed: 21_000n,
  });
  hoisted.estimateFeesPerGas.mockResolvedValue({
    maxFeePerGas: 1n,
    maxPriorityFeePerGas: 1n,
    gasPrice: 1n,
  });
  hoisted.watchContractEvent.mockImplementation(
    ({ onLogs }: { onLogs: (logs: Array<{ transactionHash?: Hex }>) => void }) => {
      const unwatch = vi.fn();
      queueMicrotask(() => {
        onLogs([{ transactionHash: EXECUTE_TX_HASH }]);
      });
      return unwatch;
    }
  );
});

describe('bridgeAndExecute pipeline characterization', () => {
  it('keeps the full bridge-required public flow real from composite preview through bridge and execute', async () => {
    const chainList = makeChainList();
    const middlewareClient = makeMiddlewareClient([
      makeUnifiedBalance({
        chainId: SOURCE_CHAIN_ID,
        tokenAddress: TOKEN_ADDRESS,
        rawBalance: '10000000',
        value: '10',
      }),
    ]);
    const evmClient = makeEvmClient();
    const bridge = makeRealBridgeAdapters(chainList, evmClient, middlewareClient);
    const query = createBridgeAndExecuteQuery(
      chainList,
      evmClient as never,
      bridge.execute as never,
      bridge.simulate as never,
      async () => sourceOnlyBalances,
      middlewareClient
    );

    const events: BridgeAndExecuteEvent[] = [];

    const result = await query.bridgeAndExecute(
      {
        toChainId: DEST_CHAIN_ID,
        toTokenSymbol: token.symbol,
        toAmountRaw: 1_000_000n,
        execute: {
          to: TARGET_CONTRACT,
          data: '0xdeadbeef' as Hex,
          gas: 21_000n,
        },
      },
      {
        onEvent: (event) => {
          events.push(event);
        },
      }
    );

    expect(result).toMatchObject({
      bridgeSkipped: false,
      execute: {
        txHash: EXECUTE_TX_HASH,
      },
      bridgeResult: expect.objectContaining({
        intentExplorerUrl: expect.stringContaining('https://bridge.example/rff/'),
      }),
    });
    expect(evmClient.signMessage).toHaveBeenCalledTimes(1);
    expect(evmClient.sendTransaction).toHaveBeenCalledTimes(1);
    expect(middlewareClient.submitRFF).toHaveBeenCalledTimes(1);
    expect(events).toEqual(
      expect.arrayContaining([
        { type: 'status', status: 'preparing' },
        { type: 'status', status: 'intent_building' },
        { type: 'status', status: 'intent_ready' },
        expect.objectContaining({
          type: 'plan_preview',
          plan: expect.objectContaining({
            bridgeRequired: true,
            steps: expect.arrayContaining([
              expect.objectContaining({ type: 'request_signing' }),
              expect.objectContaining({ type: 'request_submission' }),
              expect.objectContaining({ type: 'vault_deposit' }),
              expect.objectContaining({ type: 'bridge_fill' }),
              expect.objectContaining({ type: 'execute_transaction' }),
            ]),
          }),
        }),
        expect.objectContaining({
          type: 'plan_confirmed',
          plan: expect.objectContaining({
            bridgeRequired: true,
          }),
        }),
        expect.objectContaining({
          type: 'plan_progress',
          stepType: 'request_signing',
          state: 'completed',
        }),
        expect.objectContaining({
          type: 'plan_progress',
          stepType: 'request_submission',
          state: 'completed',
        }),
        expect.objectContaining({
          type: 'plan_progress',
          stepType: 'vault_deposit',
          state: 'completed',
        }),
        expect.objectContaining({
          type: 'plan_progress',
          stepType: 'bridge_fill',
          state: 'completed',
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

  it('keeps the execute-only public flow real and skips all bridge side effects when destination balances are sufficient', async () => {
    const chainList = makeChainList();
    const middlewareClient = makeMiddlewareClient([]);
    const evmClient = makeEvmClient();
    const bridge = makeRealBridgeAdapters(chainList, evmClient, middlewareClient);
    const query = createBridgeAndExecuteQuery(
      chainList,
      evmClient as never,
      bridge.execute as never,
      bridge.simulate as never,
      async () => destinationRichBalances,
      middlewareClient
    );

    const events: BridgeAndExecuteEvent[] = [];

    const result = await query.bridgeAndExecute(
      {
        toChainId: DEST_CHAIN_ID,
        toTokenSymbol: token.symbol,
        toAmountRaw: 1_000_000n,
        execute: {
          to: TARGET_CONTRACT,
          data: '0xdeadbeef' as Hex,
          gas: 21_000n,
        },
      },
      {
        onEvent: (event) => {
          events.push(event);
        },
      }
    );

    expect(result).toMatchObject({
      bridgeSkipped: true,
      bridgeResult: undefined,
      execute: {
        txHash: EXECUTE_TX_HASH,
      },
    });
    expect(evmClient.signMessage).not.toHaveBeenCalled();
    expect(middlewareClient.submitRFF).not.toHaveBeenCalled();
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'plan_preview',
          plan: expect.objectContaining({
            bridgeRequired: false,
            steps: expect.arrayContaining([
              expect.objectContaining({ type: 'execute_transaction' }),
            ]),
          }),
        }),
        expect.objectContaining({
          type: 'plan_confirmed',
          plan: expect.objectContaining({
            bridgeRequired: false,
          }),
        }),
        expect.objectContaining({
          type: 'plan_progress',
          stepType: 'execute_transaction',
          state: 'confirmed',
        }),
      ])
    );
  });
});
