import type { Abi, Hex, TransactionReceipt } from 'viem';
import type { ExecuteFeeParams, ExecuteResult, ExecuteSimulation } from '../domain';
import type { ErrorCategory, ErrorCode } from '../domain/errors';

/** Every provider the middleware can name in a catalog, quote, or status response. */
export const INTENT_PROVIDERS = ['nexus-v2', 'mayan', 'relay'] as const;
export type IntentProvider = (typeof INTENT_PROVIDERS)[number];
export type IntentTradeType = 'exactInput' | 'exactOutput';
export type IntentLifecycleStatus = 'created' | 'deposited' | 'fulfilled' | 'expired';

export type IntentProviderSupport = {
  id: IntentProvider;
  currencyId?: number | string;
};

export type TokenRef = {
  chainId: number;
  tokenAddress: Hex;
};

export type IntentToken = {
  chainId: number;
  address: Hex;
  symbol: string;
  name: string;
  decimals: number;
  isNative: boolean;
  /** Whether at least one selected provider marks this token as verified. */
  verified: boolean;
  logo?: string;
  coingeckoId?: string;
  providers: IntentProviderSupport[];
  asSource?: IntentProviderSupport[];
  asDestination?: IntentProviderSupport[];
  permit?: { variant: 'eip2612' | 'emt'; version?: string };
  sponsoredApproval?: boolean;
};

export type IntentChain = {
  id: number;
  name: string;
  logo?: string;
  explorerUrl?: string;
  rpcUrl?: string;
  vaultAddress?: Hex;
  multicallAddress?: Hex;
  sponsored?: boolean;
  eip7702Enabled?: boolean;
  swapSupported?: boolean;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
    logo?: string;
    coingeckoId?: string;
  };
  providers: IntentProvider[];
  asSource?: IntentProvider[];
  asDestination?: IntentProvider[];
  tokens: IntentToken[];
  capabilities: {
    intent: boolean;
    execute: boolean;
  };
};

export type ProviderTokenGroup = {
  provider: IntentProvider;
  chains: IntentChain[];
};

/** Chain discovery does not include a token inventory. */
export type IntentChainMetadata = Omit<IntentChain, 'tokens'>;

export type IntentTokenQuery = {
  chainId?: number;
  providers?: IntentProvider[];
  /** Include unverified tokens alongside verified tokens. Defaults to false. */
  includeUnverified?: boolean;
  name?: string;
  symbol?: string;
  contract?: string;
  offset?: number;
  limit?: number;
};

export type IntentTokenPage = {
  tokens: IntentToken[];
  offset: number;
  limit: number;
  total: number;
};

/** Pagination describes the API candidate page, before directional filtering. */
export type IntentSourceTokenPage = Omit<IntentTokenPage, 'tokens'> & {
  groups: ProviderTokenGroup[];
};

/** Pagination describes the API candidate page, before directional filtering. */
export type IntentDestinationTokenPage = Omit<IntentTokenPage, 'tokens'> & {
  chains: IntentChain[];
};

export type IntentRouteConstraintLeg = {
  chainId?: number;
  tokenAddress?: Hex;
  amountRaw?: bigint;
};

export type IntentRouteConstraints = {
  sources?: IntentRouteConstraintLeg[];
  destinations?: IntentRouteConstraintLeg[];
  valueUsd?: number;
  providers?: IntentProvider[];
};

export type IntentSourceUnroutableReason =
  | 'BELOW_DEPOSIT_FEE'
  | 'INSUFFICIENT_APPROVAL_GAS'
  | 'ABOVE_PROVIDER_CEILING'
  | 'CURRENCY_MISMATCH'
  | 'NOT_IN_PROVIDER_CATALOG'
  | 'DESTINATION_NOT_SERVED'
  | 'PROVIDER_REFUSED';

export type IntentSourceVerdict = {
  chainId: number;
  tokenAddress: Hex;
  tokenSymbol: string;
  state: 'selected' | 'unused' | 'unroutable';
  reason?: IntentSourceUnroutableReason;
  detail?: string;
};

export type IntentQuoteFailureSubcode =
  | 'NO_ROUTABLE_SOURCE'
  | 'VALUE_ABOVE_CEILING'
  | 'NO_ROUTE_TO_DESTINATION'
  | 'INPUT_BELOW_DEPOSIT_FEE'
  | 'INTENT_REFUSED'
  | 'PROVIDER_UNAVAILABLE'
  | 'NO_PROVIDERS_ENABLED'
  | 'INSUFFICIENT_BALANCE'
  | 'INSUFFICIENT_APPROVAL_GAS'
  | 'SAME_CHAIN_GAS_DROP_UNSUPPORTED'
  | 'QUOTE_PRICE_UNAVAILABLE'
  | 'QUOTE_PRICE_OUTLIER';

export type IntentQuoteFailure = {
  code?: string;
  subcode: IntentQuoteFailureSubcode;
  errorId?: string;
  retryable: boolean;
  sourceVerdicts: IntentSourceVerdict[];
  providerReasons: string[];
  details: Record<string, unknown>;
};

export type IntentBalance = {
  chainId: number;
  tokenAddress: Hex;
  name: string;
  symbol: string;
  decimals: number;
  isNative: boolean;
  verified: boolean;
  logo?: string;
  coingeckoId?: string;
  providers: IntentProviderSupport[];
  /** Full wallet balance before reserves, in base units. */
  actualBalanceRaw: bigint;
  /** Balance available for routing after reserves, in base units. */
  usableBalanceRaw: bigint;
  /** @deprecated Use usableBalanceRaw instead. */
  balanceRaw: bigint;
  /** USD value of usableBalanceRaw, or null when the price is unavailable. */
  valueUsd: number | null;
  priceSource: 'oracle' | 'indexer' | 'coingecko' | 'relay' | null;
  usable: boolean;
};

export type IntentBalancesResult = {
  balances: IntentBalance[];
  errored: boolean;
};

export type IntentQuoteInput = {
  chainId: number;
  tokenAddress: Hex;
  tokenSymbol: string;
  amountRaw: bigint;
  /** Middleware-priced USD value for `amountRaw`, preserved as a decimal string. */
  amountUsd: string;
  depositFeeRaw: bigint;
  /** Middleware-priced USD value for `depositFeeRaw`. */
  depositFeeUsd: string;
  totalRequiredRaw: bigint;
  /** Middleware-priced USD value for `totalRequiredRaw`. */
  totalRequiredUsd: string;
};

export type IntentFees = {
  depositRaw: bigint;
  depositUsd: string;
  fulfillmentRaw: bigint;
  fulfillmentUsd: string;
  protocolRaw: bigint;
  protocolUsd: string;
  solverRaw: bigint;
  solverUsd: string;
};

export type IntentAllowance = {
  chainId: number;
  tokenAddress: Hex;
  spender: Hex;
  owner: Hex;
  currentRaw: bigint;
  requiredRaw: bigint;
  deficitRaw: bigint;
  authorizationType?: 'approve' | 'permit';
};

export type IntentPlanStep =
  | {
      id: string;
      type: 'erc20_approval' | 'source_approval_signature';
      chainId: number;
      tokenAddress: Hex;
      spender: Hex;
      amountRaw: bigint;
    }
  | { id: string; type: 'intent_signature' }
  | {
      id: string;
      type: 'native_transaction';
      chainId: number;
      sourceIndex: number;
      to: Hex;
      valueRaw: bigint;
    }
  | { id: string; type: 'intent_submission' }
  | { id: string; type: 'intent_fulfillment' };

export type IntentPlan = {
  steps: IntentPlanStep[];
};

export type IntentQuote = {
  id: Hex;
  provider: IntentProvider;
  tradeType: IntentTradeType;
  /** Middleware's source-balance check; does not imply a connected wallet or completed approvals. */
  isExecutable: boolean;
  executionWarnings: Array<{
    code: 'INSUFFICIENT_BALANCE';
    message: string;
    shortfalls: Array<{
      chainId: number;
      tokenAddress: Hex;
      requiredRaw: bigint;
      actualRaw: bigint;
    }>;
  }>;
  input: IntentQuoteInput[];
  output: {
    chainId: number;
    tokenAddress: Hex;
    amountRaw: bigint;
    /** Middleware-priced USD value for `amountRaw`. */
    amountUsd: string;
    minAmountRaw: bigint;
    /** Middleware-priced USD value for `minAmountRaw`. */
    minAmountUsd: string;
  };
  fees: IntentFees;
  expiresAt: number;
  allowances: IntentAllowance[];
  plan: IntentPlan;
  sourceVerdicts: IntentSourceVerdict[];
};

export type IntentApprovalInstruction = IntentAllowance & {
  approval?: {
    type: 'erc20_approve';
    to: Hex;
    data: Hex;
    value: '0';
  };
};

export type IntentNativeTransactionInstruction = {
  chainId: number;
  sourceIndex: number;
  kind: 'native_source_deposit';
  to: Hex;
  valueRaw: bigint;
  functionName: 'deposit' | 'depositRouter';
  abi: Abi;
  vaultRequest: Record<string, unknown>;
  payload?: Hex;
};

export type IntentRequiredSignature =
  | {
      kind: 'intent';
      universe: 'EVM';
      signingScheme: 'personal_sign';
      data: { messagePrefix: string; message: Hex; hash: Hex };
    }
  | {
      kind: 'sourceApproval';
      universe: 'EVM';
      chainId: number;
      tokenAddress: Hex;
      signingScheme: 'eip712';
      data: {
        domain: {
          name: string;
          version: string;
          chainId?: number;
          verifyingContract: Hex;
          salt?: Hex;
        };
        types: Record<string, Array<{ name: string; type: string }>>;
        primaryType: 'Permit' | 'MetaTransaction';
        message: Record<string, string>;
      };
    };

export type IntentSubmittedSignature = {
  kind: IntentRequiredSignature['kind'];
  universe: 'EVM';
  signingScheme: IntentRequiredSignature['signingScheme'];
  chainId?: number;
  tokenAddress?: Hex;
  signature: Hex;
};

export type IntentExecutionInstructions = {
  provider: IntentProvider;
  rff: Record<string, unknown>;
  requiredSignatures: IntentRequiredSignature[];
  allowances: IntentApprovalInstruction[];
  nativeTransactions: IntentNativeTransactionInstruction[];
};

export type ExecutableIntentQuote = {
  quote: IntentQuote;
  execution: IntentExecutionInstructions;
};

export type IntentQuoteRequest = {
  sender: Hex;
  recipient?: Hex;
  tradeType: IntentTradeType;
  input?: Array<{ chainId: string; token: Hex; amount: string }>;
  output: { chainId: string; token: Hex; amount?: string };
  sources?: Array<{ chainId: string; tokens?: Hex[] }>;
  preferredProviders?: IntentProvider[];
  slippageBps?: number | 'auto';
  gasDrop?: { amount: string };
};

export type IntentSubmitRequest = {
  provider: IntentProvider;
  rff: Record<string, unknown>;
  signatures: IntentSubmittedSignature[];
  nativeTxReceipts?: Array<{ sourceIndex: number; txHash: Hex }>;
};

export type IntentSubmitResponse = {
  quoteId: Hex;
  status: IntentLifecycleStatus;
};

export type IntentLegStatus = {
  sourceIndex: number;
  status: IntentLifecycleStatus;
  txHash?: Hex;
  txExplorerUrl?: string;
  protocolExplorerUrl?: string;
  error?: string;
};

export type IntentStatus = {
  id: Hex;
  provider: IntentProvider;
  status: IntentLifecycleStatus;
  substatus: string;
  legs: IntentLegStatus[];
};

export type IntentHistoryRecord = {
  id: Hex;
  /** Present only when middleware identifies the provider for this record. */
  provider?: IntentProvider;
  status: IntentLifecycleStatus;
  explorerUrl?: string;
  createdAt?: number;
  updatedAt?: number;
};

export type IntentHistoryResult = {
  intents: IntentHistoryRecord[];
  total: number;
};

export type IntentHistoryQuery = {
  user?: Hex;
  status?: IntentLifecycleStatus;
  limit?: number;
  offset?: number;
};

export type IntentTransaction = {
  chainId: number;
  txHash: Hex;
  txExplorerUrl: string;
  receipt?: TransactionReceipt;
};

export type IntentResult = {
  /** SDK payment attempt correlation ID; shared across quote refreshes. */
  attemptId?: string;
  intentId: Hex;
  intentExplorerUrl: string;
  quote: IntentQuote;
  status: IntentStatus;
  approvals: IntentTransaction[];
  nativeTransactions: IntentTransaction[];
};

export type IntentStepState = 'started' | 'completed' | 'failed';

export type IntentStepError = {
  name: string;
  message: string;
  category?: ErrorCategory;
  code?: ErrorCode;
  service?: string;
  stepId?: string;
  stepType?: string;
  chainId?: number | string;
  details?: Record<string, unknown>;
};

export type IntentEvent =
  | { type: 'quote'; quote: IntentQuote }
  | {
      type: 'step';
      step: IntentPlanStep;
      state: IntentStepState;
      committed: boolean;
      /** @deprecated Use `errorDetails.message`. Kept for backwards compatibility. */
      error?: string;
      errorDetails?: IntentStepError;
    }
  | {
      type: 'status';
      status: IntentLifecycleStatus;
      substatus: string;
      intentId: Hex;
      legs: IntentLegStatus[];
    };

export type IntentSource = {
  chainId: number;
  tokenAddress?: Hex;
  amountRaw?: bigint;
};

export type IntentHookData = {
  /** SDK payment attempt correlation ID, available before commitment. */
  attemptId?: string;
  /** Latest quote eligibility. Not-connected takes priority and requires a new swap call. */
  readonly execution:
    | { possible: true }
    | { possible: false; cause: 'not-connected' | 'insufficient-balance' };
  quote: IntentQuote;
  allow: () => void;
  deny: () => void;
  refresh: (sources?: IntentSource[]) => Promise<IntentQuote>;
};

export type FundingAmount = {
  amountRaw: bigint;
  amount: string;
  valueUsd?: string;
};

export type SwapAndExecuteIntent = {
  executeRequirement: {
    chain: { id: number; name: string; logo?: string };
    to: Hex;
    token: FundingAmount & { address: Hex; symbol: string; decimals: number };
    gas: FundingAmount & {
      address: Hex;
      symbol: string;
      decimals: number;
      estimatedGasUnits: bigint;
      approvalGasUnits: bigint;
      feeParams: ExecuteFeeParams;
      l1FeeRaw: bigint;
      priceTier: 'low' | 'medium' | 'high';
    };
    nativeValue: FundingAmount | null;
    tokenApproval:
      | (FundingAmount & {
          token: { address: Hex; symbol: string; decimals: number };
          spender: Hex;
        })
      | null;
  };
  available: { token: FundingAmount; gas: FundingAmount };
  shortfall: { token: FundingAmount; gas: FundingAmount };
} & ({ swapRequired: true; quote: IntentQuote } | { swapRequired: false; quote?: undefined });

export type SwapAndExecuteHookData = {
  attemptId?: string;
  intent: SwapAndExecuteIntent;
  allow: () => void;
  deny: () => void;
  refresh: (sources?: IntentSource[]) => Promise<SwapAndExecuteIntent>;
};

export type SwapAndExecuteIntentResult = Pick<ExecuteResult, 'approval' | 'execute'> &
  (
    | { swapSkipped: true; swapResult?: undefined }
    | { swapSkipped: false; swapResult: IntentResult }
  );

export type IntentAndExecuteSimulationResult = {
  intentQuote: IntentQuote | null;
  executeSimulation: ExecuteSimulation;
};
