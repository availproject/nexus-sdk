import type { Quote, Universe } from '@avail-project/ca-common';
import type { DirectSecp256k1Wallet } from '@cosmjs/proto-signing';
import type { SigningStargateClient } from '@cosmjs/stargate';
import type Decimal from 'decimal.js';
import type { Hex, PrivateKeyAccount, WalletClient } from 'viem';
import type { FlatBalance } from '../../swap/data';
import type { SwapRoute } from '../../swap/route';
import type { ChainListType, NetworkConfig, OnEventParam, QueryClients, TokenInfo } from '../index';

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
  /**
   * Balance held at the per-chain source execution target:
   * ephemeral on 7702 chains, Safe account on non-7702 chains.
   */
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

export type SafeExecuteTx = {
  baseGas: bigint;
  chainId: number;
  data: Hex;
  gasPrice: bigint;
  gasToken: Hex;
  nonce: bigint;
  operation: number;
  refundReceiver: Hex;
  safeAddress: Hex;
  safeTxGas: bigint;
  signature: Hex;
  to: Hex;
  value: bigint;
};

export type SafeAccountAddress = {
  address: Hex;
  exists: boolean;
  factoryAddress: Hex;
};

export type EnsureSafeAccountInput = {
  chainId: number;
  deadline: bigint;
  owner: Hex;
  safeAddress: Hex;
  saltNonce: bigint;
  signature: Hex;
};

export type EnsureSafeAccountResult = {
  address: Hex;
  deployTxHash: Hex | null;
  exists: boolean;
};

export type DestinationExecution = {
  address: Hex;
  entryPoint: Hex | null;
  factoryAddress?: Hex | null;
  /** Destination-only mode for direct COT handoff; source execution always uses 7702 or Safe. */
  mode: '7702' | 'safe_account' | 'direct_eoa';
};

export type SourceExecution = {
  address: Hex;
  entryPoint: Hex | null;
  factoryAddress?: Hex | null;
  /** Source execution always uses either the 7702-delegated ephemeral account or Safe. */
  mode: '7702' | 'safe_account';
};

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

export type SwapInput = SWAP_ALL_IN | SWAP_EXACT_IN | SWAP_EXACT_OUT;

export type InternalSwapInput = {
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
  eoaWallet: WalletClient;
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
    value?: string;
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
    gas: {
      amount: string;
      value?: string;
      token: {
        contractAddress: Hex;
        decimals: number;
        symbol: string;
      };
    };
  };
  feesAndBuffer: {
    buffer: string;
    bridge: {
      caGas: string;
      protocol: string;
      solver: string;
      total: string;
    } | null;
  };
  sources: {
    amount: string;
    value?: string;
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

export type OnSwapIntentHookData = {
  allow: () => void;
  deny: () => void;
  intent: SwapIntent;
  refresh: () => Promise<SwapIntent>;
};

export type OnSwapIntentHook = (data: OnSwapIntentHookData) => unknown;

export type SwapParams = {
  onSwapIntent: OnSwapIntentHook;
  chainList: ChainListType;
  address: {
    cosmos: string;
    eoa: Hex;
    ephemeral: Hex;
  };
  wallet: {
    cosmos: SigningStargateClient;
    ephemeral: PrivateKeyAccount;
    eoa: WalletClient;
  };
  intentExplorerUrl: string;
  preloadedBalances?: FlatBalance[];
} & OnEventParam &
  QueryClients;

export interface ExactInSwapInput {
  from: {
    chainId: number;
    amount?: bigint;
    tokenAddress: Hex;
  }[];
  toChainId: number;
  toTokenAddress: Hex;
}

export type MaxSwapInput = {
  toChainId: number;
  toTokenAddress: Hex;
  fromSources?: {
    chainId: number;
    tokenAddress: Hex;
  }[];
};

export type MaxSwapResult = {
  toChainId: number;
  toTokenAddress: Hex;
  maxAmount: string;
  maxAmountRaw: bigint;
  symbol: string;
  decimals: number;
  sources: {
    chainId: number;
    tokenAddress: Hex;
    symbol: string;
    decimals: number;
    amount: string;
  }[];
};

export type Source = {
  tokenAddress: Hex;
  chainId: number;
};

export interface ExactOutSwapInput {
  fromSources?: Source[];
  toChainId: number;
  toTokenAddress: Hex;
  toAmount: bigint;
  toNativeAmount?: bigint;
}

export enum SwapMode {
  EXACT_IN = 0,
  EXACT_OUT = 1,
}

export type SwapData =
  | {
      mode: SwapMode.EXACT_IN;
      data: ExactInSwapInput;
    }
  | { mode: SwapMode.EXACT_OUT; data: ExactOutSwapInput };

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

export type AnkrBalance = {
  balance: string;
  balanceUSD: string;
  chainID: number;
  error?: boolean;
  tokenAddress: `0x${string}`;
  tokenData: {
    decimals: number;
    icon: string;
    name: string;
    symbol: string;
  };
  universe: Universe;
};

export type AnkrBalances = AnkrBalance[];

export type Balances = {
  amount: string;
  chain_id: number;
  decimals: number;
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

export type SupportedChainsResult = {
  id: number;
  logo: string;
  name: string;
}[];

export type SupportedChainsAndTokensResult = {
  id: number;
  logo: string;
  name: string;
  tokens: TokenInfo[];
}[];

export type Tx = {
  data: Hex;
  to: Hex;
  value: bigint;
  gas?: bigint;
};

// export type UserAsset = {
//   abstracted?: boolean;
//   balance: bigint;
//   balanceInFiat: number;
//   breakdown: {
//     balance: bigint;
//     balanceInFiat: number;
//     chain: {
//       id: number;
//       logo: string;
//       name: string;
//     };
//     contractAddress: `0x${string}`;
//     isNative?: boolean;
//     universe: Universe;
//   }[];
//   decimals: number;
//   icon?: string;
//   local?: boolean;
//   priceInUsd?: string;
//   symbol: string;
// };

export type Swap = {
  inputAmount: bigint;
  inputContract: Hex;
  inputDecimals: number;
  outputAmount: bigint;
  outputContract: Hex;
  outputDecimals: number;
};

export type ChainSwap = {
  chainId: number;
  swaps: Swap[];
  txHash: Hex;
};

export type SuccessfulSwapResult = {
  sourceSwaps: ChainSwap[];
  explorerURL: string;
  destinationSwap: ChainSwap | null;
  swapRoute?: SwapRoute;
};

export type SwapResult =
  | {
      success: true;
      result: SuccessfulSwapResult;
    }
  | { success: false; error: string };

export type ISwap = {
  input: Quote['input'];
  output: Quote['output'];
  txData: Quote['txData'];
};
