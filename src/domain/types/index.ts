import type { Hex, TransactionReceipt } from 'viem';
import type { Universe } from '../chain-abstraction';

export type TokenInfo = {
  contractAddress: Hex;
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

export type NexusNetworkHint = 'mainnet' | 'canary' | 'testnet';

export type NetworkConfig = {
  MIDDLEWARE_HTTP_URL: string;
  INTENT_EXPLORER_URL: string;
  NETWORK_HINT: NexusNetworkHint;
};

export type NexusNetwork = NexusNetworkHint | NetworkConfig;

export interface ChainMetadata {
  id: number;
  name: string;
  shortName: string;
  logo: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrls: string[];
  blockExplorerUrls: string[];
}

export interface TokenMetadata {
  symbol: string;
  name: string;
  decimals: number;
  icon: string;
  coingeckoId: string;
  isNative?: boolean;
}

export interface BridgeParams {
  recipient?: Hex;
  toTokenSymbol: string;
  toAmountRaw: bigint;
  toChainId: number;
  toNativeAmountRaw?: bigint;
  sources?: number[];
}

export interface TransferParams {
  toTokenSymbol: string;
  toAmountRaw: bigint;
  toChainId: number;
  recipient: Hex;
  sources?: number[];
}

export type TxResult = {
  txHash: Hex;
  txExplorerUrl: string;
  receipt?: TransactionReceipt;
};

export interface ExecuteParams {
  toChainId: number;
  to: Hex;
  value?: bigint;
  data?: Hex;
  gas?: bigint;
  gasPrice?: 'low' | 'medium' | 'high';
  enableTransactionPolling?: boolean;
  transactionTimeout?: number;
  waitForReceipt?: boolean;
  receiptTimeout?: number;
  requiredConfirmations?: number;
  tokenApproval?: { toTokenSymbol: string; amount: bigint; spender: Hex };
}

export interface ExecuteResult {
  approval?: TxResult;
  execute: TxResult;
  chainId: number;
  confirmations?: number;
  gasUsed?: string;
  effectiveGasPrice?: string;
}

export type ExecuteFeeParams =
  | { type: 'eip1559'; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }
  | { type: 'legacy'; gasPrice: bigint };

export type ExecuteSimulation = {
  feeParams: ExecuteFeeParams;
  estimatedGasUnits: bigint;
  estimatedTotalCost: bigint;
};

export interface BridgeAndExecuteParams {
  toChainId: number;
  toTokenSymbol: string;
  toAmountRaw: bigint;
  sources?: number[];
  execute: Omit<ExecuteParams, 'toChainId'>;
}

export type BeforeExecuteHook = {
  beforeExecute?: () => Promise<{ value?: bigint; data?: Hex; gas?: bigint }>;
};

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

export type Chain = {
  blockExplorers?: { default: { name: string; url: string } };
  custom: { icon: string; knownTokens: TokenInfo[] };
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

export type ChainListType = {
  chains: Chain[];
  getVaultContractAddress(chainID: number): Hex;
  getTokenInfoBySymbol(chainID: number, symbol: string): TokenInfo;
  getChainAndTokenFromSymbol(
    chainID: number,
    tokenSymbol: string
  ): { chain: Chain; token: TokenInfo; isNativeToken: boolean };
  getTokenByAddress(chainID: number, address: Hex): TokenInfo;
  getChainAndTokenByAddress(
    chainID: number,
    address: Hex
  ): { chain: Chain; token: TokenInfo; isNativeToken: boolean };
  getNativeToken(chainID: number): TokenInfo;
  getChainByID(id: number): Chain;
  getTokenByCurrencyId(chainID: number, currencyId: number): TokenInfo;
};

export type RequestArguments = {
  readonly method: string;
  readonly params?: object | readonly unknown[];
};

export interface EthereumProvider {
  on(eventName: string | symbol, listener: (...args: unknown[]) => void): this;
  removeListener(eventName: string | symbol, listener: (...args: unknown[]) => void): this;
  request(args: RequestArguments): Promise<unknown>;
}

export type OnEventParam<TEvent = never> = {
  onEvent?: (event: TEvent) => void;
};

export type Tx = { data: Hex; to: Hex; value: bigint; gas?: bigint };

export type PlanTokenMetadata = {
  symbol: string;
  contractAddress: Hex;
  decimals: number;
  logo?: string;
};

type ChainDisplay = { id: number; name: string; logo: string };

export type ExecuteApprovalStep = {
  type: 'execute_approval';
  id: string;
  chain: ChainDisplay;
  token: PlanTokenMetadata;
  spender: Hex;
  amount: string;
  amountRaw: string;
};

export type ExecuteTransactionStep = {
  type: 'execute_transaction';
  id: string;
  chain: ChainDisplay;
  to: Hex;
};

export type ExecutePlanStep = ExecuteApprovalStep | ExecuteTransactionStep;

export type SupportedChainsAndTokensResult = Array<{
  id: number;
  logo: string;
  name: string;
  swapSupported: boolean;
  tokens: TokenInfo[];
}>;

export type SpanTagValue = string | number | boolean;
export type SpanProperties = {
  [key: string]: unknown;
  operation: string;
  duration: number;
  success: boolean;
};

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

export type { FormatTokenBalanceOptions, FormattedParts } from '../utils/format';
