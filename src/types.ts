import { SUPPORTED_CHAINS } from './constants';
import type {
  OnIntentHook,
  OnAllowanceHook,
  EthereumProvider,
  RequestArguments,
  ProgressStep,
  ProgressSteps,
  Intent,
  onAllowanceHookSource,
  Network,
} from '@arcana/ca-sdk';

// Enhanced chain metadata with comprehensive information
export interface ChainMetadata {
  id: number;
  name: string;
  shortName: string;
  logo: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  rpcUrls: string[];
  blockExplorerUrls: string[];
}

// Enhanced token metadata with comprehensive information
export interface TokenMetadata {
  symbol: string;
  name: string;
  decimals: number;
  icon: string;
  coingeckoId: string;
  isNative?: boolean;
}

type OnIntentHookData = {
  intent: Intent;
  allow: () => void;
  deny: () => void;
  refresh: () => Promise<Intent>;
};

type OnAllowanceHookData = {
  allow: (s: Array<'min' | 'max' | bigint | string>) => void;
  deny: () => void;
  sources: Array<onAllowanceHookSource>;
};

/**
 * Generic event listener type for CA SDK events
 */
export type EventListener = (...args: unknown[]) => void;

/**
 * Parameters for sending a transaction.
 */
export type PreSendTxParams = {
  to?: `0x${string}`;
  from?: `0x${string}`;
  value?: `0x${string}`;
  data?: `0x${string}`;
};

/**
 * Options for preprocessing a transaction.
 */
export interface PreProcessOptions {
  bridge: boolean;
  extraGas: bigint;
}

/**
 * Unified balance response structure for a token across chains.
 */
export interface UnifiedBalanceResponse {
  symbol: string;
  balance: string;
  balanceInFiat: number;
  decimals: number;
  icon?: string;
  breakdown: {
    chain: {
      id: number;
      name: string;
      logo: string;
    };
    network: 'evm';
    contractAddress: `0x${string}`;
    isNative?: boolean;
    balance: string;
    balanceInFiat: number;
  }[];
  abstracted?: boolean;
}

/**
 * Parameters for checking or setting token allowance.
 */
export interface AllowanceParams {
  tokens: string[];
  amount: number;
  chainId: (typeof SUPPORTED_CHAINS)[keyof typeof SUPPORTED_CHAINS];
}

/**
 * Response structure for token allowance.
 */
export interface AllowanceResponse {
  chainID: number;
  allowance: bigint;
  token: string;
}

export type SUPPORTED_TOKENS = 'ETH' | 'USDC' | 'USDT';
export type SUPPORTED_CHAINS_IDS = (typeof SUPPORTED_CHAINS)[keyof typeof SUPPORTED_CHAINS];

/**
 * Parameters for bridging tokens between chains.
 */
export interface BridgeParams {
  token: SUPPORTED_TOKENS;
  amount: number | string;
  chainId: SUPPORTED_CHAINS_IDS;
  gas?: string | number | bigint;
}

/**
 * Parameters for transferring tokens.
 */
export interface TransferParams {
  token: SUPPORTED_TOKENS;
  amount: number | string;
  chainId: SUPPORTED_CHAINS_IDS;
  recipient: `0x${string}`;
}

/**
 * Enhanced token balance information
 */
export interface TokenBalance {
  symbol: string;
  balance: string;
  formattedBalance: string;
  balanceInFiat?: number;
  chainId: number;
  contractAddress?: `0x${string}`;
  isNative?: boolean;
}

export type {
  OnIntentHook,
  OnAllowanceHook,
  EthereumProvider,
  RequestArguments,
  ProgressStep,
  ProgressSteps,
  Intent,
  OnIntentHookData,
  OnAllowanceHookData,
  onAllowanceHookSource as AllowanceHookSource,
  Network,
};
