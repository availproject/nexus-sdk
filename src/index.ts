import { IntentStatus as DomainIntentStatus } from './domain';

export { AnalyticsManager } from './analytics/AnalyticsManager';
export { NexusAnalyticsEvents } from './analytics/events';
export type { AnalyticsConfig, DevTimingConfig, SpanProperties } from './analytics/types';

export { createNexusClient } from './core/sdk/client';
export type {
  IntentOperationOptions,
  NexusClient,
  SwapAndExecuteOptions,
  SwapOperationOptions,
} from './core/types';
export { getIntentQuoteFailure } from './intent/errors';
export { getFallbackTokenLogoDataUri } from './services/token-logo';

export const IntentStatus = DomainIntentStatus;
export type IntentStatus = import('./intent/types').IntentLifecycleStatus;

export type {
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
  IntentAllowance,
  IntentAndExecuteSimulationResult as SwapAndExecuteSimulationResult,
  IntentBalance,
  IntentBalancesResult,
  IntentChain,
  IntentChainMetadata,
  IntentDestinationTokenPage,
  IntentEvent,
  IntentFees,
  IntentHistoryQuery,
  IntentHistoryRecord,
  IntentHistoryRecord as IntentRecord,
  IntentHistoryResult,
  IntentHistoryResult as ListIntentsResult,
  IntentHookData,
  IntentLegStatus,
  IntentLifecycleStatus,
  IntentPlan,
  IntentPlanStep,
  IntentProvider,
  IntentProviderSupport,
  IntentQuote,
  IntentQuote as SwapSimulationResult,
  IntentQuoteFailure,
  IntentQuoteFailureSubcode,
  IntentQuoteInput,
  IntentResult,
  IntentResult as SwapResult,
  IntentRouteConstraintLeg,
  IntentRouteConstraints,
  IntentSource,
  IntentSourceTokenPage,
  IntentSourceUnroutableReason,
  IntentSourceVerdict,
  IntentStatus as IntentStatusResponse,
  IntentStepError,
  IntentStepState,
  IntentToken,
  IntentTokenPage,
  IntentTokenQuery,
  IntentTradeType,
  IntentTransaction,
  ProviderTokenGroup,
  SwapAndExecuteIntentResult,
  SwapAndExecuteIntentResult as SwapAndExecuteResult,
  TokenRef,
} from './intent/types';
export type {
  Source,
  SwapAndExecuteParams,
  SwapExactInParams,
  SwapExactOutParams,
  SwapExecuteParams,
} from './swap/types';
