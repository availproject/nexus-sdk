import type { Abi, Hex, TransactionReceipt } from 'viem';
import type { ExecuteResult, ExecuteSimulation } from '../domain';

export type IntentProvider = 'nexus-v2' | 'mayan';
export type IntentTradeType = 'exactInput' | 'exactOutput';
export type IntentLifecycleStatus = 'created' | 'deposited' | 'fulfilled' | 'expired';

export type IntentProviderSupport = {
  id: IntentProvider;
  currencyId?: number;
};

export type IntentToken = {
  chainId: number;
  address: Hex;
  symbol: string;
  name: string;
  decimals: number;
  isNative: boolean;
  logo?: string;
  coingeckoId?: string;
  providers: IntentProviderSupport[];
};

export type IntentChain = {
  id: number;
  name: string;
  logo?: string;
  explorerUrl?: string;
  rpcUrl?: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
    logo?: string;
    coingeckoId?: string;
  };
  providers: IntentProvider[];
  tokens: IntentToken[];
  capabilities: {
    intent: boolean;
    execute: boolean;
  };
};

export type IntentTokenCatalogEntry = {
  assetId: string;
  symbol: string;
  name: string;
  logo?: string;
  coingeckoId?: string;
  chains: Array<
    Omit<IntentToken, 'symbol' | 'logo' | 'coingeckoId'> & {
      universe: 'EVM';
    }
  >;
};

export type IntentBalance = {
  chainId: number;
  tokenAddress: Hex;
  name: string;
  symbol: string;
  decimals: number;
  isNative: boolean;
  logo?: string;
  coingeckoId?: string;
  providers: IntentProviderSupport[];
  balanceRaw: bigint;
  valueUsd: number | null;
  priceSource: 'oracle' | 'indexer' | null;
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
  depositFeeRaw: bigint;
  totalRequiredRaw: bigint;
};

export type IntentFees = {
  depositRaw: bigint;
  fulfillmentRaw: bigint;
  protocolRaw: bigint;
  solverRaw: bigint;
  caGasRaw: bigint;
};

export type IntentAllowance = {
  chainId: number;
  tokenAddress: Hex;
  spender: Hex;
  owner: Hex;
  currentRaw: bigint;
  requiredRaw: bigint;
  deficitRaw: bigint;
};

export type IntentPlanStep =
  | {
      id: string;
      type: 'erc20_approval';
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
  input: IntentQuoteInput[];
  output: {
    chainId: number;
    tokenAddress: Hex;
    amountRaw: bigint;
    minAmountRaw: bigint;
  };
  fees: IntentFees;
  expiresAt: number;
  allowances: IntentAllowance[];
  plan: IntentPlan;
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

export type IntentExecutionInstructions = {
  provider: IntentProvider;
  rff: Record<string, unknown>;
  signing: {
    type: 'personal_sign';
    message: Hex;
    hash: Hex;
  };
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
  rffSignature: Hex;
  nativeTxReceipts?: Array<{ sourceIndex: number; txHash: Hex }>;
};

export type IntentSubmitResponse = {
  quoteId: Hex;
  status: IntentLifecycleStatus;
};

export type IntentStatus = {
  id: Hex;
  provider: IntentProvider;
  status: IntentLifecycleStatus;
  substatus: string;
};

export type IntentHistoryRecord = {
  id: Hex;
  provider: IntentProvider;
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
  intentId: Hex;
  intentExplorerUrl: string;
  quote: IntentQuote;
  status: IntentStatus;
  approvals: IntentTransaction[];
  nativeTransactions: IntentTransaction[];
};

export type IntentStepState = 'started' | 'completed' | 'failed';

export type IntentEvent =
  | { type: 'quote'; quote: IntentQuote }
  | { type: 'step'; step: IntentPlanStep; state: IntentStepState; error?: string }
  | {
      type: 'status';
      status: IntentLifecycleStatus;
      substatus: string;
      intentId: Hex;
    };

export type IntentSource = {
  chainId: number;
  tokenAddress?: Hex;
  amountRaw?: bigint;
};

export type IntentHookData = {
  quote: IntentQuote;
  allow: () => void;
  deny: () => void;
  refresh: (sources?: IntentSource[]) => Promise<IntentQuote>;
};

export type IntentAllowanceSelection = 'min' | 'max' | bigint | string;

export type IntentAllowanceHookData = {
  allowances: IntentAllowance[];
  allow: (selections?: IntentAllowanceSelection[]) => void;
  deny: () => void;
};

export type BridgeAndExecuteIntentResult = Pick<ExecuteResult, 'approval' | 'execute'> &
  (
    | { bridgeSkipped: true; bridgeResult?: undefined }
    | { bridgeSkipped: false; bridgeResult: IntentResult }
  );

export type SwapAndExecuteIntentResult = Pick<ExecuteResult, 'approval' | 'execute'> &
  (
    | { swapSkipped: true; swapResult?: undefined }
    | { swapSkipped: false; swapResult: IntentResult }
  );

export type IntentAndExecuteSimulationResult = {
  intentQuote: IntentQuote | null;
  executeSimulation: ExecuteSimulation;
};
