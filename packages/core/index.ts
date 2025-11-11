import { Buffer as BufferPolyfill } from 'buffer';
import processPolyfill from 'process';

if (typeof (globalThis as any).Buffer === 'undefined') {
  (globalThis as any).Buffer = BufferPolyfill;
}
if (typeof (globalThis as any).process === 'undefined') {
  (globalThis as any).process = processPolyfill;
}
if (typeof (globalThis as any).global === 'undefined') {
  (globalThis as any).global = globalThis as any;
}

// Core SDK entry point - headless, no React dependencies
export { NexusSDK } from './sdk/index';
export { NexusError, ERROR_CODES } from './sdk/ca-base/nexusError';
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
  BRIDGE_STEPS,
  SWAP_STEPS,
} from '@nexus/commons';

// Re-export everything from commons (includes constants, utils, and types)
export * from '@nexus/commons';
