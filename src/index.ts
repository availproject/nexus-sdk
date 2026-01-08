import './_polyfill';
// Core SDK entry point - headless, no React dependencies
export { NexusSDK } from './sdk/index';
export { NexusError, NexusErrorData, ERROR_CODES } from './sdk/ca-base/nexusError';
// Re-export types from commons for convenience
export type {
  BridgeParams,
  BridgeResult,
  TransferParams,
  TransferResult,
  ExecuteParams,
  DynamicParamBuilder,
  ExecuteResult,
  ExecuteSimulation,
  BridgeAndExecuteParams,
  BridgeAndExecuteResult,
  BridgeAndExecuteSimulationResult,
  AllowanceResponse,
  AllowanceHookSource,
  EthereumProvider,
  RequestArguments,
  EventListener,
  UserAsset,
  SimulationResult,
  RequestForFunds,
  NexusNetwork,
  OnIntentHook,
  OnIntentHookData,
  OnAllowanceHook,
  OnAllowanceHookData,
  SUPPORTED_CHAINS_IDS,
  SUPPORTED_TOKENS,
  ChainMetadata,
  TokenMetadata,
  AssetBreakdown,
} from './commons';

export {
  CHAIN_METADATA,
  SUPPORTED_CHAINS,
  TESTNET_CHAINS,
  TESTNET_TOKEN_METADATA,
  TOKEN_METADATA,
  NEXUS_EVENTS,
  MAINNET_CHAINS,
  TOKEN_CONTRACT_ADDRESSES,
  DESTINATION_SWAP_TOKENS,
  BRIDGE_STEPS,
  SWAP_STEPS,
} from './commons';

// Utility exports (direct access without sdk instance)
export {
  formatTokenBalance,
  formatTokenBalanceParts,
  truncateAddress,
  parseUnits,
  formatUnits,
  isValidAddress,
  getCoinbaseRates,
  getSupportedChains,
  isSupportedToken,
} from './sdk/utils';

// Re-export everything from commons (includes constants, utils, and types)
export * from './commons';

// Analytics exports
export { AnalyticsManager } from './analytics/AnalyticsManager';
export { NexusAnalyticsEvents } from './analytics/events';
export type {
  AnalyticsProvider,
  BaseEventProperties,
  WalletProperties,
  TransactionProperties,
  ErrorProperties,
  PerformanceProperties,
  SessionProperties,
  BalanceProperties,
} from './analytics/types';
