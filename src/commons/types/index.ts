import type {
  ChainDatum,
  Environment,
  PermitVariant,
  QueryAllSolverDataResponse,
  QueryGetProtocolFeesResponse,
  RequestForFunds,
  Universe,
} from '@avail-project/ca-common';
import type { SigningStargateClient } from '@cosmjs/stargate';
import type { AdapterProps } from '@tronweb3/tronwallet-abstract-adapter';
import type Decimal from 'decimal.js';
import type Long from 'long';
import type { ByteArray, Hex, TransactionReceipt, WalletClient } from 'viem';
import type { SUPPORTED_CHAINS } from '../constants';
import type { FormatTokenBalanceOptions, FormattedParts } from '../utils/format';
import type { BridgeStepType } from './bridge-steps';
import type { SwapStepType } from './swap-steps';
import type { SBCTx, Source, SuccessfulSwapResult, SwapIntent } from './swap-types';

type TokenInfo = {
  contractAddress: `0x${string}`;
  decimals: number;
  logo: string;
  name: string;
  symbol: string;
};

type NexusNetwork = 'mainnet' | 'testnet' | NetworkConfig;

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
  token: string,
  amount: string,
  chainId: number,
  userAddress: `0x${string}`
) => {
  functionParams: readonly unknown[];
  /** ETH value in wei (string). Omit or '0' for ERC-20 calls */
  value?: string;
};

/**
 * Parameters for bridging tokens between chains.
 */
export interface BridgeParams {
  recipient?: Hex;
  token: string;
  amount: bigint;
  toChainId: number;
  gas?: bigint;
  sourceChains?: number[];
}

export type BridgeMaxResult = {
  amountRaw: bigint;
  amount: string;
  symbol: string;
  sourceChainIds: number[];
};

export type SourceTxs = {
  chain: {
    id: number;
    name: string;
    logo: string;
  };
  hash: Hex;
  explorerUrl: string;
}[];

/**
 * Result structure for bridge transactions.
 */
export type BridgeResult = {
  explorerUrl: string;
  sourceTxs: SourceTxs;
  intent: ReadableIntent;
};

/**
 * Result structure for transfer transactions.
 */
export type TransferResult = {
  transactionHash: string;
  explorerUrl: string;
};

export interface SimulationResult {
  intent: ReadableIntent;
  token: TokenInfo;
}

export type TronAdapter = AdapterProps & {
  isMobile?: boolean;
};

/**
 * Parameters for transferring tokens.
 */
export interface TransferParams {
  token: string;
  amount: bigint;
  toChainId: number;
  recipient: `0x${string}`;
  sourceChains?: number[];
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

type GasPriceSelector = 'low' | 'medium' | 'high' | 'ultraHigh';

export interface SwapExecuteParams {
  to: Hex;
  value?: bigint;
  data?: Hex;
  gas: bigint;
  gasPrice?: GasPriceSelector;
  tokenApproval?: {
    token: Hex;
    amount: bigint;
    spender: Hex;
  };
}

export interface ExecuteParams {
  toChainId: number;
  to: Hex;
  value?: bigint;
  data?: Hex;
  gas?: bigint;
  gasPrice?: bigint;
  enableTransactionPolling?: boolean;
  transactionTimeout?: number;
  // Transaction receipt confirmation options
  waitForReceipt?: boolean;
  receiptTimeout?: number;
  requiredConfirmations?: number;
  tokenApproval?: {
    token: string;
    amount: bigint;
    spender: Hex;
  };
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

export type ExecuteSimulation = {
  gasUsed: bigint;
  gasPrice: bigint;
  /**
   * gasFee = gasUsed * gasPrice
   */
  gasFee: bigint;
};

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

export type EventListenerType = {
  onEvent: (eventName: string, ...args: unknown[]) => void;
};

export type BridgeAndExecuteSimulationResult = {
  bridgeSimulation: SimulationResult | null;
  executeSimulation: ExecuteSimulation;
};

export interface BridgeAndExecuteParams {
  toChainId: number;
  token: string;
  amount: bigint;
  sourceChains?: number[];
  execute: Omit<ExecuteParams, 'toChainId'>;
  enableTransactionPolling?: boolean;
  transactionTimeout?: number;
  waitForReceipt?: boolean;
  receiptTimeout?: number;
  requiredConfirmations?: number;
  recentApprovalTxHash?: string;
}

export interface SwapAndExecuteParams {
  toChainId: number;
  toTokenAddress: Hex;
  toAmount: bigint;
  fromSources?: Source[];
  execute: SwapExecuteParams;
}

export type CosmosOptions = {
  address: string;
  client: SigningStargateClient;
};

export type IBridgeOptions = {
  cosmos: CosmosOptions;
  evm: {
    address: `0x${string}`;
    client: WalletClient;
    provider: EthereumProvider;
  };
  tron?: {
    address: string;
    adapter: TronAdapter;
  };
  hooks: {
    onAllowance: OnAllowanceHook;
    onIntent: OnIntentHook;
  };
  emit?: OnEventParam['onEvent'];
  intentExplorerUrl: string;
  chainList: ChainListType;
} & QueryClients;

export type BridgeAndExecuteResult = {
  executeTransactionHash: string;
  executeExplorerUrl: string;
  approvalTransactionHash?: string;
  bridgeExplorerUrl?: string; // undefined when bridge is skipped
  toChainId: number;
  bridgeSkipped: boolean; // indicates if bridge was skipped due to sufficient funds
  intent?: ReadableIntent;
};

/**
 * Result returned from swapAndExecute operation.
 */
export type SwapAndExecuteResult = {
  /** The swap result, or null if swap was skipped */
  swapResult: SuccessfulSwapResult | null;
  /**
   * Indicates if the swap was skipped because the user already had
   * sufficient balance on the destination chain.
   * When true, swapResult will be null and a SWAP_SKIPPED event will have been emitted.
   */
  swapSkipped: boolean;
  /** The execute transaction response */
  executeResponse: {
    /** Transaction hash of the execute call */
    txHash: `0x${string}`;
    /** Transaction receipt (if waitForReceipt was true) */
    receipt: TransactionReceipt | undefined;
    /** Approval transaction hash (if token approval was needed) */
    approvalHash: `0x${string}` | undefined;
  };
};

export type Chain = {
  blockExplorers: {
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
  ankrName: string;
  nativeCurrency: {
    decimals: number;
    name: string;
    symbol: string;
  };
  rpcUrls: {
    default: {
      grpc?: string[];
      http: string[];
      publicHttp?: string[];
      webSocket: string[];
    };
  };
  universe: Universe;
};

interface EthereumProvider {
  // biome-ignore lint/suspicious/noExplicitAny: expected for listener
  on(eventName: string | symbol, listener: (...args: any[]) => void): this;

  removeListener(
    eventName: string | symbol,
    // biome-ignore lint/suspicious/noExplicitAny: expected for listener
    listener: (...args: any[]) => void
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

export type Intent = {
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
  recipientAddress: Hex;
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
  holderAddress: Hex;
};

export type IntentSourceForAllowance = {
  chainID: number;
  currentAllowance: bigint;
  requiredAllowance: bigint;
  token: TokenInfo;
};

type Network = Extract<Environment, Environment.CERISE | Environment.CORAL | Environment.FOLLY>;

export type NetworkConfig = {
  COSMOS_REST_URL: string;
  COSMOS_RPC_URL: string;
  COSMOS_WS_URL: string;
  COSMOS_GRPC_URL: string;
  VSC_BASE_URL: string;
  VSC_WS_URL: string;
  INTENT_EXPLORER_URL: string;
  NETWORK_HINT: Environment;
};

type OnIntentHookData = {
  allow: () => void;
  deny: () => void;
  intent: ReadableIntent;
  refresh: (selectedSources?: number[]) => Promise<ReadableIntent>;
};

type OnAllowanceHookData = {
  allow: (s: Array<'max' | 'min' | bigint | string>) => void;
  deny: () => void;
  sources: AllowanceHookSources;
};

export type AllowanceHookSources = onAllowanceHookSource[];

type OnAllowanceHook = (data: OnAllowanceHookData) => void;

export type onAllowanceHookSource = {
  allowance: {
    current: string;
    currentRaw: bigint;
    minimum: string;
    minimumRaw: bigint;
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

type OnIntentHook = (data: OnIntentHookData) => void;

export type OraclePriceResponse = {
  chainId: number;
  priceUsd: Decimal;
  tokenAddress: `0x${string}`;
  tokensPerUsd: Decimal;
}[];

export type ReadableIntent = {
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

export type ChainListType = {
  chains: Chain[];
  getVaultContractAddress(chainID: number): `0x${string}`;
  getTokenInfoBySymbol(chainID: number, symbol: string): TokenInfo | undefined;
  getChainAndTokenFromSymbol(
    chainID: number,
    tokenSymbol: string
  ): {
    chain: Chain;
    token: (TokenInfo & { isNative: boolean }) | undefined;
  };
  getTokenByAddress(chainID: number, address: `0x${string}`): TokenInfo | undefined;
  getChainAndTokenByAddress(
    chainID: number,
    address: `0x${string}`
  ):
    | {
        chain: Chain;
        token: TokenInfo | undefined;
      }
    | undefined;
  getNativeToken(chainID: number): TokenInfo;
  getChainByID(id: number): Chain | undefined;
  getAnkrNameList(): string[];
};

type EventUnion =
  | { name: 'STEPS_LIST'; args: BridgeStepType[] }
  | { name: 'SWAP_STEP_COMPLETE'; args: SwapStepType }
  | { name: 'STEP_COMPLETE'; args: BridgeStepType };

export type OnEventParam = {
  onEvent?: (event: EventUnion) => void;
};

export type RFF = {
  explorerUrl: string;
  deposited: boolean;
  destinationChain: { id: number; name: string; logo: string; universe: string };
  destinations: {
    token: { address: Hex; symbol: string; decimals: number };
    value: string;
    valueRaw: bigint;
  }[];
  expiry: number;
  fulfilled: boolean;
  id: number;
  refunded: boolean;
  sources: {
    chain: { id: number; name: string; logo: string; universe: string };
    valueRaw: bigint;
    value: string;
    token: {
      address: Hex;
      symbol: string;
      decimals: number;
    };
  }[];
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

export type Token = {
  contractAddress: `0x${string}`;
  decimals: number;
  name: string;
  symbol: string;
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
  errored: boolean;
};

export type AssetBreakdown = {
  balance: string;
  balanceInFiat: number;
  chain: {
    id: number;
    logo: string;
    name: string;
  };
  contractAddress: `0x${string}`;
  decimals: number;
  universe: Universe;
};

export type UserAssetDatum = {
  abstracted?: boolean;
  balance: string;
  balanceInFiat: number;
  breakdown: AssetBreakdown[];
  decimals: number;
  icon?: string;
  symbol: string;
};

export type BeforeExecuteHook = {
  beforeExecute?: () => Promise<{ value?: bigint; data?: Hex; gas?: bigint }>;
};
/**
 * Analytics configuration options
 */
export interface AnalyticsConfig {
  /** Enable or disable analytics tracking (default: true) */
  enabled?: boolean;

  /**
   * PostHog API key (optional - uses Avail's default key if not provided)
   * By default, all SDK telemetry goes to Avail's PostHog instance
   * You can override this with your own key for custom analytics
   */
  posthogApiKey?: string;

  /**
   * PostHog API host (optional - uses Avail's PostHog instance by default)
   */
  posthogApiHost?: string;

  /** Application metadata */
  appMetadata?: {
    appName?: string;
    appVersion?: string;
    appUrl?: string;
  };

  /** Privacy options */
  privacy?: {
    /** Anonymize wallet addresses by hashing */
    anonymizeWallets?: boolean;
    /** Exclude transaction amounts from analytics */
    anonymizeAmounts?: boolean;
  };

  /** Enable session recording (default: false) */
  sessionRecording?: boolean;

  /** Enable debug logging (default: false) */
  debug?: boolean;
}

type CosmosQueryClient = {
  fetchMyIntents: (address: string, page?: number) => Promise<RequestForFunds[]>;
  fetchProtocolFees: () => Promise<QueryGetProtocolFeesResponse>;
  fetchSolverData: () => Promise<QueryAllSolverDataResponse>;
  fetchPriceOracle: () => Promise<OraclePriceResponse>;
  checkIntentFilled: (intentID: Long) => Promise<string>;
  getAccount: (address: string) => Promise<void>;
  waitForCosmosFillEvent: (intentID: Long, ac: AbortController) => Promise<string>;
};

type VSCClient = {
  getEVMBalancesForAddress: (address: `0x${string}`) => Promise<UnifiedBalanceResponseData[]>;
  getTronBalancesForAddress: (address: `0x${string}`) => Promise<UnifiedBalanceResponseData[]>;
  vscCreateFeeGrant: (address: string) => Promise<unknown>;
  vscPublishRFF: (id: Long) => Promise<{
    id: Long;
  }>;
  vscCreateSponsoredApprovals: (input: SponsoredApprovalDataArray) => Promise<
    {
      chainId: number;
      hash: Hex;
    }[]
  >;
  vscCreateRFF: (
    id: Long,
    msd: (s: { current: number; total: number; txHash: Hex; chainId: number }) => void,
    expectedCollections: { index: number; chainId: number }[]
  ) => Promise<void>;
  vscSBCTx: (input: SBCTx[]) => Promise<[bigint, `0x${string}`][]>;
};

type QueryClients = {
  cosmosQueryClient: CosmosQueryClient;
  vscClient: VSCClient;
};

export type {
  QueryClients,
  VSCClient,
  CosmosQueryClient,
  OnIntentHook,
  OnAllowanceHookData,
  OnIntentHookData,
  OnAllowanceHook,
  EthereumProvider,
  RequestArguments,
  onAllowanceHookSource as AllowanceHookSource,
  Network,
  UserAssetDatum as UserAsset,
  TokenInfo,
  RFF as RequestForFunds,
  NexusNetwork,
  TransactionReceipt,
  SwapIntent,
  SetAllowanceInput,
  FormatTokenBalanceOptions,
  FormattedParts,
};
