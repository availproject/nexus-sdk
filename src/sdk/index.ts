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
import { CHAIN_METADATA, logger } from '../commons';
import { CA } from './ca-base';
import { AdapterProps } from '@tronweb3/tronwallet-abstract-adapter';
import {
  trackAllowance,
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
    trackSDKInitialized(this._config);
    await this._setEVMProvider(provider);
    await this._init();
  }

  /**
   * Get unified balances across all chains
   */
  public async getUnifiedBalances(includeSwappableBalances = false): Promise<UserAsset[]> {
    trackGetUnifiedBalances(this._config);
    return this._getUnifiedBalances(includeSwappableBalances);
  }

  /**
   * Bridge to destination chain from auto-selected or provided source chains
   */
  public async bridge(params: BridgeParams, options?: OnEventParam): Promise<BridgeResult> {
    const updatedParams = {
      ...params,
      toChainId: CHAIN_METADATA[params.toChainId].name,
      sourceChains: params.sourceChains?.map((chainId) => CHAIN_METADATA[chainId]?.name ?? chainId),
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
  }

  public async calculateMaxForBridge(
    params: Omit<BridgeParams, 'amount'>,
  ): Promise<BridgeMaxResult> {
    const updatedParams = {
      ...params,
      toChainId: CHAIN_METADATA[params.toChainId].name,
      sourceChains: params.sourceChains?.map((chainId) => CHAIN_METADATA[chainId]?.name ?? chainId),
    };
    trackNexusTransaction({
      name: 'calculateMaxForBridge',
      config: this._config,
      calculateMaxForBridge: updatedParams,
    });
    trackTokenDetails({ config: this._config, params: updatedParams });
    const result = this._calculateMaxForBridge(params);
    trackNexusResult({
      name: 'calculateMaxForBridge',
      config: this._config,
      result,
    });
    return result;
  }

  /**
   * Bridge & transfer to an address (Attribution)
   */
  public async bridgeAndTransfer(
    params: TransferParams,
    options?: OnEventParam,
  ): Promise<TransferResult> {
    const updatedParams = {
      ...params,
      toChainId: CHAIN_METADATA[params.toChainId].name,
      sourceChains: params.sourceChains?.map((chainId) => CHAIN_METADATA[chainId]?.name ?? chainId),
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
  }

  public async swapWithExactIn(
    input: ExactInSwapInput,
    options?: OnEventParam,
  ): Promise<SwapResult> {
    const updatedParams = {
      ...input,
      from: input.from.map((f) => ({
        ...f,
        chainId: CHAIN_METADATA[f.chainId].name,
      })),
      toChainId: CHAIN_METADATA[input.toChainId].name,
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
  }

  public async swapWithExactOut(
    input: ExactOutSwapInput,
    options?: OnEventParam,
  ): Promise<SwapResult> {
    const updatedParams = {
      ...input,
      toChainId: CHAIN_METADATA[input.toChainId].name,
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
  }

  /**
   * Simulate bridge transaction to get costs and fees
   */
  public async simulateBridge(params: BridgeParams): Promise<SimulationResult> {
    const updatedParams = {
      ...params,
      toChainId: CHAIN_METADATA[params.toChainId].name,
      sourceChains: params.sourceChains?.map((chainId) => CHAIN_METADATA[chainId]?.name ?? chainId),
    };
    trackNexusTransaction({
      name: 'simulateBridge',
      config: this._config,
      simulateBridgeParams: updatedParams,
    });
    trackTokenDetails({ config: this._config, params: updatedParams });
    const result = this.createBridgeHandler(params).simulate();
    trackNexusResult({
      name: 'simulateBridge',
      config: this._config,
      result,
    });
    return result;
  }

  /**
   * Simulate transfer transaction to get costs and fees
   */
  public async simulateBridgeAndTransfer(
    params: TransferParams,
  ): Promise<BridgeAndExecuteSimulationResult> {
    const updatedParams = {
      ...params,
      toChainId: CHAIN_METADATA[params.toChainId].name,
      sourceChains: params.sourceChains?.map((chainId) => CHAIN_METADATA[chainId]?.name ?? chainId),
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
  }

  /**
   * Get user's intents with pagination
   */
  public async getMyIntents(page: number = 1): Promise<RequestForFunds[]> {
    trackGetIntent(this._config);
    return this._getMyIntents(page);
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
    trackSdkDeInitialized(this._config);
    return this._deinit();
  }

  /**
   * Standalone function to execute funds into a smart contract
   * @param params execute parameters including contract details and transaction settings
   * @returns Promise resolving to execute result with transaction hash and explorer URL
   */
  public async execute(params: ExecuteParams, options?: OnEventParam): Promise<ExecuteResult> {
    const updatedParams = {
      ...params,
      toChainId: CHAIN_METADATA[params.toChainId].name,
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
  }

  /**
   * Simulate a standalone execute to estimate gas costs and validate parameters
   * @param params execute parameters for simulation
   * @returns Promise resolving to simulation result with gas estimates
   */
  public async simulateExecute(params: ExecuteParams): Promise<ExecuteSimulation> {
    const updatedParams = {
      ...params,
      toChainId: CHAIN_METADATA[params.toChainId].name,
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
  }

  /**
   * Enhanced bridge and execute function with optional execute step and improved error handling
   * @param params Enhanced bridge and execute parameters
   * @returns Promise resolving to comprehensive operation result
   */
  public async bridgeAndExecute(
    params: BridgeAndExecuteParams,
    options?: OnEventParam,
  ): Promise<BridgeAndExecuteResult> {
    const updatedParams = {
      ...params,
      toChainId: CHAIN_METADATA[params.toChainId].name,
      sourceChains: params.sourceChains?.map((chainId) => CHAIN_METADATA[chainId]?.name ?? chainId),
      execute: {
        ...params.execute,
        ...((params.execute as any).toChainId
          ? { toChainId: CHAIN_METADATA[(params.execute as any).toChainId].name }
          : params.execute),
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
  }

  /**
   * Simulate bridge and execute operation using bridge output amounts for realistic execute cost estimation
   * This method provides more accurate gas estimates by using the actual amount that will be
   * received on the destination chain after bridging (accounting for fees, slippage, etc.)
   * Includes detailed step-by-step breakdown with approval handling.
   */
  public async simulateBridgeAndExecute(
    params: BridgeAndExecuteParams,
  ): Promise<BridgeAndExecuteSimulationResult> {
    const updatedParams = {
      ...params,
      toChainId: CHAIN_METADATA[params.toChainId].name,
      sourceChains: params.sourceChains?.map((chainId) => CHAIN_METADATA[chainId]?.name ?? chainId),
      execute: {
        ...params.execute,
        ...((params.execute as any).toChainId
          ? { toChainId: CHAIN_METADATA[(params.execute as any).toChainId].name }
          : params.execute),
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
  }

  public getBalancesForSwap() {
    trackGetBalanceSwap(this._config);
    return this._getBalancesForSwap();
  }

  public getSwapSupportedChains(): SupportedChainsResult {
    trackGetSwapSupportedChains(this._config);
    return this._getSwapSupportedChains();
  }

  public isInitialized() {
    trackIsInitialized(this._config);
    return this._isInitialized();
  }
}
