import './_polyfill';

export { Environment } from '@avail-project/ca-common';
// Analytics exports
export { AnalyticsManager } from './analytics/AnalyticsManager';
export { NexusAnalyticsEvents } from './analytics/events';
export type {
  AnalyticsProvider,
  BalanceProperties,
  BaseEventProperties,
  ErrorProperties,
  PerformanceProperties,
  SessionProperties,
  TransactionProperties,
  WalletProperties,
} from './analytics/types';
// Re-export types from commons for convenience
export type {
  AllowanceHookSource,
  AllowanceResponse,
  AssetBreakdown,
  BridgeAndExecuteParams,
  BridgeAndExecuteResult,
  BridgeAndExecuteSimulationResult,
  BridgeParams,
  BridgeResult,
  ChainMetadata,
  DynamicParamBuilder,
  EthereumProvider,
  EventListener,
  ExecuteParams,
  ExecuteResult,
  ExecuteSimulation,
  NexusNetwork,
  OnAllowanceHook,
  OnAllowanceHookData,
  OnIntentHook,
  OnIntentHookData,
  RequestArguments,
  RequestForFunds,
  SimulationResult,
  SUPPORTED_CHAINS_IDS,
  SUPPORTED_TOKENS,
  TokenMetadata,
  TransferParams,
  TransferResult,
  UserAsset,
} from './commons';
// Re-export everything from commons (includes constants, utils, and types)
export * from './commons';
export {
  BRIDGE_STEPS,
  CHAIN_METADATA,
  DESTINATION_SWAP_TOKENS,
  MAINNET_CHAINS,
  NEXUS_EVENTS,
  SUPPORTED_CHAINS,
  SWAP_STEPS,
  TESTNET_CHAINS,
  TESTNET_TOKEN_METADATA,
  TOKEN_CONTRACT_ADDRESSES,
  TOKEN_METADATA,
} from './commons';
export { ERROR_CODES, NexusError, NexusErrorData } from './sdk/ca-base/nexusError';
// Core SDK entry point - headless, no React dependencies
export { NexusSDK } from './sdk/index';
// Utility exports (direct access without sdk instance)
export {
  formatTokenBalance,
  formatTokenBalanceParts,
  formatUnits,
  getCoinbaseRates,
  getSupportedChains,
  isSupportedToken,
  isValidAddress,
  parseUnits,
  truncateAddress,
} from './sdk/utils';
