import type { BridgeProvider } from '@avail-project/nexus-types';
import type { Hex } from 'viem';
import type {
  BridgeEvent,
  BridgeIntent,
  BridgeOptions,
  BridgeResult,
  Chain,
  SourceTxs,
  TokenInfo,
} from '../domain';

export type BridgeFlowParams = {
  recipient?: Hex;
  dstChain: Chain;
  dstToken: TokenInfo;
  tokenAmount: bigint;
  nativeAmount: bigint;
  sourceChains: number[];
};

export type BridgeMaxParams = {
  toChainId: number;
  toTokenSymbol: string;
  /** Restrict which source chains are considered (chain IDs). Empty/omitted = all. */
  sources?: number[];
};

export type BridgeMaxResult = {
  toChainId: number;
  toTokenSymbol: string;
  /** Provider the max was computed against ('mayan' once the bridge amount clears the threshold). */
  provider: BridgeProvider;
  maxAmount: string; // human decimal string
  maxAmountRaw: bigint; // raw integer units — suitable for toAmountRaw in bridge()
  symbol: string;
  decimals: number;
  sources: {
    chainId: number;
    tokenAddress: Hex;
    symbol: string;
    decimals: number;
    amount: string; // human decimal string drawn from this source
  }[];
};

export type BridgeExecutionResult = {
  intentExplorerUrl: string;
  intent: BridgeIntent;
  sourceTxs: SourceTxs;
};

export type BridgeFlowOptions = {
  hooks: BridgeOptions['hooks'];
  emit?: (event: BridgeEvent) => void;
  fillTimeoutMinutes?: number;
};

export type BridgeFlowResult = BridgeResult;
