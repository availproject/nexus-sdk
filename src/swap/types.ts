import type { BridgeProvider, MayanQuote } from '@avail-project/nexus-types';
import type Decimal from 'decimal.js';
import type { Hex, PrivateKeyAccount, PublicClient, WalletClient } from 'viem';
import type {
  ChainListType,
  MiddlewareErrorCode,
  OraclePriceResponse,
  SwapEvent,
  TimingSpanHooks,
  TokenInfo,
  TxResult,
} from '../domain';
import type { PermitVariant } from '../domain/permits';
import type {
  QuoteResponse as BridgeQuoteResponse,
  MiddlewareSwapClient,
  MiddlewareSwapExecutionClient,
} from '../transport';
import type { Aggregator, Holding, Quote, QuoteResponse } from './aggregators/types';
import type { ExactInAmountBasis } from './amount-basis';
import type { CurrencyID } from './cot';
import type { SwapCache } from './wallet/cache';

export type { OraclePriceResponse, QuoteResponse };
export type { BridgeQuoteResponse };

// ---------------------------------------------------------------------------
// Public types (frozen API)
// ---------------------------------------------------------------------------

export interface SwapExactInParams {
  sources?: (Source & { amountRaw?: bigint /* raw integer units */ })[];
  toChainId: number;
  toTokenAddress: Hex;
}

export interface SwapExactOutParams {
  sources?: Source[];
  toChainId: number;
  toTokenAddress: Hex;
  toAmountRaw: bigint; // raw integer units
  toNativeAmountRaw?: bigint; // raw integer units (native token wei)
}

export type Source = { tokenAddress: Hex; chainId: number };

export interface SwapAndExecuteParams {
  toChainId: number;
  toTokenAddress: Hex;
  toAmountRaw: bigint; // raw integer units
  sources?: Source[];
  execute: SwapExecuteParams;
}

export interface SwapExecuteParams {
  to: Hex;
  value?: bigint; // raw integer units (native token wei)
  data?: Hex;
  gas: bigint; // raw gas estimate; chain-specific adjustments and buffering are applied later
  gasPrice?: 'low' | 'medium' | 'high';
  tokenApproval?: { toTokenAddress: Hex; amount: bigint /* raw integer units */; spender: Hex };
}

export type SwapResult = {
  sourceSwaps: ChainSwap[];
  intentExplorerUrl: string;
  destinationSwap: ChainSwap | null;
  intent: SwapIntent;
};

export type ChainSwap = {
  chainId: number;
  swaps: Swap[];
  txHash: Hex;
};

export type Swap = {
  inputAmount: bigint; // raw integer units
  inputContract: Hex;
  inputDecimals: number;
  outputAmount: bigint; // raw integer units
  outputContract: Hex;
  outputDecimals: number;
};

export type SwapAndExecuteResult = {
  approval?: TxResult;
  execute: TxResult;
} & (
  | {
      swapSkipped: false;
      swapResult: SwapResult;
    }
  | {
      swapSkipped: true;
      swapResult?: undefined;
    }
);

export type SwapMaxParams = {
  toChainId: number;
  toTokenAddress: Hex;
  sources?: Source[];
};

export type SwapMaxResult = {
  toChainId: number;
  toTokenAddress: Hex;
  maxAmount: string; // human decimal string
  maxAmountRaw: bigint; // raw integer units
  symbol: string;
  decimals: number;
  sources: {
    chainId: number;
    tokenAddress: Hex;
    symbol: string;
    decimals: number;
    amount: string; // human decimal string
  }[];
};

// ---------------------------------------------------------------------------
// SwapIntent (for hook display)
// ---------------------------------------------------------------------------

export type SwapIntent = {
  destination: {
    amount: string; // human decimal string
    value?: string; // display value string
    chain: { id: number; logo: string; name: string };
    token: { contractAddress: Hex; decimals: number; symbol: string };
    gas: {
      amount: string; // human decimal string
      value?: string; // display value string
      token: { contractAddress: Hex; decimals: number; symbol: string };
    };
  };
  feesAndBuffer: {
    buffer: string;
    bridge: { caGas: string; protocol: string; solver: string; total: string } | null;
  };
  // Which bridge moves the COT cross-chain, or null when the route needs no bridge
  // (e.g. a same-chain swap). Tracks `feesAndBuffer.bridge` 1:1 (null ⟺ no bridge).
  bridgeProvider: BridgeProvider | null;
  sources: Array<{
    amount: string; // human decimal string
    value?: string; // display value string
    chain: { id: number; logo: string; name: string };
    token: { contractAddress: Hex; decimals: number; symbol: string };
  }>;
};

export type OnIntentHookData = {
  allow: () => void;
  deny: () => void;
  intent: SwapIntent;
  refresh: (sources?: Source[]) => Promise<SwapIntent>;
};

export type OnSwapIntentHookData = OnIntentHookData;

// ---------------------------------------------------------------------------
// Wallet path types
// ---------------------------------------------------------------------------

// Smart-account wrapper used for swap execution on a given chain. The user's connected EOA is
// never a swap-executor wallet path: every swap leg runs inside one of these wrappers, and
// only the destination COT case (no destination swap step) routes the bridge fill directly to
// the user's EOA — that's signalled by `route.destination.swap.tokenSwap === null`, not by an
// EOA wallet path value.
export type WalletPath = 'ephemeral' | 'safe';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

export enum SwapMode {
  EXACT_IN = 'EXACT_IN',
  EXACT_OUT = 'EXACT_OUT',
}

export type SwapData =
  | { mode: SwapMode.EXACT_IN; data: SwapExactInParams }
  | { mode: SwapMode.EXACT_OUT; data: SwapExactOutParams };

export type FlatBalance = {
  amount: string; // human decimal string
  chainID: number;
  decimals: number;
  logo: string;
  name: string;
  symbol: string;
  tokenAddress: Hex;
  value: number;
};

export type BridgeAsset = {
  chainID: number;
  contractAddress: Hex;
  decimals: number;
  eoaBalance: Decimal; // human-readable decimal amount
  ephemeralBalance: Decimal; // human-readable decimal amount
};

export type NexusFeeModel = {
  fulfillmentFee: Decimal;
  fulfillmentBps: Decimal;
};

export type DestinationSwap = {
  tokenSwap: QuoteResponse | null;
  gasSwap: QuoteResponse | null;
};

export type SourceChainCOT = {
  contractAddress: Hex;
  decimals: number;
  currencyId: number;
};

export type SwapRoute = {
  type: SwapMode;
  // Present on Exact In routes; omitted on Exact Out. Internal callers default to `minimum`.
  exactInAmountBasis?: ExactInAmountBasis;
  // Currency the route settles/bridges in (the destination family for a same-token bridge, else
  // the COT/USDC). Drives the on-failure cleanup sweep's `currencyId`.
  settlementCurrencyId: number;
  // True iff the same-token direct bridge fired (no source/destination swap). A Nexus same-token
  // bridge deposits the exact amount directly, so nothing strands → the failure sweep is skipped.
  sameTokenBridge: boolean;
  // True iff the direct-destination fast path (Path A) fired: ALL sources on the destination chain,
  // swapped input→toToken directly with no bridge and no destination swap. The whole route is one
  // atomic batch on one chain (revertOnFailure) → nothing strands on failure, so the failure sweep
  // is skipped (`resolveFailureSweepCurrencyId` returns null).
  directDestination?: boolean;
  source: {
    swaps: QuoteResponse[];
    creationTime: number;
    cotByChain?: Map<number, SourceChainCOT>;
    // Headroom in COT units that source swaps may lose on a re-quote when legs revert.
    // EXACT_OUT carries `min(SRC_BUFFER_PCT, SRC_BUFFER_MAX_USD)` of the destination-
    // buffered input. EXACT_IN carries `null` — it re-quotes a failed leg and proceeds
    // with no drift guard (Seam 2 re-sizes the dst swap to whatever COT actually lands).
    srcBuffer: Decimal | null;
    // EXACT_IN reclaim (set only when a bridge runs): execution bridges the COT that actually
    // landed at the source wrapper (`balanceOf`) rather than the conservative quote floor, so
    // positive source slippage reaches the destination instead of being swept at the source.
    reclaimFromActualBalance?: boolean;
  };
  bridge: {
    amount: Decimal; // human-readable decimal amount
    amounts: {
      tokenAmount: Decimal; // human-readable decimal amount
      gasInCot: Decimal; // human-readable decimal amount
      totalAmount: Decimal; // human-readable decimal amount
    };
    assets: BridgeAsset[];
    chainID: number;
    decimals: number;
    tokenAddress: Hex;
    estimatedFees: {
      collection: Decimal; // human-readable decimal amount
      fulfilment: Decimal; // human-readable decimal amount
      caGas: Decimal; // human-readable decimal amount (stubbed to 0)
      protocol: Decimal; // human-readable decimal amount (stubbed to 0)
      solver: Decimal; // human-readable decimal amount (stubbed to 0)
    };
    // Retained so execution can apply the fixed-plus-bps model to actual bridged balances.
    nexusFeeModel?: NexusFeeModel;
    provider: BridgeProvider;
    // Populated only when provider === 'mayan'. Keyed by `${chainID}:${contractAddress.toLowerCase()}`.
    mayanQuotesBySource?: Map<string, MayanQuote>;
  } | null;
  destination: {
    chainId: number;
    eoaToEphemeral: {
      amount: bigint; // raw integer units
      contractAddress: Hex;
    } | null;
    inputAmount: {
      min: Decimal; // human-readable decimal amount
      max: Decimal; // human-readable decimal amount
    };
    swap: DestinationSwap;
    // Re-quote the dst swap against the COT that actually arrived at the wrapper (raw). Each mode's
    // closure interprets it: EXACT_IN grows the input toward it (more output); EXACT_OUT keeps the
    // output fixed but lifts its max-input budget to it (so the srcBuffer covers destination drift).
    getDstSwap: (actualCotRaw: bigint) => Promise<DestinationSwap | null>;
  };
  buffer: { amount: string }; // human decimal string
  dstTokenInfo: Pick<TokenInfo, 'symbol' | 'decimals' | 'contractAddress'>;
  extras: {
    aggregators: Aggregator[];
    oraclePrices: OraclePriceResponse;
    balances: FlatBalance[];
    assetsUsed: AssetsUsedEntry[];
    directDestination?: {
      dstHoldings: (Holding & { value: number })[];
      toAmountRaw: bigint;
      toNativeAmountRaw: bigint;
    };
  };
  sourceExecutionPaths: Map<number, WalletPath>;
};

export type AssetsUsedEntry = {
  chainID: number;
  tokenAddress: Hex;
  symbol: string;
  decimals: number;
  amount: string; // human decimal string
};

export type AuthorizationListItem = {
  chainId: Hex;
  address: Hex;
  nonce: number;
  v: number;
  r: Hex;
  s: Hex;
};

export type SBCTx = {
  chainId: number;
  address: Hex;
  nonce: Hex;
  keyHash: Hex;
  deadline: Hex;
  calls: Array<{ to: Hex; value: Hex; data: Hex }>;
  revertOnFailure: boolean;
  signature: Hex;
  authorizationList?: AuthorizationListItem[];
};

export type SBCResult<E extends boolean = boolean> = {
  chainId: number;
  address: Hex;
  errored: E;
} & (E extends true
  ? {
      message: string;
      // Middleware typed error envelope. `code`/`errorId` are always present on a v2 errored result;
      // `subcode`/`details` are optional in the envelope itself (the server may omit them).
      code: MiddlewareErrorCode;
      errorId: string;
      subcode?: string;
      details?: Record<string, unknown>;
    }
  : { txHash: Hex });

export type SwapMetadata = {
  src: Array<{ chid: number; swaps: Swap[]; tx_hash: Hex }>;
  dst: { chid: number; swaps: Swap[]; tx_hash: Hex } | null;
  has_xcs: boolean;
  intent_request_hash: Hex | null;
};

// ---------------------------------------------------------------------------
// Params & context
// ---------------------------------------------------------------------------

export type SwapParams = {
  chainList: ChainListType;
  eoaWallet: WalletClient;
  eoaAddress: Hex;
  ephemeralWallet: PrivateKeyAccount;
  middlewareClient: MiddlewareSwapClient;
  intentExplorerUrl: string;
  onIntent?: (data: OnIntentHookData) => void;
  emit?: (event: SwapEvent) => void;
  timing?: TimingSpanHooks;
  slippage?: number;
  preloadedBalances?: Awaited<ReturnType<MiddlewareSwapClient['getSwapBalances']>>;
  cotCurrencyId: CurrencyID;
};

export type PublicClientList = {
  get(chainId: number): PublicClient;
};

export type ExecutionContext = {
  chainList: ChainListType;
  publicClientList: PublicClientList;
  middlewareClient: MiddlewareSwapExecutionClient;
  eoaWallet: WalletClient;
  eoaAddress: Hex;
  ephemeralWallet: PrivateKeyAccount;
  intentExplorerUrl: string;
  sourceExecutionPaths: Map<number, WalletPath>;
  // True when `route.destination.swap.tokenSwap === null` — bridge fill goes directly to the
  // EOA and there's no destination swap step. Carried on the execution context so dispatchers
  // don't need to read back the route shape.
  destinationDirectEoa: boolean;
  cache: SwapCache | undefined;
  preparedExecution?: PreparedSwapExecution;
  onProgress?: (update: SwapExecutionProgressUpdate) => void;
  timing?: TimingSpanHooks;
  slippage: number;
};

export type SwapExecutionProgressUpdate =
  | {
      stepType: 'source_swap';
      chainId: number;
      state: 'wallet_prompted' | 'started';
    }
  | {
      stepType: 'source_swap';
      chainId: number;
      state: 'submitted' | 'confirmed';
      txHash: Hex;
      explorerUrl: string;
    }
  | {
      stepType: 'source_swap';
      chainId: number;
      state: 'failed';
      error: string;
      txHash?: Hex;
      explorerUrl?: string;
    }
  | {
      stepType: 'eoa_to_ephemeral_transfer';
      chainId: number;
      state: 'wallet_prompted';
    }
  | {
      stepType: 'eoa_to_ephemeral_transfer';
      chainId: number;
      state: 'submitted' | 'confirmed';
      txHash: Hex;
      explorerUrl: string;
    }
  | {
      stepType: 'eoa_to_ephemeral_transfer';
      chainId: number;
      state: 'failed';
      error: string;
      txHash?: Hex;
      explorerUrl?: string;
    }
  | {
      stepType: 'bridge_deposit';
      chainId: number;
      state: 'started';
    }
  | {
      stepType: 'bridge_deposit';
      chainId: number;
      state: 'submitted' | 'confirmed';
      txHash: Hex;
      explorerUrl: string;
    }
  | {
      stepType: 'bridge_deposit';
      chainId: number;
      state: 'failed';
      error: string;
      txHash?: Hex;
      explorerUrl?: string;
    }
  | {
      stepType: 'bridge_intent_submission';
      state: 'started';
    }
  | {
      stepType: 'bridge_intent_submission';
      state: 'completed';
      intentRequestHash: Hex;
    }
  | {
      stepType: 'bridge_intent_submission';
      state: 'failed';
      error: string;
      intentRequestHash?: Hex;
    }
  | {
      stepType: 'bridge_fill';
      state: 'waiting' | 'completed';
      intentRequestHash: Hex;
    }
  | {
      stepType: 'bridge_fill';
      state: 'failed';
      intentRequestHash: Hex;
      error: string;
    }
  | {
      stepType: 'destination_swap';
      chainId: number;
      state: 'wallet_prompted' | 'started';
    }
  | {
      stepType: 'destination_swap';
      chainId: number;
      state: 'submitted' | 'confirmed';
      txHash: Hex;
      explorerUrl: string;
    }
  | {
      stepType: 'destination_swap';
      chainId: number;
      state: 'failed';
      error: string;
      txHash?: Hex;
      explorerUrl?: string;
    };

export type PreparedAuthorizationCall =
  | {
      kind: 'permit';
      call: { to: Hex; data: Hex; value: bigint } | null;
      permit: {
        signature: Hex | null;
        permitVariant: PermitVariant;
        permitContractVersion: number;
      };
    }
  | {
      // Marker: unsupported permit flow requires a paid EOA approve(spender=ephemeral)
      // transaction before the SBC transferFrom path can execute.
      kind: 'approve';
      call: { to: Hex; data: Hex; value: bigint };
      permit: null;
    };

export type ParsedQuoteCall = {
  chainId: number;
  quote: Quote;
  approval: { to: Hex; data: Hex; value: bigint } | null;
  swap: { to: Hex; data: Hex; value: bigint };
};

export type PreparedEoaToEphemeralTransfer = {
  reason: 'source' | 'destination' | 'bridge';
  chainId: number;
  tokenAddress: Hex;
  amount: bigint; // raw integer units
  // The smart-account executor that receives the funds and is the approve/permit spender:
  // the predicted Safe on non-7702 chains, the ephemeral on 7702 chains. The transferFrom
  // recipient and the authorization spender must both be this address.
  targetAddress: Hex;
  authorization: PreparedAuthorizationCall | null;
  transferCall: { to: Hex; data: Hex; value: bigint };
};

export type PreparedSwapExecution = {
  parsedQuotes: ParsedQuoteCall[];
  eoaToEphemeralTransfers: PreparedEoaToEphemeralTransfer[];
};
