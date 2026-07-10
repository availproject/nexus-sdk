import type { Universe as MiddlewareUniverse } from '@avail-project/nexus-types/common';
import type Decimal from 'decimal.js';
import type { Hex, TransactionReceipt, WalletClient } from 'viem';
import type { MayanQuote, MiddlewareBridgeClient } from '../../transport';
import type { Universe } from '../chain-abstraction';
import type { FormatTokenBalanceOptions, FormattedParts } from '../utils/format';

export type {
  BridgeAllowanceApprovalProgressEvent,
  BridgeAllowanceApprovalStep,
  BridgeAndExecuteEvent,
  BridgeAndExecutePlan,
  BridgeAndExecutePlanConfirmedEvent,
  BridgeAndExecutePlanPreviewEvent,
  BridgeAndExecutePlanProgressEvent,
  BridgeAndExecutePlanStep,
  BridgeAndExecuteStatus,
  BridgeAndExecuteStatusEvent,
  BridgeEvent,
  BridgeFillProgressEvent,
  BridgeFillStep,
  BridgePlan,
  BridgePlanConfirmedEvent,
  BridgePlanPreviewEvent,
  BridgePlanProgressEvent,
  BridgePlanProgressFailedBase,
  BridgePlanStep,
  BridgeRequestSigningProgressEvent,
  BridgeRequestSigningStep,
  BridgeRequestSubmissionProgressEvent,
  BridgeRequestSubmissionStep,
  BridgeStatus,
  BridgeStatusEvent,
  BridgeVaultDepositProgressEvent,
  BridgeVaultDepositStep,
  ExecuteApprovalProgressEvent,
  ExecuteApprovalStep,
  ExecutePlanStep,
  ExecuteTransactionProgressEvent,
  ExecuteTransactionStep,
} from './bridge-events';
export type {
  AvailableBalances,
  BridgeAndExecuteIntent,
  BridgeAndExecuteOnIntentHookData,
  ExecuteRequirement,
  Shortfall,
  SwapAndExecuteIntent,
  SwapAndExecuteOnIntentHookData,
} from './composite-intents';
export type {
  PlanConfirmedEvent,
  PlanPreviewEvent,
  PlanProgressFailedBase,
  StatusEvent,
} from './event-common';
export type { PlanTokenAmount, PlanTokenMetadata } from './plan-common';
export type {
  SwapAndExecuteEvent,
  SwapAndExecutePlan,
  SwapAndExecutePlanConfirmedEvent,
  SwapAndExecutePlanPreviewEvent,
  SwapAndExecutePlanProgressEvent,
  SwapAndExecutePlanStep,
  SwapAndExecuteStatus,
  SwapAndExecuteStatusEvent,
  SwapBridgeDepositProgressEvent,
  SwapBridgeDepositStep,
  SwapBridgeFillProgressEvent,
  SwapBridgeIntentSubmissionProgressEvent,
  SwapBridgeIntentSubmissionStep,
  SwapDestinationSwapProgressEvent,
  SwapDestinationSwapStep,
  SwapEoaToEphemeralTransferProgressEvent,
  SwapEoaToEphemeralTransferStep,
  SwapEvent,
  SwapPlan,
  SwapPlanConfirmedEvent,
  SwapPlanPreviewEvent,
  SwapPlanProgressEvent,
  SwapPlanProgressFailedBase,
  SwapPlanStep,
  SwapSourceSwapProgressEvent,
  SwapSourceSwapStep,
  SwapStatus,
  SwapStatusEvent,
} from './swap-events';

type TokenInfo = {
  contractAddress: `0x${string}`;
  decimals: number;
  logo: string;
  name: string;
  symbol: string;
  balanceSlot?: number;
  permitVariant?: number;
  permitVersion?: number;
  currencyId?: number;
  mayanEnabled?: boolean;
};

type NexusNetworkHint = 'mainnet' | 'canary' | 'testnet';

type NexusNetwork = NexusNetworkHint | NetworkConfig;

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
 * Response structure for token allowance.
 */
export interface AllowanceResponse {
  chainID: number;
  allowance: bigint;
  token: string;
}

/**
 * Parameters for bridging tokens between chains.
 */
export interface BridgeParams {
  recipient?: Hex;
  toTokenSymbol: string;
  toAmountRaw: bigint;
  toChainId: number;
  toNativeAmountRaw?: bigint;
  sources?: number[];
}

export type TxResult = {
  txHash: Hex;
  txExplorerUrl: string;
  receipt?: TransactionReceipt;
};

export type SourceTxs = (TxResult & {
  chain: {
    id: number;
    name: string;
    logo: string;
  };
})[];

/**
 * Result structure for bridge transactions.
 */
export type BridgeResult = {
  intentExplorerUrl: string;
  sourceTxs: SourceTxs;
  intent: BridgeIntent;
};

/**
 * Result structure for transfer transactions.
 */
export type TransferResult = BridgeAndExecuteResult;

/**
 * Parameters for transferring tokens.
 */
export interface TransferParams {
  toTokenSymbol: string;
  toAmountRaw: bigint;
  toChainId: number;
  recipient: `0x${string}`;
  sources?: number[];
}

type GasPriceSelector = 'low' | 'medium' | 'high';

export interface ExecuteParams {
  toChainId: number;
  to: Hex;
  value?: bigint;
  data?: Hex;
  gas?: bigint;
  gasPrice?: GasPriceSelector;
  enableTransactionPolling?: boolean;
  transactionTimeout?: number;
  // Transaction receipt confirmation options
  waitForReceipt?: boolean;
  receiptTimeout?: number;
  requiredConfirmations?: number;
  tokenApproval?: {
    toTokenSymbol: string;
    amount: bigint;
    spender: Hex;
  };
}

export interface ExecuteResult {
  approval?: TxResult;
  execute: TxResult;
  chainId: number;
  confirmations?: number;
  gasUsed?: string;
  effectiveGasPrice?: string;
}

export interface BridgeSimulationResult {
  intent: BridgeIntent;
  token: TokenInfo;
}

export type ExecuteFeeParams =
  | { type: 'eip1559'; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }
  | { type: 'legacy'; gasPrice: bigint };

export type ExecuteSimulation = {
  feeParams: ExecuteFeeParams;
  /** Combined gas units across approval (if required) and execution transaction. */
  estimatedGasUnits: bigint;
  /** Combined estimated cost across approval (if required) and execution transaction. */
  estimatedTotalCost: bigint;
};

export type BridgeAndExecuteSimulationResult = {
  bridgeSimulation: BridgeSimulationResult | null;
  executeSimulation: ExecuteSimulation;
};

export interface BridgeAndExecuteParams {
  toChainId: number;
  toTokenSymbol: string;
  toAmountRaw: bigint;
  sources?: number[];
  execute: Omit<ExecuteParams, 'toChainId'>;
  enableTransactionPolling?: boolean;
  transactionTimeout?: number;
  waitForReceipt?: boolean;
  receiptTimeout?: number;
  requiredConfirmations?: number;
  recentApprovalTxHash?: string;
}

export type BridgeOptions = {
  evm: {
    address: `0x${string}`;
    client: WalletClient;
    provider: EthereumProvider;
  };
  hooks: {
    onAllowance: OnAllowanceHook;
    onIntent: OnIntentHook;
  };
  emit?: OnEventParam<import('./bridge-events').BridgeEvent>['onEvent'];
  intentExplorerUrl: string;
  chainList: ChainListType;
  middlewareClient: MiddlewareBridgeClient;
  fillTimeoutMinutes?: number;
  timing?: TimingSpanHooks;
};

export type SupportedChainsAndTokensResult = {
  id: number;
  logo: string;
  name: string;
  // True unless the chain's deployment config explicitly sets swapSupported=false. Lets
  // consumers filter to the chains a swap can use as a source/destination.
  swapSupported: boolean;
  tokens: TokenInfo[];
}[];

export const IntentStatus = {
  Created: 'created',
  Deposited: 'deposited',
  Fulfilled: 'fulfilled',
  Expired: 'expired',
} as const;

export type IntentStatus = (typeof IntentStatus)[keyof typeof IntentStatus];

export type ListIntentsParams = {
  page?: number;
  status?: IntentStatus;
};

export type BridgeAndExecuteResult = {
  approval?: TxResult;
  execute: TxResult;
} & (
  | {
      bridgeSkipped: false;
      bridgeResult: BridgeResult;
    }
  | {
      bridgeSkipped: true;
      bridgeResult?: undefined;
    }
);

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
  mayanEnabled?: boolean;
  name: string;
  multicallAddress: Hex;
  nativeCurrency: {
    decimals: number;
    name: string;
    symbol: string;
    logo: string;
    currencyId?: number;
    mayanEnabled?: boolean;
  };
  rpcUrls: {
    default: {
      grpc?: string[];
      http: string[];
      publicHttp?: string[];
      webSocket: string[];
    };
  };
  supports7702?: boolean;
  swapSupported?: boolean;
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

export type BridgeIntentToken = Pick<
  TokenInfo,
  'contractAddress' | 'decimals' | 'logo' | 'name' | 'symbol'
>;

export type BridgeIntentDraft = {
  availableSources: BridgeIntentDraftSource[];
  provider: 'nexus' | 'mayan';
  destination: BridgeIntentDraftDestination;
  fees: {
    caGas: string;
    deposit: string;
    fulfillment: string;
    protocol: string;
    solver: string;
  };
  recipientAddress: Hex;
  selectedSources: BridgeIntentDraftSource[];
};

type BridgeIntentDraftDestination = {
  amount: Decimal; // human decimal amount
  amountRaw: bigint;
  token: BridgeIntentToken;

  nativeAmount: Decimal;
  nativeAmountRaw: bigint;
  nativeAmountValue: Decimal;
  nativeAmountInToken: Decimal;
  nativeToken: BridgeIntentToken;

  chain: {
    id: number;
    name: string;
    logo: string;
  };
  universe: Universe;
  value: Decimal; // usd value
};

type BridgeIntentDraftSource = {
  amount: Decimal; // human decimal amount
  amountRaw: bigint;
  chain: {
    id: number;
    name: string;
    logo: string;
  };
  token: BridgeIntentToken;
  universe: Universe;
  holderAddress: Hex;
  value: Decimal; // usd value
  depositFee: Decimal; // per-source deposit fee in token units (0 for native)
  depositFeeRaw: bigint;
  mayanQuote?: MayanQuote;
};

export type IntentSourceForAllowance = {
  chainID: number;
  currentAllowance: bigint;
  requiredAllowance: bigint;
  token: TokenInfo;
};

export type NetworkConfig = {
  MIDDLEWARE_HTTP_URL: string;
  INTENT_EXPLORER_URL: string;
  NETWORK_HINT: NexusNetworkHint;
};

type OnIntentHookData = {
  allow: () => void;
  deny: () => void;
  intent: BridgeIntent;
  refresh: (selectedSources?: number[]) => Promise<BridgeIntent>;
};

type OnAllowanceHookData = {
  allow: (s: Array<'max' | 'min' | bigint | string>) => void;
  deny: () => void;
  sources: AllowanceHookSources;
};

export type AllowanceHookSources = AllowanceHookSource[];

type OnAllowanceHook = (data: OnAllowanceHookData) => void;

export type AllowanceHookSource = {
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
  holderAddress?: Hex;
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
  universe: 'EVM' | 'TRON' | 'FUEL' | 'SVM';
  chainId: number;
  priceUsd: Decimal;
  tokenAddress: `0x${string}`;
  tokenSymbol: string;
  tokenDecimals: number;
  timestamp: number;
}[];

export type BridgeIntent = {
  provider: 'nexus' | 'mayan';
  availableSources: {
    amount: string;
    amountRaw: bigint;
    chain: { id: number; name: string; logo: string };
    token: { decimals: number; symbol: string; logo: string; contractAddress: Hex };
    value: string;
  }[];
  destination: {
    amount: string;
    amountRaw: bigint;
    chain: { id: number; name: string; logo: string };
    token: { decimals: number; symbol: string; logo: string; contractAddress: Hex };
    value: string;
    nativeAmount: string;
    nativeAmountRaw: bigint;
    nativeAmountValue: string;
    nativeAmountInToken: string;
    nativeToken: { decimals: number; symbol: string; logo: string; contractAddress: Hex };
  };
  fees: {
    caGas: string;
    protocol: string;
    solver: string;
    total: string;
    totalValue: string;
  };
  selectedSources: {
    amount: string;
    amountRaw: bigint;
    chain: { id: number; name: string; logo: string };
    token: { decimals: number; symbol: string; logo: string; contractAddress: Hex };
    value: string;
    mayanQuote?: MayanQuote;
  }[];
  sourcesTotal: string;
  sourcesTotalValue: string;
};

type RequestArguments = {
  readonly method: string;
  readonly params?: object | readonly unknown[];
};

export type ChainListType = {
  chains: Chain[];
  getVaultContractAddress(chainID: number): `0x${string}`;
  getTokenInfoBySymbol(chainID: number, symbol: string): TokenInfo;
  getChainAndTokenFromSymbol(
    chainID: number,
    tokenSymbol: string
  ): {
    chain: Chain;
    token: TokenInfo;
    isNativeToken: boolean;
  };
  getTokenByAddress(chainID: number, address: `0x${string}`): TokenInfo;
  getChainAndTokenByAddress(
    chainID: number,
    address: `0x${string}`
  ): {
    chain: Chain;
    token: TokenInfo;
    isNativeToken: boolean;
  };
  getNativeToken(chainID: number): TokenInfo;
  getChainByID(id: number): Chain;
  getTokenByCurrencyId(chainID: number, currencyId: number): TokenInfo;
};

export type OnEventParam<TEvent = never> = {
  onEvent?: (event: TEvent) => void;
};

export type Tx = {
  data: Hex;
  to: Hex;
  value: bigint;
  gas?: bigint;
};

export type IntentRecord = {
  requestHash: Hex;
  explorerUrl: string;
  status: IntentStatus;
  solver: Hex | null;
  createdAt?: number;
  updatedAt?: number;
  expiry: number;
  recipientAddress: Hex;
  destinationChain: {
    id: number;
    name: string;
    logo: string;
    universe: MiddlewareUniverse;
  };
  destinations: {
    token: {
      contractAddress: Hex;
      symbol: string;
      name: string;
      logo: string;
      decimals: number;
    };
    amount: string;
    amountRaw: bigint;
  }[];
  sources: {
    chain: {
      id: number;
      name: string;
      logo: string;
      universe: MiddlewareUniverse;
    };
    amountRaw: bigint;
    amount: string;
    feeRaw: bigint;
    fee: string;
    token: {
      contractAddress: Hex;
      symbol: string;
      name: string;
      logo: string;
      decimals: number;
    };
  }[];
};

export type ListIntentsResult = {
  intents: IntentRecord[];
  total: number;
};

type SetAllowanceInput = {
  amount: bigint;
  chainID: number;
  ownerAddress?: Hex;
  tokenContract: `0x${string}`;
};

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

export type ChainBalance = {
  balance: string;
  value: string;
  symbol: string;
  chain: {
    id: number;
    logo: string;
    name: string;
  };
  contractAddress: `0x${string}`;
  decimals: number;
  universe: Universe;
};

export type TokenBalance = {
  balance: string;
  value: string;
  chainBalances: ChainBalance[];
  currencyId?: number;
  decimals: number;
  logo: string;
  name: string;
  symbol: string;
};

export type BridgeTokenBalance = TokenBalance & {
  currencyId: number;
};

export type SwapTokenBalance = TokenBalance;

export type BeforeExecuteHook = {
  beforeExecute?: () => Promise<{ value?: bigint; data?: Hex; gas?: bigint }>;
};

export type SpanId = string;

export type SpanTagValue = string | number | boolean;

export type SpanTags = Record<string, SpanTagValue>;

export interface SpanContext {
  operationId: string;
  operationName: string;
  startTime: number;
  metadata?: Record<string, unknown>;
  spanId: SpanId;
  parentSpanId?: SpanId;
  rootSpanId: SpanId;
  tags?: SpanTags;
  startedAtIso: string;
}

export interface SpanProperties {
  [key: string]: unknown;
  operation: string;
  duration: number;
  success: boolean;
  errorMessage?: string;
  errorType?: string;
  metadata?: Record<string, unknown>;
  spanId: SpanId;
  parentSpanId?: SpanId;
  rootSpanId: SpanId;
  startedAtIso: string;
  endedAtIso: string;
  tags?: SpanTags;
}

export interface DevTimingConfig {
  /** Enable or disable developer timing instrumentation (default: false) */
  enabled?: boolean;
  /** Emit timing spans to analytics transport (default: true) */
  emitAnalytics?: boolean;
  /** Emit timing spans to logs (default: true) */
  emitLogs?: boolean;
  /** Capture network timing via transport interceptors (default: true) */
  captureNetworkTiming?: boolean;
  /** Enable verbose timing logs (default: false) */
  verbose?: boolean;
  /** Sample rate for span collection, from 0 to 1 (default: 1) */
  sampleRate?: number;
  /** Callback invoked when a span completes */
  onSpanComplete?: (span: SpanProperties) => void;
}

export interface TimingSpanHooks {
  startSpan: (
    name: string,
    options?: { parentSpanId?: string; tags?: Record<string, SpanTagValue> }
  ) => string;
  endSpan: (spanId: string, result: { success: boolean; error?: Error }) => SpanProperties | null;
  withSpan: <T>(
    name: string,
    fn: () => Promise<T>,
    options?: { parentSpanId?: string; tags?: Record<string, SpanTagValue> }
  ) => Promise<T>;
}
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

export type {
  NexusNetworkHint,
  OnIntentHook,
  OnAllowanceHookData,
  OnIntentHookData,
  OnAllowanceHook,
  EthereumProvider,
  RequestArguments,
  TokenInfo,
  NexusNetwork,
  TransactionReceipt,
  SetAllowanceInput,
  FormatTokenBalanceOptions,
  FormattedParts,
  BridgeIntentDraftSource,
  BridgeIntentDraftDestination,
};
