import { maxUint256, type Hex, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { vi } from 'vitest';
import type { BridgeEvent, BridgeResult } from '../../src';
import type { DeploymentResponse } from '../../src/domain';
import type { OnAllowanceHook, OnIntentHook } from '../../src/domain';
import { executeBridge } from '../../src/flows/bridge';
import { createChainList } from '../../src/services/chain-list';
import type { MiddlewareClient } from '../../src/transport';
import { testDeployment } from '../fixtures/deployment';
import { makeOraclePrice, makeUnifiedBalance } from './balances';
import { makeMiddlewareClient } from './middleware-client';
import {
  makeDeterministicPublicClient,
  type DeterministicPublicClientOptions,
} from './public-client';

const DESTINATION_CHAIN_ID = 1;
const PRIMARY_SOURCE_CHAIN_ID = 11155111;
const ALTERNATE_SOURCE_CHAIN_ID = 8453;
const ALTERNATE_SOURCE_TOKEN = '0x0000000000000000000000000000000000000006' as Hex;
const ALTERNATE_VAULT = '0x0000000000000000000000000000000000000007' as Hex;
const COLLECTION_TX_HASH =
  '0x1111111111111111111111111111111111111111111111111111111111111111' as Hex;
const USER_PRIVATE_KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4e7b5d3b9c2a5' as const;
const USER_ACCOUNT = privateKeyToAccount(USER_PRIVATE_KEY);

const makeBridgeDeployment = (): DeploymentResponse => {
  const destination = testDeployment.chains.find(
    (chain) => chain.chainId === DESTINATION_CHAIN_ID
  );
  const primarySource = testDeployment.chains.find(
    (chain) => chain.chainId === PRIMARY_SOURCE_CHAIN_ID
  );
  const primaryToken = primarySource?.tokens.find((token) => token.symbol === 'USDC');
  if (!destination || !primarySource || !primaryToken) {
    throw new Error('Bridge characterization deployment is incomplete');
  }

  return {
    ...testDeployment,
    chains: [
      destination,
      primarySource,
      {
        ...primarySource,
        chainId: ALTERNATE_SOURCE_CHAIN_ID,
        name: 'BASE',
        rpcUrl: 'https://example.com/base',
        vaultAddress: ALTERNATE_VAULT,
        multicallAddress: '0x00000000000000000000000000000000000000cc',
        explorerUrl: 'https://basescan.org',
        logo: 'https://example.com/base/logo.png',
        tokens: [
          {
            ...primaryToken,
            address: ALTERNATE_SOURCE_TOKEN,
          },
        ],
      },
    ],
  };
};

type BridgeCharacterizationSource = {
  chainId: number;
  tokenAddress: `0x${string}`;
};

type BridgeCharacterizationHarness = {
  address: `0x${string}`;
  events: BridgeEvent[];
  middlewareClient: MiddlewareClient;
  publicClient: ReturnType<typeof makeDeterministicPublicClient>;
  signedMessages: string[];
  sources: {
    primary: BridgeCharacterizationSource;
    alternate: BridgeCharacterizationSource;
  };
  run: (options?: {
    sourceChains?: number[];
    fillTimeoutMinutes?: number;
    onAllowance?: OnAllowanceHook;
    onIntent?: OnIntentHook;
  }) => Promise<BridgeResult>;
};

export const makeBridgeCharacterizationHarness = (_options?: {
  allowanceRaw?: bigint;
  asset?: 'erc20' | 'native';
  fillStatus?: 'created' | 'fulfilled';
}): BridgeCharacterizationHarness => {
  const options = _options ?? {};
  const asset = options.asset ?? 'erc20';
  const chainList = createChainList(makeBridgeDeployment());
  const destinationChain = chainList.getChainByID(DESTINATION_CHAIN_ID);
  const primarySourceChain = chainList.getChainByID(PRIMARY_SOURCE_CHAIN_ID);
  const alternateSourceChain = chainList.getChainByID(ALTERNATE_SOURCE_CHAIN_ID);
  const nativeToken = chainList.getNativeToken(DESTINATION_CHAIN_ID);
  const destinationToken =
    asset === 'native'
      ? nativeToken
      : chainList.getTokenInfoBySymbol(DESTINATION_CHAIN_ID, 'USDC');
  const primarySourceToken =
    asset === 'native'
      ? chainList.getNativeToken(PRIMARY_SOURCE_CHAIN_ID)
      : chainList.getTokenInfoBySymbol(PRIMARY_SOURCE_CHAIN_ID, 'USDC');
  const alternateSourceToken =
    asset === 'native'
      ? chainList.getNativeToken(ALTERNATE_SOURCE_CHAIN_ID)
      : chainList.getTokenInfoBySymbol(ALTERNATE_SOURCE_CHAIN_ID, 'USDC');
  const rawBalanceMultiplier = asset === 'native' ? 1_000_000_000_000_000_000n : 1_000_000n;
  const events: BridgeEvent[] = [];
  const signedMessages: string[] = [];
  let currentChainId = DESTINATION_CHAIN_ID;

  const publicClientOptions: DeterministicPublicClientOptions = {
    readContract: ({ functionName }) => {
      if (functionName === 'allowance') {
        return options.allowanceRaw ?? maxUint256;
      }
      return 0n;
    },
    watchContractEvent: (request) => {
      if (request.eventName === 'Deposit') {
        queueMicrotask(() => {
          void request.onLogs([{ transactionHash: COLLECTION_TX_HASH }]);
        });
      }
    },
  };
  const publicClient = makeDeterministicPublicClient(publicClientOptions);

  const walletClient = {
    account: USER_ACCOUNT,
    getChainId: vi.fn().mockImplementation(async () => currentChainId),
    switchChain: vi.fn().mockImplementation(async ({ id }: { id: number }) => {
      currentChainId = id;
    }),
    addChain: vi.fn().mockResolvedValue(undefined),
    signMessage: vi.fn().mockImplementation(async ({ message }: { message: string }) => {
      signedMessages.push(message);
      return USER_ACCOUNT.signMessage({ message });
    }),
    writeContract: vi.fn().mockResolvedValue(COLLECTION_TX_HASH),
  } as unknown as WalletClient;

  const middlewareClient = makeMiddlewareClient({
    createApprovals: vi.fn().mockResolvedValue([]),
    getBalances: vi.fn().mockResolvedValue([
      makeUnifiedBalance({
        chainId: primarySourceChain.id,
        tokenAddress: primarySourceToken.contractAddress,
        rawBalance: (10n * rawBalanceMultiplier).toString(),
        value: '10',
        symbol: primarySourceToken.symbol,
      }),
      makeUnifiedBalance({
        chainId: alternateSourceChain.id,
        tokenAddress: alternateSourceToken.contractAddress,
        rawBalance: (20n * rawBalanceMultiplier).toString(),
        value: '20',
        symbol: alternateSourceToken.symbol,
      }),
    ]),
    getOraclePrices: vi.fn().mockResolvedValue(
      asset === 'native'
        ? [
            makeOraclePrice({
              chainId: destinationChain.id,
              tokenAddress: nativeToken.contractAddress,
              symbol: nativeToken.symbol,
              decimals: nativeToken.decimals,
              priceUsd: 2500,
            }),
          ]
        : [
            makeOraclePrice({
              chainId: destinationChain.id,
              tokenAddress: destinationToken.contractAddress,
              symbol: destinationToken.symbol,
              decimals: destinationToken.decimals,
              priceUsd: 1,
            }),
            makeOraclePrice({
              chainId: destinationChain.id,
              tokenAddress: nativeToken.contractAddress,
              symbol: nativeToken.symbol,
              decimals: nativeToken.decimals,
              priceUsd: 2500,
            }),
          ]
    ),
    getBridgeProvider: vi.fn().mockResolvedValue({ provider: 'nexus' }),
    getQuote: vi.fn().mockResolvedValue({
      fulfillmentBps: 0,
      sources: [
        {
          chainId: primarySourceChain.id,
          tokenAddress: primarySourceToken.contractAddress,
          depositFeeUsd: '0',
          depositFeeToken: '0',
        },
        {
          chainId: alternateSourceChain.id,
          tokenAddress: alternateSourceToken.contractAddress,
          depositFeeUsd: '0',
          depositFeeToken: '0',
        },
      ],
      destination: {
        chainId: destinationChain.id,
        tokenAddress: destinationToken.contractAddress,
        fulfillmentFeeUsd: '0',
        fulfillmentFeeToken: '0',
      },
    }),
    submitRFF: vi.fn().mockImplementation(async () => {
      const signedMessage = signedMessages.at(-1);
      if (!signedMessage) {
        throw new Error('RFF submitted before signing');
      }
      return {
        request_hash: signedMessage.slice(-66) as Hex,
      };
    }),
    getRFFStatus: vi
      .fn()
      .mockResolvedValue({ status: options.fillStatus ?? ('fulfilled' as const) }),
  });

  const run: BridgeCharacterizationHarness['run'] = async (runOptions = {}) => {
    events.splice(0);
    const sourceChains =
      'sourceChains' in runOptions
        ? (runOptions.sourceChains ?? [])
        : [primarySourceChain.id];

    return executeBridge(
      {
        recipient: USER_ACCOUNT.address,
        dstChain: destinationChain,
        dstToken: destinationToken,
        tokenAmount: asset === 'native' ? 1_000_000_000_000_000_000n : 1_000_000n,
        nativeAmount: 0n,
        sourceChains,
      },
      {
        chainList,
        timing: undefined,
        intentExplorerUrl: 'https://explorer.example/intents',
        middlewareClient,
        forceMayan: false,
        evm: {
          walletClient,
          address: USER_ACCOUNT.address,
        },
      },
      {
        hooks: {
          onIntent: runOptions.onIntent ?? (({ allow }) => allow()),
          onAllowance:
            runOptions.onAllowance ??
            (({ allow, sources }) => allow(sources.map(() => 'min'))),
        },
        emit: (event) => {
          events.push(event);
        },
        fillTimeoutMinutes: runOptions.fillTimeoutMinutes,
      }
    );
  };

  return {
    address: USER_ACCOUNT.address,
    events,
    middlewareClient,
    publicClient,
    signedMessages,
    sources: {
      primary: {
        chainId: primarySourceChain.id,
        tokenAddress: primarySourceToken.contractAddress,
      },
      alternate: {
        chainId: alternateSourceChain.id,
        tokenAddress: alternateSourceToken.contractAddress,
      },
    },
    run,
  };
};
