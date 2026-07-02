import type { Hex } from 'viem';
import type { Source, SwapIntent } from '../../swap/types';
import type { BridgeIntent, ExecuteFeeParams } from './index';

export type ExecuteRequirement = {
  chain: {
    id: number;
    name: string;
    logo?: string;
  };
  to: Hex;
  token: {
    address: Hex;
    symbol: string;
    decimals: number;
    amount: string;
    amountRaw: bigint;
    value: string;
  };
  gas: {
    address: Hex;
    symbol: string;
    decimals: number;
    amount: string;
    amountRaw: bigint;
    value: string;
    estimatedGasUnits: string;
    feeParams: ExecuteFeeParams;
    l1Fee: string;
    priceTier: 'low' | 'medium' | 'high';
  };
  nativeValue: {
    amount: string;
    amountRaw: bigint;
    value: string;
  } | null;
  tokenApproval: {
    token: {
      address: Hex;
      symbol: string;
      decimals: number;
    };
    amount: string;
    amountRaw: bigint;
    spender: Hex;
  } | null;
};

export type AvailableBalances = {
  token: {
    amount: string;
    amountRaw: bigint;
    value: string;
  };
  gas: {
    amount: string;
    amountRaw: bigint;
    value: string;
  };
};

export type Shortfall = {
  token: {
    amount: string;
    amountRaw: bigint;
    value: string;
  };
  gas: {
    amount: string;
    amountRaw: bigint;
    value: string;
  };
};

export type BridgeAndExecuteIntent = {
  executeRequirement: ExecuteRequirement;
  available: AvailableBalances;
} & (
  | { bridgeRequired: false }
  | {
      bridgeRequired: true;
      shortfall: Shortfall;
      bridge: BridgeIntent;
    }
);

export type SwapAndExecuteIntent = {
  executeRequirement: ExecuteRequirement;
  available: AvailableBalances;
} & (
  | { swapRequired: false }
  | {
      swapRequired: true;
      shortfall: Shortfall;
      swap: SwapIntent;
    }
);

export type BridgeAndExecuteOnIntentHookData = {
  allow: () => void;
  deny: () => void;
  intent: BridgeAndExecuteIntent;
  refresh: (selectedSources?: number[]) => Promise<BridgeAndExecuteIntent>;
};

export type SwapAndExecuteOnIntentHookData = {
  allow: () => void;
  deny: () => void;
  intent: SwapAndExecuteIntent;
  refresh: (sources?: Source[]) => Promise<SwapAndExecuteIntent>;
};
