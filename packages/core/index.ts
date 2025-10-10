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
} from '@nexus/commons';

export type { SwapStep } from './sdk/ca-base';

// Re-export everything from commons (includes constants, utils, and types)
export * from '@nexus/commons';
