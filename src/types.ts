import { SUPPORTED_CHAINS, SUPPORTED_TOKENS } from './constants';
import type {
  OnIntentHook,
  OnAllowanceHook,
  EthereumProvider,
  RequestArguments,
  ProgressStep,
  ProgressSteps,
} from '@arcana/ca-sdk';

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
  chainId: number;
  allowance: string;
  token: string;
}

/**
 * Parameters for bridging tokens between chains.
 */
export interface BridgeParams {
  token: (typeof SUPPORTED_TOKENS)[keyof typeof SUPPORTED_TOKENS];
  amount: number | string;
  chainId: (typeof SUPPORTED_CHAINS)[keyof typeof SUPPORTED_CHAINS];
  gas?: string | number | bigint;
}

/**
 * Parameters for transferring tokens.
 */
export interface TransferParams {
  token: (typeof SUPPORTED_TOKENS)[keyof typeof SUPPORTED_TOKENS];
  amount: number | string;
  chainId: (typeof SUPPORTED_CHAINS)[keyof typeof SUPPORTED_CHAINS];
  recipient: `0x${string}`;
}

export type {
  OnIntentHook,
  OnAllowanceHook,
  EthereumProvider,
  RequestArguments,
  ProgressStep,
  ProgressSteps,
};
