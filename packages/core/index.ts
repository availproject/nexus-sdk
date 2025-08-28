// Core SDK entry point - headless, no React dependencies
export { NexusSDK } from './sdk/index';

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
  ProgressStep,
  ProgressSteps,
} from '@nexus/commons';

// Re-export everything from commons (includes constants, utils, and types)
export * from '@nexus/commons';
