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
  sources?: Source[];
  toChainId: number;
  toTokenAddress: Hex;
  toAmountRaw: bigint;
  toNativeAmountRaw?: bigint;
}

export interface SwapExecuteParams {
  to: Hex;
  value?: bigint;
  data?: Hex;
  gas?: bigint;
  gasPrice?: 'low' | 'medium' | 'high';
  tokenApproval?: { toTokenAddress: Hex; amount: bigint; spender: Hex };
}

export interface SwapAndExecuteParams {
  toChainId: number;
  toTokenAddress: Hex;
  toAmountRaw: bigint;
  sources?: Source[];
  execute: SwapExecuteParams;
}
