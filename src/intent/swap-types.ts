import type { Hex } from 'viem';

export type Source = {
  chainId: number;
  tokenAddress: Hex;
};

export interface SwapExactInParams {
  sources: Array<Source & { amountRaw: bigint }>;
  toChainId: number;
  toTokenAddress: Hex;
}

export interface SwapExactOutParams {
  sources?: Array<{ chainId: number; tokenAddress?: Hex }>;
  toChainId: number;
  toTokenAddress: Hex;
  toAmountRaw: bigint;
  toNativeAmountRaw?: bigint;
}

export interface SwapExecuteParams {
  to: Hex;
  value?: bigint;
  data?: Hex;
  /** Required raw gas estimate for the destination call. The SDK adds chain-specific buffers. */
  gas: bigint;
  gasPrice?: 'low' | 'medium' | 'high';
  tokenApproval?: { toTokenAddress: Hex; amount: bigint; spender: Hex };
}

/** Exact output is the default. Exact input executes received funds plus selected local tokens. */
export type SwapAndExecuteParams = {
  execute: SwapExecuteParams;
} & (
  | (SwapExactInParams & { tradeType: 'exactInput'; toAmountRaw?: never })
  | (Omit<SwapExactOutParams, 'toNativeAmountRaw'> & { tradeType?: 'exactOutput' })
);
