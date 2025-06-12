import { SUPPORTED_CHAINS } from './constants';
import { Abi } from 'viem';
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
  RequestForFunds,
  SDKConfig,
  UserAsset,
} from '@arcana/ca-sdk';

type TokenInfo = {
  contractAddress: `0x${string}`;
  decimals: number;
  logo?: string;
  name: string;
  platform?: string;
  symbol: string;
};

type NexusNetwork = 'mainnet' | 'testnet';

export interface BlockTransaction {
  hash?: string;
  from?: string;
}

export interface Block {
  transactions?: BlockTransaction[];
}

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
  gas?: bigint;
}

export interface SimulationResult {
  intent: Intent;
  token: TokenInfo;
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

// Enhanced modular parameters for standalone deposit functionality
export interface DepositParams {
  toChainId: number;
  contractAddress: string;
  contractAbi: Abi;
  functionName: string;
  functionParams: readonly unknown[];
  value?: string;
  gasLimit?: string;
  maxGasPrice?: string;
  enableTransactionPolling?: boolean;
  transactionTimeout?: number;
  // Transaction receipt confirmation options
  waitForReceipt?: boolean;
  receiptTimeout?: number;
  requiredConfirmations?: number;
}

export interface DepositResult {
  transactionHash: string;
  explorerUrl: string;
  chainId: number;
  // Receipt information
  receipt?: TransactionReceipt;
  confirmations?: number;
  gasUsed?: string;
  effectiveGasPrice?: string;
}

export interface DepositSimulation {
  gasLimit: string;
  gasPrice: string;
  estimatedCost: string;
  estimatedCostEth: string;
  success: boolean;
  error?: string;
}

export interface BridgeAndDepositParams {
  toChainId: SUPPORTED_CHAINS_IDS;
  token: SUPPORTED_TOKENS;
  amount: string;
  recipient?: `0x${string}`;
  deposit?: Omit<DepositParams, 'toChainId'>;
  enableTransactionPolling?: boolean;
  transactionTimeout?: number;
  // Global options for transaction confirmation
  waitForReceipt?: boolean;
  receiptTimeout?: number;
  requiredConfirmations?: number;
}

export interface BridgeAndDepositResult {
  depositTransactionHash?: string;
  depositExplorerUrl?: string;
  toChainId: number;
}

export interface DepositEvents {
  'deposit:started': (params: { chainId: number; contractAddress: string }) => void;
  'deposit:completed': (result: DepositResult) => void;
  'deposit:failed': (error: { message: string; code?: string }) => void;
}

export interface BridgeEvents {
  'bridge:started': (params: { toChainId: number; tokenAddress: string; amount: string }) => void;
  'bridge:completed': (result: { result: unknown }) => void;
  'bridge:failed': (error: { message: string; code?: string }) => void;
}

export interface BridgeAndDepositEvents extends BridgeEvents, DepositEvents {
  'operation:started': (params: { toChainId: number; hasDeposit: boolean }) => void;
  'operation:completed': (result: BridgeAndDepositResult) => void;
  'operation:failed': (error: {
    message: string;
    stage: 'bridge' | 'deposit';
    code?: string;
  }) => void;
}

/**
 * Smart contract call parameters
 */
export interface ContractCallParams {
  to: `0x${string}`;
  data: `0x${string}`;
  value?: bigint;
  gas?: bigint;
  gasPrice?: bigint;
}

// New transaction receipt interface
export interface TransactionReceipt {
  blockHash: string;
  blockNumber: string;
  transactionHash: string;
  transactionIndex: string;
  from: string;
  to: string;
  gasUsed: string;
  effectiveGasPrice: string;
  status: string;
  logs: Array<{
    address: string;
    topics: string[];
    data: string;
    blockNumber: string;
    transactionHash: string;
    transactionIndex: string;
    blockHash: string;
    logIndex: string;
  }>;
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
  UserAsset,
  TokenInfo,
  RequestForFunds,
  SDKConfig,
  NexusNetwork,
};
