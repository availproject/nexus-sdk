import { SUPPORTED_CHAINS } from './constants';
import { Abi, TransactionReceipt } from 'viem';
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
  RFF,
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

// ===== TELEMETRY TYPES =====

/**
 * Telemetry event types for tracking user interactions and system events
 */
export type TelemetryEventType = 
  | 'sdk_initialized'
  | 'sdk_error'
  | 'user_connected'
  | 'user_disconnected'
  | 'chain_switched'
  | 'account_changed'
  | 'transaction_started'
  | 'transaction_completed'
  | 'transaction_failed'
  | 'transaction_simulated'
  | 'bridge_initiated'
  | 'bridge_completed'
  | 'bridge_failed'
  | 'transfer_initiated'
  | 'transfer_completed'
  | 'transfer_failed'
  | 'execute_initiated'
  | 'execute_completed'
  | 'execute_failed'
  | 'approval_requested'
  | 'approval_granted'
  | 'approval_denied'
  | 'balance_checked'
  | 'gas_estimated'
  | 'simulation_requested'
  | 'ui_component_rendered'
  | 'ui_interaction'
  | 'error_occurred'
  | 'performance_metric'
  | 'feature_used'
  | 'network_request'
  | 'network_response'
  | 'cache_hit'
  | 'cache_miss'
  | 'wallet_connected'
  | 'wallet_disconnected'
  | 'wallet_switched'
  | 'modal_opened'
  | 'modal_closed'
  | 'button_clicked'
  | 'form_submitted'
  | 'validation_error'
  | 'retry_attempted'
  | 'fallback_used'
  | 'timeout_occurred'
  | 'rate_limit_hit'
  | 'unsupported_feature'
  | 'deprecated_feature_used'
  | 'experimental_feature_used'
  | 'analytics_consent_changed'
  | 'privacy_settings_changed'
  | 'telemetry_enabled'
  | 'telemetry_disabled';

/**
 * Telemetry event severity levels
 */
export type TelemetrySeverity = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * Telemetry event categories for better organization
 */
export type TelemetryCategory = 
  | 'sdk_lifecycle'
  | 'user_interaction'
  | 'transaction'
  | 'bridge'
  | 'transfer'
  | 'execute'
  | 'approval'
  | 'wallet'
  | 'ui'
  | 'network'
  | 'performance'
  | 'error'
  | 'analytics'
  | 'privacy'
  | 'experimental';

/**
 * Base telemetry event structure
 */
export interface TelemetryEvent {
  id: string;
  timestamp: number;
  type: TelemetryEventType;
  category: TelemetryCategory;
  severity: TelemetrySeverity;
  sessionId: string;
  userId?: string;
  walletAddress?: string;
  chainId?: number;
  network?: 'mainnet' | 'testnet';
  version: string;
  environment: 'development' | 'staging' | 'production';
  data: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  tags?: string[];
  source?: string;
  correlationId?: string;
  parentEventId?: string;
  duration?: number;
  error?: {
    message: string;
    code?: string;
    stack?: string;
    context?: Record<string, unknown>;
  };
}

/**
 * User interaction telemetry data
 */
export interface UserInteractionData {
  component: string;
  action: string;
  element?: string;
  value?: string | number | boolean;
  coordinates?: { x: number; y: number };
  viewport?: { width: number; height: number };
  userAgent?: string;
  referrer?: string;
  pageUrl?: string;
  timeOnPage?: number;
  interactionPath?: string[];
}

/**
 * Transaction telemetry data
 */
export interface TransactionData {
  transactionHash?: string;
  fromAddress: string;
  toAddress?: string;
  value?: string;
  gasLimit?: string;
  gasPrice?: string;
  gasUsed?: string;
  nonce?: number;
  blockNumber?: string;
  confirmations?: number;
  status: 'pending' | 'confirmed' | 'failed' | 'reverted';
  errorMessage?: string;
  retryCount?: number;
  timeout?: number;
  chainId: number;
  tokenSymbol?: string;
  tokenAmount?: string;
  feeAmount?: string;
  feeCurrency?: string;
  explorerUrl?: string;
  estimatedCost?: string;
  actualCost?: string;
  costDifference?: string;
  slippage?: string;
  route?: string[];
  bridgeProvider?: string;
  executionTime?: number;
  confirmationTime?: number;
}

/**
 * Bridge telemetry data
 */
export interface BridgeData extends TransactionData {
  sourceChainId: number;
  destinationChainId: number;
  bridgeProvider: string;
  bridgeFee: string;
  bridgeTime?: number;
  bridgeStatus: 'initiated' | 'pending' | 'completed' | 'failed';
  bridgeTransactionHash?: string;
  destinationTransactionHash?: string;
  bridgeRoute?: string[];
  bridgeQuote?: {
    inputAmount: string;
    outputAmount: string;
    fee: string;
    slippage: string;
    estimatedTime: number;
  };
}

/**
 * Performance telemetry data
 */
export interface PerformanceData {
  metric: string;
  value: number;
  unit: string;
  threshold?: number;
  exceeded?: boolean;
  context?: Record<string, unknown>;
  breakdown?: Record<string, number>;
  percentiles?: {
    p50: number;
    p90: number;
    p95: number;
    p99: number;
  };
}

/**
 * Error telemetry data
 */
export interface ErrorData {
  errorType: string;
  errorCode?: string;
  errorMessage: string;
  stackTrace?: string;
  context?: Record<string, unknown>;
  userAction?: string;
  recoverable: boolean;
  retryable: boolean;
  fallbackUsed?: boolean;
  errorBoundary?: string;
  componentStack?: string;
}

/**
 * Network telemetry data
 */
export interface NetworkData {
  url: string;
  method: string;
  statusCode?: number;
  responseTime: number;
  requestSize?: number;
  responseSize?: number;
  headers?: Record<string, string>;
  error?: string;
  retryCount?: number;
  timeout?: number;
  endpoint?: string;
  apiVersion?: string;
}

/**
 * Wallet telemetry data
 */
export interface WalletData {
  walletType: string;
  walletVersion?: string;
  connectionMethod: string;
  supportedChains?: number[];
  supportedTokens?: string[];
  accountCount?: number;
  isHardwareWallet?: boolean;
  isMultiSig?: boolean;
  connectionTime?: number;
  disconnectReason?: string;
  switchReason?: string;
  previousWallet?: string;
  newWallet?: string;
}

/**
 * UI telemetry data
 */
export interface UIData {
  component: string;
  variant?: string;
  size?: string;
  theme?: string;
  locale?: string;
  accessibility?: {
    screenReader?: boolean;
    highContrast?: boolean;
    reducedMotion?: boolean;
  };
  viewport: {
    width: number;
    height: number;
    devicePixelRatio: number;
  };
  interaction: {
    type: string;
    target: string;
    timestamp: number;
    duration?: number;
  };
  modal?: {
    type: string;
    trigger: string;
    duration: number;
    result?: string;
  };
}

/**
 * Telemetry configuration options
 */
export interface TelemetryConfig {
  enabled: boolean;
  endpoint?: string;
  apiKey?: string;
  projectId?: string;
  environment: 'development' | 'staging' | 'production';
  version: string;
  sessionId: string;
  userId?: string;
  walletAddress?: string;
  chainId?: number;
  network?: 'mainnet' | 'testnet';
  sampleRate?: number; // 0-1, percentage of events to send
  batchSize?: number; // Number of events to batch before sending
  batchTimeout?: number; // Time in ms to wait before sending batch
  maxRetries?: number; // Maximum number of retry attempts
  retryDelay?: number; // Delay between retries in ms
  timeout?: number; // Request timeout in ms
  enableDebug?: boolean; // Enable debug logging
  enableConsole?: boolean; // Enable console logging
  enableLocalStorage?: boolean; // Enable local storage caching
  enableSessionStorage?: boolean; // Enable session storage caching
  enableIndexedDB?: boolean; // Enable IndexedDB caching
  privacySettings?: {
    trackUserInteractions?: boolean;
    trackTransactions?: boolean;
    trackErrors?: boolean;
    trackPerformance?: boolean;
    trackNetwork?: boolean;
    trackWallet?: boolean;
    trackUI?: boolean;
    anonymizeData?: boolean;
    maskAddresses?: boolean;
    maskBalances?: boolean;
  };
  filters?: {
    includeEvents?: TelemetryEventType[];
    excludeEvents?: TelemetryEventType[];
    includeCategories?: TelemetryCategory[];
    excludeCategories?: TelemetryCategory[];
    minSeverity?: TelemetrySeverity;
  };
  transformers?: {
    beforeSend?: (event: TelemetryEvent) => TelemetryEvent | null;
    afterSend?: (event: TelemetryEvent, response: unknown) => void;
  };
  hooks?: {
    onEventCreated?: (event: TelemetryEvent) => void;
    onEventSent?: (event: TelemetryEvent, response: unknown) => void;
    onEventFailed?: (event: TelemetryEvent, error: Error) => void;
    onBatchSent?: (events: TelemetryEvent[], response: unknown) => void;
    onBatchFailed?: (events: TelemetryEvent[], error: Error) => void;
  };
}

/**
 * Telemetry client interface
 */
export interface TelemetryClient {
  // Configuration
  configure(config: TelemetryConfig): void;
  isEnabled(): boolean;
  enable(): void;
  disable(): void;
  
  // Event tracking
  track(eventType: TelemetryEventType, data?: Record<string, unknown>): void;
  trackUserInteraction(component: string, action: string, data?: Partial<UserInteractionData>): void;
  trackTransaction(transactionData: Partial<TransactionData>): void;
  trackBridge(bridgeData: Partial<BridgeData>): void;
  trackError(error: Error, context?: Record<string, unknown>): void;
  trackPerformance(metric: string, value: number, unit?: string): void;
  trackNetwork(url: string, method: string, responseTime: number, statusCode?: number): void;
  trackWallet(walletData: Partial<WalletData>): void;
  trackUI(uiData: Partial<UIData>): void;
  
  // Session management
  setSessionId(sessionId: string): void;
  setUserId(userId: string): void;
  setWalletAddress(address: string): void;
  setChainId(chainId: number): void;
  setNetwork(network: 'mainnet' | 'testnet'): void;
  
  // Privacy and consent
  setPrivacySettings(settings: Partial<TelemetryConfig['privacySettings']>): void;
  setAnalyticsConsent(consent: boolean): void;
  setTelemetryConsent(consent: boolean): void;
  
  // Batching and flushing
  flush(): Promise<void>;
  flushImmediate(): Promise<void>;
  
  // Utility methods
  generateEventId(): string;
  generateSessionId(): string;
  getSessionId(): string;
  getUserId(): string | undefined;
  getWalletAddress(): string | undefined;
  getChainId(): number | undefined;
  getNetwork(): 'mainnet' | 'testnet' | undefined;
  
  // Cleanup
  destroy(): Promise<void>;
}

/**
 * Telemetry event builder for fluent API
 */
export interface TelemetryEventBuilder {
  setType(type: TelemetryEventType): TelemetryEventBuilder;
  setCategory(category: TelemetryCategory): TelemetryEventBuilder;
  setSeverity(severity: TelemetrySeverity): TelemetryEventBuilder;
  setData(data: Record<string, unknown>): TelemetryEventBuilder;
  addData(key: string, value: unknown): TelemetryEventBuilder;
  setMetadata(metadata: Record<string, unknown>): TelemetryEventBuilder;
  addMetadata(key: string, value: unknown): TelemetryEventBuilder;
  setTags(tags: string[]): TelemetryEventBuilder;
  addTag(tag: string): TelemetryEventBuilder;
  setSource(source: string): TelemetryEventBuilder;
  setCorrelationId(correlationId: string): TelemetryEventBuilder;
  setParentEventId(parentEventId: string): TelemetryEventBuilder;
  setDuration(duration: number): TelemetryEventBuilder;
  setError(error: Error, context?: Record<string, unknown>): TelemetryEventBuilder;
  setUser(userId: string, walletAddress?: string): TelemetryEventBuilder;
  setChain(chainId: number, network?: 'mainnet' | 'testnet'): TelemetryEventBuilder;
  track(): void;
  build(): TelemetryEvent;
}

/**
 * Telemetry batch for efficient sending
 */
export interface TelemetryBatch {
  events: TelemetryEvent[];
  timestamp: number;
  size: number;
  retryCount: number;
  maxRetries: number;
}

/**
 * Telemetry response from server
 */
export interface TelemetryResponse {
  success: boolean;
  eventIds: string[];
  batchId?: string;
  timestamp: number;
  errors?: Array<{
    eventId: string;
    error: string;
    code?: string;
  }>;
}

/**
 * Telemetry storage interface for caching
 */
export interface TelemetryStorage {
  set(key: string, value: unknown): Promise<void>;
  get(key: string): Promise<unknown>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
  keys(): Promise<string[]>;
  size(): Promise<number>;
}

/**
 * Telemetry transport interface for sending events
 */
export interface TelemetryTransport {
  send(events: TelemetryEvent[]): Promise<TelemetryResponse>;
  sendBatch(batch: TelemetryBatch): Promise<TelemetryResponse>;
  healthCheck(): Promise<boolean>;
}

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

// Enhanced modular parameters for standalone execute functionality
export interface ExecuteParams {
  toChainId: number;
  contractAddress: string;
  contractAbi: Abi;
  functionName: string;
  functionParams: readonly unknown[];
  value?: string;
  enableTransactionPolling?: boolean;
  transactionTimeout?: number;
  // Transaction receipt confirmation options
  waitForReceipt?: boolean;
  receiptTimeout?: number;
  requiredConfirmations?: number;
  tokenApproval: {
    token: SUPPORTED_TOKENS;
    amount: string;
  };
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
}

export interface ExecuteSimulation {
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
  metadata?: {
    bridgeReceiveAmount: string; // just like 0.01 no need for token symbols
    bridgeFee: string; // just like 0.001
    inputAmount: string; // just like 0.01
    targetChain: number;
    approvalRequired: boolean;
  };
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
  toChainId: number;
  success: boolean;
  error?: string;
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
  TransactionReceipt,
  RFF,
};
