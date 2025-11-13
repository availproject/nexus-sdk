// src/core/sdk/index.ts
import { NexusUtils } from './utils';
import type {
  BridgeParams,
  BridgeResult,
  TransferParams,
  TransferResult,
  OnIntentHook,
  OnAllowanceHook,
  EthereumProvider,
  UserAsset,
  SimulationResult,
  RequestForFunds,
  NexusNetwork,
  BridgeAndExecuteParams,
  BridgeAndExecuteResult,
  ExecuteParams,
  ExecuteResult,
  ExecuteSimulation,
  BridgeAndExecuteSimulationResult,
  SwapResult,
  SupportedChainsResult,
  ExactInSwapInput,
  ExactOutSwapInput,
  OnEventParam,
  BridgeMaxResult,
  OnSwapIntentHook,
} from '../commons';
import { getNetworkNameByChainId, logger } from '../commons';
import { CA } from './ca-base';
import { AdapterProps } from '@tronweb3/tronwallet-abstract-adapter';
import {
  trackAllowance,
  trackError,
  trackGetBalanceSwap,
  trackGetIntent,
  trackGetSwapSupportedChains,
  trackGetUnifiedBalances,
  trackIntent,
  trackIsInitialized,
  trackNexusResult,
  trackNexusTransaction,
  trackSdkDeInitialized,
  trackSDKInitialized,
  trackSwapIntent,
  trackTokenDetails,
  trackTron,
} from '../utils/analytics';

export class NexusSDK extends CA {
  public readonly utils: NexusUtils;

  constructor(config?: { network?: NexusNetwork; debug?: boolean }) {
    super(config);
    logger.debug('Nexus SDK initialized with config:', config);
    this.utils = new NexusUtils(this.chainList);
  }

  /**
   * Initialize the SDK with a provider
   */
  public async initialize(provider: EthereumProvider): Promise<void> {
    try {
      await this._setEVMProvider(provider);
      await this._init();
      trackSDKInitialized(this._config);
    } catch (error) {
      trackError('initialization-failed', error as Error);
    }
  }

  /**
   * Get unified balances across all chains
   */
  public async getUnifiedBalances(includeSwappableBalances = false): Promise<UserAsset[] | {}> {
    try {
      trackGetUnifiedBalances(this._config);
      return this._getUnifiedBalances(includeSwappableBalances);
    } catch (error) {
      trackError('getUnifiedBalances-failed', error as Error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Bridge to destination chain from auto-selected or provided source chains
   */
  public async bridge(params: BridgeParams, options?: OnEventParam): Promise<BridgeResult> {
    try {
      const updatedParams = {
        ...params,
        toChainId: getNetworkNameByChainId(params.toChainId),
        sourceChains: params.sourceChains?.map(getNetworkNameByChainId),
      };
      trackNexusTransaction({
        name: 'bridge',
        config: this._config,
        bridgeParams: { params: updatedParams, options },
      });
      trackTokenDetails({ config: this._config, params: updatedParams });
      const result = await this.createBridgeHandler(params, options).execute();
      trackNexusResult({
        name: 'bridge',
        config: this._config,
        result,
      });
      return {
        explorerUrl: result.explorerURL ?? '',
      };
    } catch (error) {
      trackError('bridge-error', error as Error);
      return {
        explorerUrl: '',
      };
    }
  }

  public async calculateMaxForBridge(
    params: Omit<BridgeParams, 'amount'>,
  ): Promise<BridgeMaxResult | {}> {
    try {
      const updatedParams = {
        ...params,
        toChainId: getNetworkNameByChainId(params.toChainId),
        sourceChains: params.sourceChains?.map(getNetworkNameByChainId),
      };
      trackNexusTransaction({
        name: 'calculateMaxForBridge',
        config: this._config,
        calculateMaxForBridge: updatedParams,
      });
      return this._calculateMaxForBridge(params);
    } catch (error) {
      trackError('calculateMaxForBridge-error', error as Error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Bridge & transfer to an address (Attribution)
   */
  public async bridgeAndTransfer(
    params: TransferParams,
    options?: OnEventParam,
  ): Promise<TransferResult> {
    try {
      const updatedParams = {
        ...params,
        toChainId: getNetworkNameByChainId(params.toChainId),
        sourceChains: params.sourceChains?.map(getNetworkNameByChainId),
      };
      trackNexusTransaction({
        name: 'bridgeAndTransfer',
        config: this._config,
        bridgeAndTransferParams: { params: updatedParams, options },
      });
      trackTokenDetails({ config: this._config, params: updatedParams });
      const result = await this._bridgeAndTransfer(params, options);
      trackNexusResult({
        name: 'bridgeAndTransfer',
        config: this._config,
        result,
      });
      return {
        transactionHash: result.executeTransactionHash,
        explorerUrl: result.executeExplorerUrl,
      };
    } catch (error) {
      trackError('bridgeAndTransfer-error', error as Error);
      return {
        transactionHash: '',
        explorerUrl: '',
      };
    }
  }

  public async swapWithExactIn(
    input: ExactInSwapInput,
    options?: OnEventParam,
  ): Promise<SwapResult> {
    try {
      const updatedParams = {
        ...input,
        from: input.from.map((f) => ({
          ...f,
          chainId: getNetworkNameByChainId(f.chainId),
        })),
        toChainId: getNetworkNameByChainId(input.toChainId),
      };
      trackNexusTransaction({
        name: 'swapWithExactIn',
        config: this._config,
        swapWithExactInParams: { input: updatedParams, options },
      });
      trackTokenDetails({ config: this._config, params: updatedParams });
      const result = await this._swapWithExactIn(input, options);
      trackNexusResult({
        name: 'swapWithExactIn',
        config: this._config,
        result,
      });
      return {
        success: true,
        result,
      };
    } catch (error) {
      trackError('swapWithExactIn-error', error as Error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  public async swapWithExactOut(
    input: ExactOutSwapInput,
    options?: OnEventParam,
  ): Promise<SwapResult> {
    try {
      const updatedParams = {
        ...input,
        toChainId: getNetworkNameByChainId(input.toChainId),
      };
      trackNexusTransaction({
        name: 'swapWithExactOut',
        config: this._config,
        swapWithExactOutParams: { input: updatedParams, options },
      });
      trackTokenDetails({ config: this._config, params: updatedParams });
      const result = await this._swapWithExactOut(input, options);
      trackNexusResult({
        name: 'swapWithExactOut',
        config: this._config,
        result,
      });
      return {
        success: true,
        result,
      };
    } catch (error) {
      trackError('swapWithExactOut-error', error as Error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Simulate bridge transaction to get costs and fees
   */
  public async simulateBridge(params: BridgeParams): Promise<SimulationResult | {}> {
    try {
      const updatedParams = {
        ...params,
        toChainId: getNetworkNameByChainId(params.toChainId),
        sourceChains: params.sourceChains?.map(getNetworkNameByChainId),
      };
      trackNexusTransaction({
        name: 'simulateBridge',
        config: this._config,
        simulateBridgeParams: updatedParams,
      });
      trackTokenDetails({ config: this._config, params: updatedParams });
      const result = await this.createBridgeHandler(params).simulate();
      trackNexusResult({
        name: 'simulateBridge',
        config: this._config,
        result,
      });
      return result;
    } catch (error) {
      trackError('simulateBridge-error', error as Error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Simulate transfer transaction to get costs and fees
   */
  public async simulateBridgeAndTransfer(
    params: TransferParams,
  ): Promise<BridgeAndExecuteSimulationResult | {}> {
    try {
      const updatedParams = {
        ...params,
        toChainId: getNetworkNameByChainId(params.toChainId),
        sourceChains: params.sourceChains?.map(getNetworkNameByChainId),
      };
      trackNexusTransaction({
        name: 'simulateBridgeAndTransfer',
        config: this._config,
        simulateBridgeAndTransferParams: updatedParams,
      });
      trackTokenDetails({ config: this._config, params: updatedParams });
      const result = this._simulateBridgeAndTransfer(params);
      trackNexusResult({
        name: 'simulateBridgeAndTransfer',
        config: this._config,
        result,
      });
      return result;
    } catch (error) {
      trackError('simulateBridgeAndTransfer-error', error as Error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get user's intents with pagination
   */
  public async getMyIntents(page: number = 1): Promise<RequestForFunds[] | {}> {
    try {
      trackGetIntent(this._config);
      return this._getMyIntents(page);
    } catch (error) {
      trackError('getMyIntents-error', error as Error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Set callback for intent status updates
   */
  public setOnIntentHook(callback: OnIntentHook): void {
    const wrappedCallback: OnIntentHook = (data) => {
      trackIntent(data.intent);
      callback(data);
    };

    this._setOnIntentHook(wrappedCallback);
  }

  /**
   * Set callback for swap intent details
   */
  public setOnSwapIntentHook(callback: OnSwapIntentHook): void {
    const wrappedCallback: OnSwapIntentHook = (data) => {
      trackSwapIntent(data.intent);
      callback(data);
    };

    this._setOnSwapIntentHook(wrappedCallback);
  }

  public addTron(adapter: AdapterProps) {
    trackTron(adapter);
    this._setTronAdapter(adapter);
  }

  /**
   * Set callback for allowance approval events
   */
  public setOnAllowanceHook(callback: OnAllowanceHook): void {
    const wrappedCallback: OnAllowanceHook = (data) => {
      trackAllowance(data.sources);
      callback(data);
    };

    this._setOnAllowanceHook(wrappedCallback);
  }

  public async deinit(): Promise<void> {
    try {
      trackSdkDeInitialized(this._config);
      return this._deinit();
    } catch (error) {
      trackError('deInitialization-failed', error as Error);
    }
  }

  /**
   * Standalone function to execute funds into a smart contract
   * @param params execute parameters including contract details and transaction settings
   * @returns Promise resolving to execute result with transaction hash and explorer URL
   */
  public async execute(params: ExecuteParams, options?: OnEventParam): Promise<ExecuteResult | {}> {
    try {
      const updatedParams = {
        ...params,
        toChainId: getNetworkNameByChainId(params.toChainId),
      };
      trackNexusTransaction({
        name: 'execute',
        config: this._config,
        executeParams: { params: updatedParams, options },
      });
      trackTokenDetails({ config: this._config, params: updatedParams });
      const result = this._execute(params, options);
      trackNexusResult({
        name: 'execute',
        config: this._config,
        result,
      });
      return result;
    } catch (error) {
      trackError('execute-error', error as Error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Simulate a standalone execute to estimate gas costs and validate parameters
   * @param params execute parameters for simulation
   * @returns Promise resolving to simulation result with gas estimates
   */
  public async simulateExecute(params: ExecuteParams): Promise<ExecuteSimulation | {}> {
    try {
      const updatedParams = {
        ...params,
        toChainId: getNetworkNameByChainId(params.toChainId),
      };
      trackNexusTransaction({
        name: 'simulateExecute',
        config: this._config,
        simulateExecuteParams: updatedParams,
      });
      trackTokenDetails({ config: this._config, params: updatedParams });
      const result = this._simulateExecute(params);
      trackNexusResult({
        name: 'simulateExecute',
        config: this._config,
        result,
      });
      return result;
    } catch (error) {
      trackError('simulateExecute-error', error as Error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Enhanced bridge and execute function with optional execute step and improved error handling
   * @param params Enhanced bridge and execute parameters
   * @returns Promise resolving to comprehensive operation result
   */
  public async bridgeAndExecute(
    params: BridgeAndExecuteParams,
    options?: OnEventParam,
  ): Promise<BridgeAndExecuteResult | {}> {
    try {
      const updatedParams = {
        ...params,
        toChainId: getNetworkNameByChainId(params.toChainId),
        sourceChains: params.sourceChains?.map(getNetworkNameByChainId),
        execute: {
          ...params.execute,
          ...((params.execute as any).toChainId
            ? { toChainId: getNetworkNameByChainId((params.execute as any).toChainId) }
            : {}),
        },
      };
      trackNexusTransaction({
        name: 'bridgeAndExecute',
        config: this._config,
        bridgeAndExecuteParams: { params: updatedParams, options },
      });
      trackTokenDetails({ config: this._config, params: updatedParams });
      const result = this._bridgeAndExecute(params, options);
      trackNexusResult({
        name: 'bridgeAndExecute',
        config: this._config,
        result,
      });
      return result;
    } catch (error) {
      trackError('bridgeAndExecute-error', error as Error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Simulate bridge and execute operation using bridge output amounts for realistic execute cost estimation
   * This method provides more accurate gas estimates by using the actual amount that will be
   * received on the destination chain after bridging (accounting for fees, slippage, etc.)
   * Includes detailed step-by-step breakdown with approval handling.
   */
  public async simulateBridgeAndExecute(
    params: BridgeAndExecuteParams,
  ): Promise<BridgeAndExecuteSimulationResult | {}> {
    try {
      const updatedParams = {
        ...params,
        toChainId: getNetworkNameByChainId(params.toChainId),
        sourceChains: params.sourceChains?.map(getNetworkNameByChainId),
        execute: {
          ...params.execute,
          ...((params.execute as any).toChainId
            ? { toChainId: getNetworkNameByChainId((params.execute as any).toChainId) }
            : {}),
        },
      };
      trackNexusTransaction({
        name: 'simulateBridgeAndExecute',
        config: this._config,
        simulateBridgeAndExecute: updatedParams,
      });
      trackTokenDetails({ config: this._config, params: updatedParams });
      const result = this._simulateBridgeAndExecute(params);
      trackNexusResult({
        name: 'simulateBridgeAndExecute',
        config: this._config,
        result,
      });
      return result;
    } catch (error) {
      trackError('simulateBridgeAndExecute-error', error as Error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  public getBalancesForSwap() {
    try {
      trackGetBalanceSwap(this._config);
      return this._getBalancesForSwap();
    } catch (error) {
      trackError('getBalancesForSwap-failed', error as Error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  public getSwapSupportedChains(): SupportedChainsResult | {} {
    try {
      trackGetSwapSupportedChains(this._config);
      return this._getSwapSupportedChains();
    } catch (error) {
      trackError('getSwapSupportedChains-failed', error as Error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  public isInitialized() {
    try {
      trackIsInitialized(this._config);
      return this._isInitialized();
    } catch (error) {
      trackError('isInitialized-failed', error as Error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
