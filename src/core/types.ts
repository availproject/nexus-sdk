import type { AnalyticsManager } from '../analytics/AnalyticsManager';
import type {
  BeforeExecuteHook,
  ChainListType,
  EthereumProvider,
  ExecuteParams,
  ExecuteResult,
  ExecuteSimulation,
  ListIntentsParams,
  OnEventParam,
} from '../domain';
import type {
  IntentBalance,
  IntentChain,
  IntentEvent,
  IntentHistoryResult,
  IntentHookData,
  IntentResult,
  IntentRouteConstraints,
  SwapAndExecuteIntentResult,
} from '../intent/types';
import type { SwapAndExecuteParams, SwapExactInParams, SwapExactOutParams } from '../swap/types';
import type { NexusUtils } from './utils';

export type IntentOperationOptions = OnEventParam<IntentEvent> & {
  hooks?: {
    onIntent?: (data: IntentHookData) => void | Promise<void>;
  };
  slippageBps?: number | 'auto';
  fillTimeoutMinutes?: number;
  pollingIntervalMs?: number;
};

export type SwapOperationOptions = IntentOperationOptions;

export type SwapAndExecuteOptions = SwapOperationOptions & BeforeExecuteHook;

export type NexusClient = {
  chainList: ChainListType;
  utils: NexusUtils;
  analytics: AnalyticsManager;
  initialize: () => Promise<void>;
  isSupportedChain: (chainId: number) => boolean;
  listIntents: (params?: ListIntentsParams) => Promise<IntentHistoryResult>;
  execute: (params: ExecuteParams, options?: OnEventParam) => Promise<ExecuteResult>;
  simulateExecute: (params: ExecuteParams) => Promise<ExecuteSimulation>;
  getBalancesForSwap: () => Promise<IntentBalance[]>;
  swapWithExactIn: (
    input: SwapExactInParams,
    options?: SwapOperationOptions
  ) => Promise<IntentResult>;
  swapWithExactOut: (
    input: SwapExactOutParams,
    options?: SwapOperationOptions
  ) => Promise<IntentResult>;
  swapAndExecute: (
    input: SwapAndExecuteParams,
    options?: SwapAndExecuteOptions
  ) => Promise<SwapAndExecuteIntentResult>;
  setEVMProvider: (provider: EthereumProvider) => Promise<void>;
  hasEvmProvider: boolean;
  convertTokenReadableAmountToBigInt: (
    amount: string,
    tokenSymbol: string,
    chainId: number
  ) => bigint;
  getSupportedChains: () => IntentChain[];
  getSupportedChainsForRoute: (constraints: IntentRouteConstraints) => Promise<IntentChain[]>;
  destroy: () => void;
};
