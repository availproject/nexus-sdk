import type { AnalyticsManager } from '../analytics/AnalyticsManager';
import type {
  BeforeExecuteHook,
  BridgeAndExecuteParams,
  BridgeParams,
  ChainListType,
  EthereumProvider,
  ExecuteParams,
  ExecuteResult,
  ExecuteSimulation,
  ListIntentsParams,
  OnEventParam,
  TransferParams,
} from '../domain';
import type {
  BridgeAndExecuteIntentResult,
  IntentAllowanceHookData,
  IntentAndExecuteSimulationResult,
  IntentBalance,
  IntentChain,
  IntentEvent,
  IntentHistoryResult,
  IntentHookData,
  IntentQuote,
  IntentResult,
  IntentRouteConstraints,
  SwapAndExecuteIntentResult,
} from '../intent/types';
import type { SwapAndExecuteParams, SwapExactInParams, SwapExactOutParams } from '../swap/types';
import type { NexusUtils } from './utils';

export type IntentOperationOptions = OnEventParam<IntentEvent> & {
  hooks?: {
    onIntent?: (data: IntentHookData) => void | Promise<void>;
    onAllowance?: (data: IntentAllowanceHookData) => void | Promise<void>;
  };
  slippageBps?: number | 'auto';
  fillTimeoutMinutes?: number;
  pollingIntervalMs?: number;
};

export type BridgeOperationOptions = IntentOperationOptions;

export type SwapOperationOptions = Omit<IntentOperationOptions, 'hooks'> & {
  hooks?: { onIntent?: (data: IntentHookData) => void | Promise<void> };
};

export type BridgeAndExecuteOptions = IntentOperationOptions & BeforeExecuteHook;
export type SwapAndExecuteOptions = SwapOperationOptions & BeforeExecuteHook;

export type NexusClient = {
  chainList: ChainListType;
  utils: NexusUtils;
  analytics: AnalyticsManager;
  initialize: () => Promise<void>;
  isSupportedChain: (chainId: number) => boolean;
  bridge: (params: BridgeParams, options?: BridgeOperationOptions) => Promise<IntentResult>;
  bridgeAndTransfer: (
    params: TransferParams,
    options?: BridgeOperationOptions
  ) => Promise<IntentResult>;
  simulateBridge: (params: BridgeParams, options?: BridgeOperationOptions) => Promise<IntentQuote>;
  simulateBridgeAndTransfer: (
    params: TransferParams,
    options?: BridgeOperationOptions
  ) => Promise<IntentQuote>;
  listIntents: (params?: ListIntentsParams) => Promise<IntentHistoryResult>;
  execute: (params: ExecuteParams, options?: OnEventParam) => Promise<ExecuteResult>;
  simulateExecute: (params: ExecuteParams) => Promise<ExecuteSimulation>;
  bridgeAndExecute: (
    params: BridgeAndExecuteParams,
    options?: BridgeAndExecuteOptions
  ) => Promise<BridgeAndExecuteIntentResult>;
  simulateBridgeAndExecute: (
    params: BridgeAndExecuteParams,
    options?: BridgeAndExecuteOptions
  ) => Promise<IntentAndExecuteSimulationResult>;
  getBalancesForBridge: () => Promise<IntentBalance[]>;
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
