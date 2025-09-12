import { SUPPORTED_CHAINS } from '../constants';
import { Abi, Hex, TransactionReceipt } from 'viem';
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
  SwapIntent,
  SwapStep,
  SwapSupportedChainsResult,
} from '@arcana/ca-sdk';
import * as ServiceTypes from './service-types';
import { FeeUniverse } from '@arcana/ca-sdk/dist/types/typings';

interface SwapOptionalParams {
  emit: (stepID: string, step: SwapStep) => void;
  swapIntentHook?: (data: SwapIntentHook) => unknown;
}

interface SwapIntentHook {
  allow: () => void;
  deny: () => void;
  intent: SwapIntent;
  refresh: () => Promise<SwapIntent>;
}

type BaseSwapInput = {
  toChainID: number;
  toTokenAddress: Hex;
};

type SwapInput =
  | BaseSwapInput
  | ({
      fromAmount: bigint;
      fromChainID: number;
      fromTokenAddress: Hex;
    } & BaseSwapInput)
  | ({
      toAmount: bigint;
    } & BaseSwapInput);

type TokenInfo = {
  contractAddress: `0x${string}`;
  decimals: number;
  logo?: string;
  name: string;
  platform?: string;
  symbol: string;
};

type SwapBalances = {
  assets: UserAsset[];
  balances: {
    amount: string;
    chain_id: number;
    decimals: number;
    priceUSD: string;
    token_address: `0x${string}`;
    universe: FeeUniverse;
    value: number;
  }[];
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
 * Dynamic parameter builder function for building function parameters at execution time
 * This allows for dynamic parameter generation based on actual bridged amounts and user context
 */
export type DynamicParamBuilder = (
  token: SUPPORTED_TOKENS,
  amount: string,
  chainId: SUPPORTED_CHAINS_IDS,
  userAddress: `0x${string}`,
) => {
  functionParams: readonly unknown[];
  /** ETH value in wei (string). Omit or '0' for ERC-20 calls */
  value?: string;
};

/**
 * Parameters for bridging tokens between chains.
 */
export interface BridgeParams {
  token: SUPPORTED_TOKENS;
  amount: number | string;
  chainId: SUPPORTED_CHAINS_IDS;
  gas?: bigint;
}

/**
 * Result structure for bridge transactions.
 */
export interface BridgeResult {
  success: boolean;
  error?: string;
  explorerUrl?: string;
  transactionHash?: string; // Add transaction hash property
}

/**
 * Result structure for swap transactions.
 */
export interface SwapResult {
  success: boolean;
  error?: string;
  explorerUrl?: string;
  transactionHash?: string; // Add transaction hash property
}

/**
 * Result structure for transfer transactions.
 */
export interface TransferResult {
  success: boolean;
  error?: string;
  explorerUrl?: string;
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

// Enhanced modular parameters for execute functionality with dynamic parameter building
export interface ExecuteParams {
  toChainId: SUPPORTED_CHAINS_IDS;
  contractAddress: string;
  contractAbi: Abi;
  functionName: string;
  buildFunctionParams: DynamicParamBuilder;
  value?: string; // Can be overridden by callback
  enableTransactionPolling?: boolean;
  transactionTimeout?: number;
  // Transaction receipt confirmation options
  waitForReceipt?: boolean;
  receiptTimeout?: number;
  requiredConfirmations?: number;
  tokenApproval?: {
    token: SUPPORTED_TOKENS;
    amount: string;
  };
  /**
   * Optional approval buffer in basis points (bps). Defaults to 100 (1%).
   * Use 0 to disable buffer (e.g., for bridge+execute flows where exact balances are used).
   */
  approvalBufferBps?: number;
}

export interface ExecuteResult {
  transactionHash: string;
  explorerUrl: string;
  chainId: number;
  // Receipt information
  receipt?: TransactionReceipt;
  confirmations?: number;
  gasUsed?: string;
  effectiveGasPrice?: string;
  approvalTransactionHash?: string;
}

export interface ExecuteSimulation {
  contractAddress: string;
  functionName: string;
  gasUsed: string;
  success: boolean;
  error?: string;
  gasCostEth?: string;
}

// New types for improved approval simulation
export interface ApprovalInfo {
  needsApproval: boolean;
  currentAllowance: bigint;
  requiredAmount: bigint;
  tokenAddress?: string;
  spenderAddress: string;
  token: SUPPORTED_TOKENS;
  chainId: number;
  hasPendingApproval?: boolean;
}

export interface ApprovalSimulation {
  gasUsed: string;
  gasPrice: string;
  totalFee: string;
  success: boolean;
  error?: string;
}

export interface SimulationStep {
  type: 'bridge' | 'approval' | 'execute';
  required: boolean;
  simulation: SimulationResult | ApprovalSimulation | ExecuteSimulation;
  description: string;
}

interface SimulationMetadata {
  contractAddress: string;
  functionName: string;
  bridgeReceiveAmount: string;
  bridgeFee: string;
  inputAmount: string;
  optimalBridgeAmount?: string;
  targetChain: number;
  approvalRequired: boolean;
  bridgeSkipped?: boolean;
  token?: SUPPORTED_TOKENS;
}

export interface BridgeAndExecuteSimulationResult {
  steps: SimulationStep[];
  bridgeSimulation: SimulationResult | null;
  executeSimulation?: ExecuteSimulation;
  totalEstimatedCost?: {
    total: string;
    breakdown: {
      bridge: string;
      execute: string;
    };
  };
  success: boolean;
  error?: string;
  metadata?: SimulationMetadata;
}

export interface BridgeAndExecuteParams {
  toChainId: SUPPORTED_CHAINS_IDS;
  token: SUPPORTED_TOKENS;
  amount: number | string;
  recipient?: `0x${string}`;
  execute?: Omit<ExecuteParams, 'toChainId'>;
  enableTransactionPolling?: boolean;
  transactionTimeout?: number;
  // Global options for transaction confirmation
  waitForReceipt?: boolean;
  receiptTimeout?: number;
  requiredConfirmations?: number;
  // Optional recent approval transaction hash to consider in simulation
  recentApprovalTxHash?: string;
}

export interface BridgeAndExecuteResult {
  executeTransactionHash?: string;
  executeExplorerUrl?: string;
  approvalTransactionHash?: string;
  bridgeTransactionHash?: string; // undefined when bridge is skipped
  bridgeExplorerUrl?: string; // undefined when bridge is skipped
  toChainId: number;
  success: boolean;
  error?: string;
  bridgeSkipped: boolean; // indicates if bridge was skipped due to sufficient funds
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

export type {
  ServiceTypes,
  OnIntentHook,
  OnAllowanceHookData,
  OnIntentHookData,
  OnAllowanceHook,
  EthereumProvider,
  RequestArguments,
  ProgressStep,
  ProgressSteps,
  Intent,
  onAllowanceHookSource as AllowanceHookSource,
  Network,
  UserAsset,
  TokenInfo,
  RequestForFunds,
  SDKConfig,
  NexusNetwork,
  TransactionReceipt,
  SwapInput,
  SwapIntent,
  SwapOptionalParams,
  SwapStep,
  SwapIntentHook,
  SwapBalances,
  SwapSupportedChainsResult,
};
