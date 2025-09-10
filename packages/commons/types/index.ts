import { SUPPORTED_CHAINS } from '../constants';
import { ChainDatum, Environment, PermitVariant, Universe } from '@arcana/ca-common';
import { DirectSecp256k1Wallet } from '@cosmjs/proto-signing';
import Decimal from 'decimal.js';
import { FuelConnector, Provider, TransactionRequestLike } from 'fuels';
import { Abi, TransactionReceipt, ByteArray, Hex, WalletClient } from 'viem';
import * as ServiceTypes from './service-types';

type NexusNetwork = 'mainnet' | 'testnet';

export interface BlockTransaction {
  hash?: string;
  from?: string;
}

export interface Block {
  transactions?: BlockTransaction[];
}

// Enhanced chain metadata with comprehensive information
export interface ChainMetadata {
  id: number;
  name: string;
  shortName: string;
  logo: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  rpcUrls: string[];
  blockExplorerUrls: string[];
}

// Enhanced token metadata with comprehensive information
export interface TokenMetadata {
  symbol: string;
  name: string;
  decimals: number;
  icon: string;
  coingeckoId: string;
  isNative?: boolean;
}

type OnIntentHookData = {
  intent: Intent;
  allow: () => void;
  deny: () => void;
  refresh: () => Promise<Intent>;
};

type OnAllowanceHookData = {
  allow: (s: Array<'min' | 'max' | bigint | string>) => void;
  deny: () => void;
  sources: Array<onAllowanceHookSource>;
};

/**
 * Generic event listener type for CA SDK events
 */
export type EventListener = (...args: unknown[]) => void;

/**
 * Parameters for checking or setting token allowance.
 */
export interface AllowanceParams {
  tokens: string[];
  amount: number;
  chainId: (typeof SUPPORTED_CHAINS)[keyof typeof SUPPORTED_CHAINS];
}

/**
 * Response structure for token allowance.
 */
export interface AllowanceResponse {
  chainID: number;
  allowance: bigint;
  token: string;
}

export type SUPPORTED_TOKENS = 'ETH' | 'USDC' | 'USDT';
export type SUPPORTED_CHAINS_IDS = (typeof SUPPORTED_CHAINS)[keyof typeof SUPPORTED_CHAINS];

/**
 * Dynamic parameter builder function for building function parameters at execution time
 * This allows for dynamic parameter generation based on actual bridged amounts and user context
 */
export type DynamicParamBuilder = (
  token: SUPPORTED_TOKENS,
  amount: string,
  chainId: SUPPORTED_CHAINS_IDS,
  userAddress: `0x${string}`,
) => {
  functionParams: readonly unknown[];
  /** ETH value in wei (string). Omit or '0' for ERC-20 calls */
  value?: string;
};

/**
 * Parameters for bridging tokens between chains.
 */
export interface BridgeParams {
  token: SUPPORTED_TOKENS;
  amount: number | string;
  chainId: SUPPORTED_CHAINS_IDS;
  gas?: bigint;
}

/**
 * Result structure for bridge transactions.
 */
export interface BridgeResult {
  success: boolean;
  error?: string;
  explorerUrl?: string;
  transactionHash?: string; // Add transaction hash property
}

/**
 * Result structure for swap transactions.
 */
export interface SwapResult {
  success: boolean;
  error?: string;
  explorerUrl?: string;
  transactionHash?: string; // Add transaction hash property
}

/**
 * Result structure for transfer transactions.
 */
export interface TransferResult {
  success: boolean;
  error?: string;
  explorerUrl?: string;
}

export interface SimulationResult {
  intent: ReadableIntent;
  token: TokenInfo;
}

/**
 * Parameters for transferring tokens.
 */
export interface TransferParams {
  token: SUPPORTED_TOKENS;
  amount: number | string;
  chainId: SUPPORTED_CHAINS_IDS;
  recipient: `0x${string}`;
}

/**
 * Enhanced token balance information
 */
export interface TokenBalance {
  symbol: string;
  balance: string;
  formattedBalance: string;
  balanceInFiat?: number;
  chainId: number;
  contractAddress?: `0x${string}`;
  isNative?: boolean;
}

// Enhanced modular parameters for execute functionality with dynamic parameter building
export interface ExecuteParams {
  toChainId: SUPPORTED_CHAINS_IDS;
  contractAddress: string;
  contractAbi: Abi;
  functionName: string;
  buildFunctionParams: DynamicParamBuilder;
  value?: string; // Can be overridden by callback
  enableTransactionPolling?: boolean;
  transactionTimeout?: number;
  // Transaction receipt confirmation options
  waitForReceipt?: boolean;
  receiptTimeout?: number;
  requiredConfirmations?: number;
  tokenApproval?: {
    token: SUPPORTED_TOKENS;
    amount: string;
  };
  /**
   * Optional approval buffer in basis points (bps). Defaults to 100 (1%).
   * Use 0 to disable buffer (e.g., for bridge+execute flows where exact balances are used).
   */
  approvalBufferBps?: number;
}

export interface ExecuteResult {
  transactionHash: string;
  explorerUrl: string;
  chainId: number;
  // Receipt information
  receipt?: TransactionReceipt;
  confirmations?: number;
  gasUsed?: string;
  effectiveGasPrice?: string;
  approvalTransactionHash?: string;
}

export interface ExecuteSimulation {
  contractAddress: string;
  functionName: string;
  gasUsed: string;
  success: boolean;
  error?: string;
  gasCostEth?: string;
}

// New types for improved approval simulation
export interface ApprovalInfo {
  needsApproval: boolean;
  currentAllowance: bigint;
  requiredAmount: bigint;
  tokenAddress?: string;
  spenderAddress: string;
  token: SUPPORTED_TOKENS;
  chainId: number;
  hasPendingApproval?: boolean;
}

export interface ApprovalSimulation {
  gasUsed: string;
  gasPrice: string;
  totalFee: string;
  success: boolean;
  error?: string;
}

export interface SimulationStep {
  type: 'bridge' | 'approval' | 'execute';
  required: boolean;
  simulation: SimulationResult | ApprovalSimulation | ExecuteSimulation;
  description: string;
}

interface SimulationMetadata {
  contractAddress: string;
  functionName: string;
  bridgeReceiveAmount: string;
  bridgeFee: string;
  inputAmount: string;
  optimalBridgeAmount?: string;
  targetChain: number;
  approvalRequired: boolean;
  bridgeSkipped?: boolean;
  token?: SUPPORTED_TOKENS;
}

export interface BridgeAndExecuteSimulationResult {
  steps: SimulationStep[];
  bridgeSimulation: SimulationResult | null;
  executeSimulation?: ExecuteSimulation;
  totalEstimatedCost?: {
    total: string;
    breakdown: {
      bridge: string;
      execute: string;
    };
  };
  success: boolean;
  error?: string;
  metadata?: SimulationMetadata;
}

export interface BridgeAndExecuteParams {
  toChainId: SUPPORTED_CHAINS_IDS;
  token: SUPPORTED_TOKENS;
  amount: number | string;
  recipient?: `0x${string}`;
  execute?: Omit<ExecuteParams, 'toChainId'>;
  enableTransactionPolling?: boolean;
  transactionTimeout?: number;
  // Global options for transaction confirmation
  waitForReceipt?: boolean;
  receiptTimeout?: number;
  requiredConfirmations?: number;
  // Optional recent approval transaction hash to consider in simulation
  recentApprovalTxHash?: string;
}

export interface BridgeAndExecuteResult {
  executeTransactionHash?: string;
  executeExplorerUrl?: string;
  approvalTransactionHash?: string;
  bridgeTransactionHash?: string; // undefined when bridge is skipped
  bridgeExplorerUrl?: string; // undefined when bridge is skipped
  toChainId: number;
  success: boolean;
  error?: string;
  bridgeSkipped: boolean; // indicates if bridge was skipped due to sufficient funds
}

/**
 * Smart contract call parameters
 */
export interface ContractCallParams {
  to: `0x${string}`;
  data: `0x${string}`;
  value?: bigint;
  gas?: bigint;
  gasPrice?: bigint;
}

export type AddChainParams = {
  blockExplorerUrls?: string[];
  chainId: string;
  chainName: string;
  iconUrls?: string[];
  nativeCurrency: {
    decimals: number;
    name: string;
    symbol: string;
  };
  rpcUrls: string[];
};

export type AllowanceHookSources = onAllowanceHookSource[];

export type AssetBalanceResponse = {
  balance: string;
  chain_id: number;
  token_address: Uint8Array;
  value: string;
  // total_usd: string;
};

export type BridgeInput = {
  amount: number;
  symbol: string;
};

export type BridgeQueryInput = {
  amount: number | string;
  chainID: number;
  gas?: bigint;
  sourceChains?: number[];
  token: string;
};

export interface CA {
  createEVMHandler(
    tx: EVMTransaction,
    options: Partial<TxOptions>,
  ): Promise<CreateHandlerResponse | null>;

  createFuelHandler(
    tx: TransactionRequestLike,
    options: Partial<TxOptions>,
  ): Promise<CreateHandlerResponse | null>;

  getChainID(): Promise<number>;

  init(): Promise<void>;

  switchChain(chainID: number): Promise<void>;
}

export type Chain = {
  blockExplorers?: {
    default: {
      name: string;
      url: string;
    };
  };
  custom: {
    icon: string;
    knownTokens: TokenInfo[];
  };
  id: number;
  name: string;
  nativeCurrency: {
    decimals: number;
    name: string;
    symbol: string;
  };
  rpcUrls: {
    default: {
      http: string[];
      publicHttp?: string[];
      webSocket: string[];
    };
  };
  universe: Universe;
};

export interface CreateHandlerResponse {
  handler: IRequestHandler | null;
  processTx: () => Promise<unknown>;
}

interface EthereumProvider {
  on(eventName: string | symbol, listener: (...args: any[]) => void): this;

  removeListener(
    eventName: string | symbol,
    /* eslint-disable @typescript-eslint/no-explicit-any */
    listener: (...args: any[]) => void,
  ): this;

  request(args: RequestArguments): Promise<unknown>;
}

export type EVMTransaction = {
  data?: `0x${string}`;
  from: `0x${string}`;
  to: `0x${string}`;
  value?: `0x${string}`;
};
export type FeeStoreData = {
  fee: {
    collection: {
      chainID: number;
      fee: number;
      tokenAddress: string;
      universe: Universe;
    }[];
    fulfilment: {
      chainID: number;
      fee: number;
      tokenAddress: string;
      universe: Universe;
    }[];
    protocol: {
      feeBP: string;
    };
  };
  solverRoutes: {
    destinationChainID: number;
    destinationTokenAddress: string;
    destinationUniverse: Universe;
    feeBP: number;
    sourceChainID: number;
    sourceTokenAddress: string;
    sourceUniverse: Universe;
  }[];
};

export type FeeUniverse = 'ETHEREUM' | 'FUEL';

type Intent = {
  allSources: IntentSource[];
  destination: IntentDestination;
  fees: {
    caGas: string;
    collection: string;
    fulfilment: string;
    gasSupplied: string;
    protocol: string;
    solver: string;
  };
  isAvailableBalanceInsufficient: boolean;
  sources: IntentSource[];
};
export type IntentDestination = {
  amount: Decimal;
  chainID: number;
  decimals: number;
  gas: bigint;
  tokenContract: `0x${string}`;
  universe: Universe;
};

export type IntentSource = {
  amount: Decimal;
  chainID: number;
  tokenContract: `0x${string}`;
  universe: Universe;
};

export type IntentSourceForAllowance = {
  chainID: number;
  currentAllowance: bigint;
  requiredAllowance: bigint;
  token: TokenInfo;
};

export interface IRequestHandler {
  buildIntent(sourceChains: number[]): Promise<
    | {
        intent: Intent;
        token: TokenInfo;
      }
    | undefined
  >;
  process(): Promise<unknown>;
}

type Network = Extract<Environment, Environment.CERISE | Environment.CORAL | Environment.FOLLY>;

export type NetworkConfig = {
  COSMOS_URL: string;
  EXPLORER_URL: string;
  FAUCET_URL: string;
  GRPC_URL: string;
  NETWORK_HINT: Environment;
  SIMULATION_URL: string;
  VSC_DOMAIN: string;
};

type OnAllowanceHook = (data: {
  allow: (s: Array<'max' | 'min' | bigint | string>) => void;
  deny: () => void;
  sources: AllowanceHookSources;
}) => void;

export type onAllowanceHookSource = {
  allowance: {
    current: string;
    minimum: string;
  };
  chain: {
    id: number;
    logo: string;
    name: string;
  };
  token: {
    contractAddress: `0x${string}`;
    decimals: number;
    logo: string;
    name: string;
    symbol: string;
  };
};

type OnIntentHook = (data: {
  allow: () => void;
  deny: () => void;
  intent: ReadableIntent;
  refresh: (selectedSources: number[]) => Promise<ReadableIntent>;
}) => void;

export type OraclePriceResponse = {
  chainId: number;
  priceUsd: Decimal;
  tokenAddress: `0x${string}`;
  tokensPerUsd: Decimal;
}[];

type ReadableIntent = {
  allSources: {
    amount: string;
    chainID: number;
    chainLogo: string | undefined;
    chainName: string;
    contractAddress: `0x${string}`;
  }[];
  destination: {
    amount: string;
    chainID: number;
    chainLogo: string | undefined;
    chainName: string;
  };
  fees: {
    caGas: string;
    gasSupplied: string;
    protocol: string;
    solver: string;
    total: string;
  };
  sources: {
    amount: string;
    chainID: number;
    chainLogo: string | undefined;
    chainName: string;
    contractAddress: `0x${string}`;
  }[];
  sourcesTotal: string;
  token: {
    decimals: number;
    logo: string | undefined;
    name: string;
    symbol: string;
  };
};

type RequestArguments = {
  readonly method: string;
  readonly params?: object | readonly unknown[];
};

export type RequestHandler = new (i: RequestHandlerInput) => IRequestHandler;

export type ChainListType = {
  chains: Chain[];
  getVaultContractAddress(chainID: number): `0x${string}`;
  getTokenInfoBySymbol(chainID: number, symbol: string): TokenInfo | undefined;
  getTokenByAddress(chainID: number, address: `0x${string}`): TokenInfo | undefined;
  getNativeToken(chainID: number): TokenInfo;
  getChainByID(id: number): Chain | undefined;
};

export type RequestHandlerInput = {
  chain: Chain;
  chainList: ChainListType;
  cosmosWallet: DirectSecp256k1Wallet;
  evm: {
    address: `0x${string}`;
    client: WalletClient;
    tx?: EVMTransaction;
  };
  fuel?: {
    address: string;
    connector: FuelConnector;
    provider: Provider;
    tx?: TransactionRequestLike;
  };
  hooks: {
    onAllowance: OnAllowanceHook;
    onIntent: OnIntentHook;
  };
  options: {
    emit: (eventName: string, ...args: any[]) => void;
    networkConfig: NetworkConfig;
  } & TxOptions;
};

export type RequestHandlerResponse = {
  buildIntent(): Promise<
    | {
        intent: Intent;
        token: TokenInfo;
      }
    | undefined
  >;
  input: RequestHandlerInput;
  process(): Promise<unknown>;
} | null;

export type RFF = {
  deposited: boolean;
  destinationChainID: number;
  destinations: { tokenAddress: Hex; value: bigint }[];
  destinationUniverse: string;
  expiry: number;
  fulfilled: boolean;
  id: number;
  refunded: boolean;
  sources: {
    chainID: number;
    tokenAddress: Hex;
    universe: string;
    value: bigint;
  }[];
};

type SDKConfig = {
  debug?: boolean;
  network?: Network | NetworkConfig;
};

type SetAllowanceInput = {
  amount: bigint;
  chainID: number;
  tokenContract: `0x${string}`;
};

export type SimulateReturnType = {
  amount: Decimal;
  gas: bigint;
  gasFee: Decimal;
  token: {
    contractAddress: `0x${string}`;
    decimals: number;
    name: string;
    symbol: string;
  };
};

export type SimulationResultData = {
  amount: number;
  gasBreakdown: {
    feeData: {
      maxFeePerGas: string;
      maxPriorityFeePerGas: string;
    };
    limit: string;
  };
  gasUsed: string;
  tokenContract: `0x${string}`;
};
export type SponsoredApprovalData = {
  address: ByteArray;
  chain_id: ChainDatum['ChainID32'];
  operations: {
    sig_r: ByteArray;
    sig_s: ByteArray;
    sig_v: number;
    token_address: ByteArray;
    value: ByteArray;
    variant: PermitVariant;
  }[];
  universe: Universe;
};

export type SponsoredApprovalDataArray = SponsoredApprovalData[];

export type Step = {
  data?:
    | {
        amount: string;
        chainName: string;
        symbol: string;
      }
    | {
        chainID: number;
        chainName: string;
      }
    | { confirmed: number; total: number }
    | { explorerURL: string; intentID: number };
} & StepInfo;

export type StepInfo = {
  type: string;
  typeID: string;
};

export type Steps = Step[];

export type Token = {
  contractAddress: `0x${string}`;
  decimals: number;
  name: string;
  symbol: string;
};

type TokenInfo = {
  contractAddress: `0x${string}`;
  decimals: number;
  logo?: string;
  name: string;
  symbol: string;
};

export type TransferQueryInput = {
  to: Hex;
} & Omit<BridgeQueryInput, 'gas'>;

export type TxOptions = {
  bridge: boolean;
  gas: bigint;
  skipTx: boolean;
  sourceChains: number[];
};

export type UnifiedBalanceResponseData = {
  chain_id: Uint8Array;
  currencies: {
    balance: string;
    token_address: Uint8Array;
    value: string;
  }[];
  total_usd: string;
  universe: Universe;
};

export type UserAssetDatum = {
  abstracted?: boolean;
  balance: string;
  balanceInFiat: number;
  breakdown: {
    balance: string;
    balanceInFiat: number;
    chain: {
      id: number;
      logo: string;
      name: string;
    };
    contractAddress: `0x${string}`;
    decimals: number;
    isNative?: boolean;
    priceUSD?: string;
    universe: Universe;
  }[];
  decimals: number;
  icon?: string;
  priceInUsd?: string;
  symbol: string;
};

export type {
  ServiceTypes,
  OnIntentHook,
  OnAllowanceHookData,
  OnIntentHookData,
  OnAllowanceHook,
  EthereumProvider,
  RequestArguments,
  Step as ProgressStep,
  Steps as ProgressSteps,
  Intent,
  ReadableIntent,
  onAllowanceHookSource as AllowanceHookSource,
  Network,
  TokenInfo,
  RFF as RequestForFunds,
  SDKConfig,
  NexusNetwork,
  TransactionReceipt,
  SetAllowanceInput,
};
