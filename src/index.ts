import { IntentStatus as DomainIntentStatus } from './domain';

export { AnalyticsManager } from './analytics/AnalyticsManager';
export { NexusAnalyticsEvents } from './analytics/events';
export type { AnalyticsConfig, DevTimingConfig, SpanProperties } from './analytics/types';

export { createNexusClient } from './core/sdk/client';
export type {
  BridgeAndExecuteOptions,
  BridgeOperationOptions,
  IntentOperationOptions,
  NexusClient,
  SwapAndExecuteOptions,
  SwapOperationOptions,
} from './core/types';

export { getFallbackTokenLogoDataUri } from './services/token-logo';

export const IntentStatus = DomainIntentStatus;
export type IntentStatus = import('./intent/types').IntentLifecycleStatus;

export type {
  BridgeAndExecuteParams,
  BridgeParams,
  Chain,
  ChainListType,
  ChainMetadata,
  EthereumProvider,
  ExecuteFeeParams,
  ExecuteParams,
  ExecuteResult,
  ExecuteSimulation,
  ListIntentsParams,
  NexusNetwork,
  OnEventParam,
  RequestArguments,
  TokenInfo,
  TokenMetadata,
  TransferParams,
  TxResult,
} from './domain';
export type {
  BackendService,
  ErrorCategory,
  ErrorCode,
  ErrorContext,
  ExecutionService,
  ExternalServiceService,
  OperationName,
  ServiceFor,
  SimulationService,
  UserActionService,
} from './domain/errors';
export {
  BackendError,
  ERROR_CODES,
  ExecutionError,
  ExternalServiceError,
  InternalError,
  NexusError,
  SimulationError,
  UserActionError,
  ValidationError,
} from './domain/errors';
// Stable high-level names now share the API-backed Better Intent model.
export type {
  BridgeAndExecuteIntentResult,
  BridgeAndExecuteIntentResult as BridgeAndExecuteResult,
  IntentAllowance,
  IntentAllowanceHookData,
  IntentAllowanceSelection,
  IntentAndExecuteSimulationResult as BridgeAndExecuteSimulationResult,
  IntentAndExecuteSimulationResult as SwapAndExecuteSimulationResult,
  IntentBalance,
  IntentBalancesResult,
  IntentChain,
  IntentEvent,
  IntentFees,
  IntentHistoryQuery,
  IntentHistoryRecord,
  IntentHistoryRecord as IntentRecord,
  IntentHistoryResult,
  IntentHistoryResult as ListIntentsResult,
  IntentHookData,
  IntentLifecycleStatus,
  IntentPlan,
  IntentPlanStep,
  IntentProvider,
  IntentProviderSupport,
  IntentQuote,
  IntentQuote as BridgeSimulationResult,
  IntentQuote as SwapSimulationResult,
  IntentQuoteInput,
  IntentResult,
  IntentResult as BridgeResult,
  IntentResult as SwapResult,
  IntentResult as TransferResult,
  IntentSource,
  IntentStatus as IntentStatusResponse,
  IntentStepState,
  IntentToken,
  IntentTradeType,
  IntentTransaction,
  SwapAndExecuteIntentResult,
  SwapAndExecuteIntentResult as SwapAndExecuteResult,
} from './intent/types';
export type {
  Source,
  SwapAndExecuteParams,
  SwapExactInParams,
  SwapExactOutParams,
  SwapExecuteParams,
} from './swap/types';
