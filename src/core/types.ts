import type { AnalyticsManager } from '../analytics/AnalyticsManager';
import type { BridgeMaxParams, BridgeMaxResult } from '../bridge/types';
import type {
  BeforeExecuteHook,
  BridgeAndExecuteEvent,
  BridgeAndExecuteOnIntentHookData,
  BridgeAndExecuteParams,
  BridgeAndExecuteResult,
  BridgeAndExecuteSimulationResult,
  BridgeEvent,
  BridgeParams,
  BridgeResult,
  BridgeSimulationResult,
  ChainListType,
  EthereumProvider,
  ExecuteParams,
  ExecuteResult,
  ExecuteSimulation,
  ListIntentsParams,
  ListIntentsResult,
  OnAllowanceHook,
  OnEventParam,
  OnIntentHook,
  SupportedChainsAndTokensResult,
  SwapAndExecuteEvent,
  SwapAndExecuteOnIntentHookData,
  SwapEvent,
  TokenBalance,
  TransferParams,
  TransferResult,
} from '../domain';
import type {
  OnIntentHookData,
  SwapAndExecuteParams,
  SwapAndExecuteResult,
  SwapExactInParams,
  SwapExactOutParams,
  SwapMaxParams,
  SwapMaxResult,
  SwapResult,
} from '../swap/types';
import type { NexusUtils } from './utils';

export type HookOverrides = {
  onAllowance?: OnAllowanceHook;
  onIntent?: OnIntentHook;
};

export type BridgeOperationOptions = OnEventParam<BridgeEvent> & {
  hooks?: HookOverrides;
  fillTimeoutMinutes?: number;
};

export type BridgeAndExecuteOptions = OnEventParam<BridgeAndExecuteEvent> &
  BeforeExecuteHook & {
    fillTimeoutMinutes?: number;
    onIntent?: (data: BridgeAndExecuteOnIntentHookData) => void;
  };

export type SwapOperationOptions = OnEventParam<SwapEvent> & {
  hooks?: {
    onIntent?: (data: OnIntentHookData) => void;
  };
  slippageTolerance?: number;
};

export type SwapAndExecuteOptions = OnEventParam<SwapAndExecuteEvent> & {
  onIntent?: (data: SwapAndExecuteOnIntentHookData) => void;
  slippageTolerance?: number;
};

export type NexusClient = {
  chainList: ChainListType;
  utils: NexusUtils;
  analytics: AnalyticsManager;
  initialize: () => Promise<void>;
  isSupportedChain: (chainId: number) => boolean;
  bridge: (params: BridgeParams, options?: BridgeOperationOptions) => Promise<BridgeResult>;
  bridgeAndTransfer: (
    params: TransferParams,
    options?: BridgeOperationOptions
  ) => Promise<TransferResult>;
  simulateBridge: (params: BridgeParams) => Promise<BridgeSimulationResult>;
  simulateBridgeAndTransfer: (params: TransferParams) => Promise<BridgeAndExecuteSimulationResult>;
  listIntents: (params?: ListIntentsParams) => Promise<ListIntentsResult>;
  execute: (params: ExecuteParams, options?: OnEventParam) => Promise<ExecuteResult>;
  simulateExecute: (params: ExecuteParams) => Promise<ExecuteSimulation>;
  /**
   * Orchestrates two distinct operations in sequence — NOT a single atomic transaction:
   *
   * 1. Bridge (conditional) — funds the shortfall on the destination chain. Skipped when the
   *    destination already holds enough of the token (`result.bridgeSkipped === true`).
   * 2. Execute + approval (execute always, approval optional) — the contract call, preceded by
   *    an optional token approval, is always sent from the user's connected wallet on the
   *    destination chain.
   *
   * The steps succeed or fail independently: a failed execute does not roll back the bridge —
   * the bridged funds remain in the user's wallet on the destination chain.
   */
  bridgeAndExecute: (
    params: BridgeAndExecuteParams,
    options?: BridgeAndExecuteOptions
  ) => Promise<BridgeAndExecuteResult>;
  simulateBridgeAndExecute: (
    params: BridgeAndExecuteParams
  ) => Promise<BridgeAndExecuteSimulationResult>;
  getBalancesForBridge: () => Promise<TokenBalance[]>;
  getBalancesForSwap: () => Promise<TokenBalance[]>;
  swapWithExactIn: (
    input: SwapExactInParams,
    options?: SwapOperationOptions
  ) => Promise<SwapResult>;
  swapWithExactOut: (
    input: SwapExactOutParams,
    options?: SwapOperationOptions
  ) => Promise<SwapResult>;
  /**
   * Orchestrates two distinct operations in sequence — NOT a single atomic transaction:
   *
   * 1. Swap (conditional) — funds the shortfall on the destination chain. Skipped when the
   *    destination already holds enough of the token (`result.swapSkipped === true`).
   * 2. Execute + approval (execute always, approval optional) — the contract call, preceded by
   *    an optional token approval, is always sent from the user's connected wallet on the
   *    destination chain.
   *
   * The steps succeed or fail independently: a failed execute does not roll back the swap —
   * the swapped funds remain in the user's wallet on the destination chain.
   */
  swapAndExecute: (
    input: SwapAndExecuteParams,
    options?: SwapAndExecuteOptions
  ) => Promise<SwapAndExecuteResult>;
  calculateMaxForSwap: (input: SwapMaxParams) => Promise<SwapMaxResult>;
  calculateMaxForBridge: (input: BridgeMaxParams) => Promise<BridgeMaxResult>;
  setEVMProvider: (provider: EthereumProvider) => Promise<void>;
  hasEvmProvider: boolean;
  convertTokenReadableAmountToBigInt: (
    amount: string,
    tokenSymbol: string,
    chainId: number
  ) => bigint;
  getSupportedChains: () => SupportedChainsAndTokensResult;
  destroy: () => void;
};
