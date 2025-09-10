import { Universe } from '@arcana/ca-common';
import { DirectSecp256k1Wallet } from '@cosmjs/proto-signing';
import Decimal from 'decimal.js';
import { type Hex, PrivateKeyAccount, WalletClient } from 'viem';

import { ChainListType, NetworkConfig } from './index';

export type AuthorizationList = {
  address: Uint8Array;
  chain_id: Uint8Array;
  nonce: number;
  sig_r: Uint8Array;
  sig_s: Uint8Array;
  sig_v: number;
};

export type BridgeAsset = {
  chainID: number;
  contractAddress: `0x${string}`;
  decimals: number;
  eoaBalance: Decimal;
  ephemeralBalance: Decimal;
};

export type SBCCall = {
  data: Uint8Array;
  to_addr: Uint8Array;
  value: Uint8Array;
};

export type SBCTx = {
  address: Uint8Array;
  authorization_list: AuthorizationList[];
  calls: SBCCall[];
  chain_id: Uint8Array;
  deadline: Uint8Array;
  key_hash: Uint8Array;
  nonce: Uint8Array;
  revert_on_failure: boolean;
  signature: Uint8Array;
  universe: Universe;
};

export type SwapInput = {
  actualWallet: WalletClient;
  chainList: ChainListType;
  cosmos: {
    address: string;
    wallet: DirectSecp256k1Wallet;
  };
  destination: {
    amount?: bigint;
    chainID: number;
    token: `0x${string}`;
  };
  ephemeralWallet: PrivateKeyAccount;
  networkConfig: NetworkConfig;
  source?: {
    amount: bigint;
    chainID: number;
    token: `0x${string}`;
  };
};

export type SwapIntent = {
  destination: {
    amount: string;
    chain: {
      id: number;
      logo: string;
      name: string;
    };
    token: {
      contractAddress: Hex;
      decimals: number;
      symbol: string;
    };
  };
  sources: {
    amount: string;
    chain: {
      id: number;
      logo: string;
      name: string;
    };
    token: {
      contractAddress: Hex;
      decimals: number;
      symbol: string;
    };
  }[];
};

export type SwapOptionalParams = {
  emit: (stepID: string, step: unknown) => void;
  swapIntentHook?: (data: {
    allow: () => void;
    deny: () => void;
    intent: SwapIntent;
    refresh: () => Promise<SwapIntent>;
  }) => unknown;
};

export const CaliburSBCTypes = {
  BatchedCall: [
    { name: 'calls', type: 'Call[]' },
    { name: 'revertOnFailure', type: 'bool' },
  ],
  Call: [
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'data', type: 'bytes' },
  ],
  SignedBatchedCall: [
    { name: 'batchedCall', type: 'BatchedCall' },
    { name: 'nonce', type: 'uint256' },
    { name: 'keyHash', type: 'bytes32' },
    { name: 'executor', type: 'address' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

export type AnkrAsset = {
  balance: string;
  balanceRawInteger: string;
  balanceUsd: string;
  blockchain: string;
  contractAddress: `0x${string}`;
  holderAddress: `0x${string}`;
  thumbnail: string;
  tokenDecimals: number;
  tokenName: string;
  tokenPrice: string;
  tokenSymbol: string;
  tokenType: 'ERC20' | 'NATIVE';
};

export type AnkrBalances = {
  assets: {
    balance: string;
    balanceUSD: string;
    chainID: number;
    priceUSD: string;
    tokenAddress: `0x${string}`;
    tokenData: {
      decimals: number;
      icon: string;
      name: string;
      symbol: string;
    };
    universe: Universe;
  }[];
  totalBalanceInUSD: string;
};

export type Balances = {
  amount: string;
  chain_id: number;
  decimals: number;
  priceUSD: string;
  token_address: `0x${string}`;
  universe: Universe;
  value: number;
}[];

export type EoaToEphemeralCallMap = Record<
  number,
  {
    amount: bigint;
    decimals: number;
    tokenAddress: Hex;
  }
>;

export type RFFDepositCallMap = Record<
  number,
  {
    amount: bigint;
    tokenAddress: Hex;
    tx: Tx[];
  }
>;

export type RFFIntent = {
  destination: {
    amount: bigint;
    chainID: number;
    gasToken?: bigint;
    tokenContract: `0x${string}`;
  };
  fees: {
    caGas: bigint;
    collection: bigint;
    fulfilment: bigint;
    gasSupplied: bigint;
    protocol: bigint;
    solver: bigint;
  };
  isAvailableBalanceInsufficient: boolean;
  sources: {
    amount: bigint;
    chainID: number;
    tokenContract: `0x${string}`;
  }[];
};

export type Tx = {
  data: Hex;
  to: Hex;
  value: bigint;
};

export type SwapIntentHook = Parameters<Required<SwapOptionalParams>['swapIntentHook']>[0];

type BaseSwapInput = {
  toChainID: number;
  toTokenAddress: Hex;
};

type SWAP_ALL_IN = BaseSwapInput;

type SWAP_EXACT_IN = {
  fromAmount: bigint;
  fromChainID: number;
  fromTokenAddress: Hex;
} & BaseSwapInput;

type SWAP_EXACT_OUT = {
  toAmount: bigint;
} & BaseSwapInput;

export type SwapParams = SWAP_ALL_IN | SWAP_EXACT_IN | SWAP_EXACT_OUT;
