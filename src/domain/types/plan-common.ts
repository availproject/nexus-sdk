import type { Hex } from 'viem';

export type PlanTokenMetadata = {
  symbol: string;
  contractAddress: Hex;
  decimals: number;
  logo?: string;
};

export type PlanTokenAmount = PlanTokenMetadata & {
  amount: string;
  amountRaw: bigint;
};
