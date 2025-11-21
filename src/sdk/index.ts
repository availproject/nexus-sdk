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
// import { AdapterProps } from '@tronweb3/tronwallet-abstract-adapter';
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
} from '../utils/analytics';
import { getSDKConfigName } from './ca-base/utils';

export class NexusSDK extends CA {
  public readonly utils: NexusUtils;
  private _isInitializedTrack = false;
  private _isFirstInitializedTrack = false;

  constructor(config?: { network?: NexusNetwork; debug?: boolean; siweChain?: number }) {
    super(config);
    logger.debug('Nexus SDK initialized with config:', config);
    this.utils = new NexusUtils(this.chainList);
  }

  /**
   * Initialize the SDK with a provider
   * @param provider Ethereum provider
   * @throws NexusError if the initialize fails
   * @returns Promise resolving to void
   */
  public async initialize(provider: EthereumProvider): Promise<void> {
    if (!this._isFirstInitializedTrack) {
      trackSDKInitialized(getSDKConfigName(this._networkConfig));
      this._isFirstInitializedTrack = true;
    }

    await this._setEVMProvider(provider);
    await this._init();
  }

  /**
   * Returns unified balance for tokens across all chains
   * @deprecated use `getBalancesForBridge` for direct replacement.
   * @returns unified balances across all chains
   */
  public async getUnifiedBalances(includeSwappableBalances = false): Promise<UserAsset[]> {
    trackGetUnifiedBalances(getSDKConfigName(this._networkConfig));
    return this._getUnifiedBalances(includeSwappableBalances);
  }

  /**
   * Bridge to destination chain from auto-selected sources or provided source chains
   * @param params bridge parameters
   * @param options event parameters
   * @throws NexusError if the bridge fails
   * @returns bridge result with explorer URL
   */
  public async bridge(params: BridgeParams, options?: OnEventParam): Promise<BridgeResult> {
    const updatedParams = {
      ...params,
      toChainId: CHAIN_METADATA[params.toChainId].name,
      sourceChains: params.sourceChains?.map((chainId) => CHAIN_METADATA[chainId]?.name ?? chainId),
    };
    trackNexusTransaction({
      name: 'bridge',
      config: getSDKConfigName(this._networkConfig),
      bridgeParams: { params: updatedParams, options },
    });
    const result = await this._createBridgeHandler(params, options).execute();
    trackNexusResult({
      name: 'bridge',
      config: getSDKConfigName(this._networkConfig),
      result,
      bridgeParams: { params: updatedParams, options },
    });
    return {
      explorerUrl: result.explorerURL ?? '',
    };
  }

  /**
   * Calculates the maximum amount that can be bridged for a given token and destination chain
   * @param params
   * @returns
   */
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
      config: getSDKConfigName(this._networkConfig),
      calculateMaxForBridge: updatedParams,
    });
    const result = this._calculateMaxForBridge(params);
    trackNexusResult({
      name: 'calculateMaxForBridge',
      config: getSDKConfigName(this._networkConfig),
      result,
      calculateMaxForBridge: updatedParams,
    });
    return result;
  }

  /**
   * Bridge & transfer to an address (Attribution)
   * @param params transfer parameters
   * @param options event parameters
   * @throws NexusError if the bridge and transfer fails
   * @returns transfer result with transaction hash and explorer URL
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
      config: getSDKConfigName(this._networkConfig),
      bridgeAndTransferParams: { params: updatedParams, options },
    });
    const result = await this._bridgeAndTransfer(params, options);
    trackNexusResult({
      name: 'bridgeAndTransfer',
      config: getSDKConfigName(this._networkConfig),
      result,
      bridgeAndTransferParams: { params: updatedParams, options },
    });
    return {
      transactionHash: result.executeTransactionHash,
      explorerUrl: result.executeExplorerUrl,
    };
  }

  /**
   * Swap with exact in
   * Useful when trying to swap with fixed sources and destination
   * @param input swap input
   * @param options event parameters
   * @throws NexusError if the swap fails
   * @returns swap result with success flag and result
   */
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
      config: getSDKConfigName(this._networkConfig),
      swapWithExactInParams: { input: updatedParams, options },
    });
    const result = await this._swapWithExactIn(input, options);
    trackNexusResult({
      name: 'swapWithExactIn',
      config: getSDKConfigName(this._networkConfig),
      result,
      swapWithExactInParams: { input: updatedParams, options },
    });
    return {
      success: true,
      result,
    };
  }

  /**
   * Swap with exact out
   * Useful when trying to swap with a fixed destination.
   * Sources are calculated automatically.
   * @param input swap input
   * @param options event parameters
   * @throws NexusError if the swap fails
   * @returns swap result with success flag and result
   */
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
      config: getSDKConfigName(this._networkConfig),
      swapWithExactOutParams: { input: updatedParams, options },
    });
    const result = await this._swapWithExactOut(input, options);
    trackNexusResult({
      name: 'swapWithExactOut',
      config: getSDKConfigName(this._networkConfig),
      result,
      swapWithExactOutParams: { input: updatedParams, options },
    });
    return {
      success: true,
      result,
    };
  }

  /**
   * Simulate bridge transaction to get costs and fees
   * @param params bridge parameters
   * @returns simulation result with gas estimates
   */
  public async simulateBridge(params: BridgeParams): Promise<SimulationResult> {
    const updatedParams = {
      ...params,
      toChainId: CHAIN_METADATA[params.toChainId].name,
      sourceChains: params.sourceChains?.map((chainId) => CHAIN_METADATA[chainId]?.name ?? chainId),
    };
    trackNexusTransaction({
      name: 'simulateBridge',
      config: getSDKConfigName(this._networkConfig),
      simulateBridgeParams: updatedParams,
    });
    const result = this._createBridgeHandler(params).simulate();
    trackNexusResult({
      name: 'simulateBridge',
      config: getSDKConfigName(this._networkConfig),
      result,
      simulateBridgeParams: updatedParams,
    });
    return result;
  }

  /**
   * Simulate bridge + transfer transaction to get costs and fees
   * @param params transfer parameters
   * @returns simulation result with gas estimates
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
      config: getSDKConfigName(this._networkConfig),
      simulateBridgeAndTransferParams: updatedParams,
    });
    const result = this._simulateBridgeAndTransfer(params);
    trackNexusResult({
      name: 'simulateBridgeAndTransfer',
      config: getSDKConfigName(this._networkConfig),
      result,
      simulateBridgeAndTransferParams: updatedParams,
    });
    return result;
  }

  /**
   * Get user's past intents with pagination
   * @param page page number
   * @returns list of intents
   */
  public async getMyIntents(page: number = 1): Promise<RequestForFunds[]> {
    trackGetIntent(getSDKConfigName(this._networkConfig));
    return this._getMyIntents(page);
  }

  /**
   * Set callback for intent status updates
   * Useful for capturing intent and displaying information to the user
   * Once set up, data will be automatically emitted, can be stored in a state or a variable for further use.
   * @param callback intent status update callback
   */
  public setOnIntentHook(callback: OnIntentHook): void {
    const wrappedCallback: OnIntentHook = (data) => {
      trackIntent(getSDKConfigName(this._networkConfig), data.intent);
      callback(data);
    };

    this._setOnIntentHook(wrappedCallback);
  }

  /**
   * Set callback for swap intent details
   * Useful for capturing swap intent and displaying information to the user
   * Once set up, data will be automatically emitted, can be stored in a state or a variable for further use.
   * @param callback swap intent details callback
   */
  public setOnSwapIntentHook(callback: OnSwapIntentHook): void {
    const wrappedCallback: OnSwapIntentHook = (data) => {
      trackSwapIntent(getSDKConfigName(this._networkConfig), data.intent);
      callback(data);
    };

    this._setOnSwapIntentHook(wrappedCallback);
  }

  // public addTron(adapter: AdapterProps) {
  //   trackTron(getSDKConfigName(this._networkConfig), adapter);
  //   this._setTronAdapter(adapter);
  // }

  /**
   * Set callback for allowance approval events
   * Useful for capturing allowance approval and displaying information to the user
   * Once set up, data will be automatically emitted, can be stored in a state or a variable for further use.
   * @param callback allowance approval event callback
   */
  public setOnAllowanceHook(callback: OnAllowanceHook): void {
    const wrappedCallback: OnAllowanceHook = (data) => {
      trackAllowance(getSDKConfigName(this._networkConfig), data.sources);
      callback(data);
    };

    this._setOnAllowanceHook(wrappedCallback);
  }

  /**
   * Deinitialize the SDK
   * @returns Promise resolving to void
   */
  public async deinit(): Promise<void> {
    trackSdkDeInitialized(getSDKConfigName(this._networkConfig));
    return this._deinit();
  }

  /**
   * Standalone function to execute funds into a smart contract
   * @param params execute parameters including contract details and transaction settings
   * @param options event parameters
   * @throws NexusError if the execute fails
   * @returns Promise resolving to execute result with transaction hash and explorer URL
   */
  public async execute(params: ExecuteParams, options?: OnEventParam): Promise<ExecuteResult> {
    const updatedParams = {
      ...params,
      toChainId: CHAIN_METADATA[params.toChainId].name,
    };
    trackNexusTransaction({
      name: 'execute',
      config: getSDKConfigName(this._networkConfig),
      executeParams: { params: updatedParams, options },
    });
    const result = this._execute(params, options);
    trackNexusResult({
      name: 'execute',
      config: getSDKConfigName(this._networkConfig),
      result,
      executeParams: { params: updatedParams, options },
    });
    return result;
  }

  /**
   * Simulate a standalone execute to estimate gas costs and validate parameters
   * @param params execute parameters for simulation
   * @throws NexusError if the simulate execute fails
   * @returns Promise resolving to simulation result with gas estimates
   */
  public async simulateExecute(params: ExecuteParams): Promise<ExecuteSimulation> {
    const updatedParams = {
      ...params,
      toChainId: CHAIN_METADATA[params.toChainId].name,
    };
    trackNexusTransaction({
      name: 'simulateExecute',
      config: getSDKConfigName(this._networkConfig),
      simulateExecuteParams: updatedParams,
    });
    const result = this._simulateExecute(params);
    trackNexusResult({
      name: 'simulateExecute',
      config: getSDKConfigName(this._networkConfig),
      result,
      simulateExecuteParams: updatedParams,
    });
    return result;
  }

  /**
   * Bridge and execute function
   * Starts with an optional bridge transaction if user doesn't have enough funds on the destination chain.
   * Then executes the contract call on the destination chain.
   * @param params bridge and execute parameters
   * @param options event parameters
   * @throws NexusError if the bridge and execute fails
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
      config: getSDKConfigName(this._networkConfig),
      bridgeAndExecuteParams: { params: updatedParams, options },
    });
    const result = this._bridgeAndExecute(params, options);
    trackNexusResult({
      name: 'bridgeAndExecute',
      config: getSDKConfigName(this._networkConfig),
      result,
      bridgeAndExecuteParams: { params: updatedParams, options },
    });
    return result;
  }

  /**
   * Simulate bridge and execute operation using bridge output amounts for realistic execute cost estimation
   * This method provides more accurate gas estimates by using the actual amount that will be
   * received on the destination chain after bridging (accounting for fees, slippage, etc.)
   * Includes detailed step-by-step breakdown with approval handling.
   * @param params bridge and execute parameters
   * @throws NexusError if the simulate bridge and execute fails
   * @returns Promise resolving to simulation result with gas estimates
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
      config: getSDKConfigName(this._networkConfig),
      simulateBridgeAndExecute: { params: updatedParams },
    });
    const result = this._simulateBridgeAndExecute(params);
    trackNexusResult({
      name: 'simulateBridgeAndExecute',
      config: getSDKConfigName(this._networkConfig),
      result,
      simulateBridgeAndExecute: { params: updatedParams },
    });
    return result;
  }

  /**
   * Tokens returned here should be used in `input` for exact in swap
   * @throws NexusError if the get balances for swap fails
   * @returns balances that can be used in swap operations
   */
  public async getBalancesForSwap() {
    trackGetBalanceSwap(getSDKConfigName(this._networkConfig));
    const result = await this._getBalancesForSwap();

    return result.assets;
  }

  /**
   * Tokens returned here should be used in bridge, bridgeAndTransfer and bridgeAndExecute operations
   * @throws NexusError if the get balances for bridge fails
   * @returns balances that can be used in bridge operations
   */
  public getBalancesForBridge() {
    trackGetUnifiedBalances(getSDKConfigName(this._networkConfig));
    return this._getUnifiedBalances(false);
  }

  /**
   * Get list of chains where swap is supported
   * @returns list of chains where swap is supported
   */
  public getSwapSupportedChains(): SupportedChainsResult {
    trackGetSwapSupportedChains(getSDKConfigName(this._networkConfig));
    return this._getSwapSupportedChains();
  }

  public isInitialized() {
    if (!this._isInitializedTrack) {
      trackIsInitialized(getSDKConfigName(this._networkConfig));
      this._isInitializedTrack = true;
    }

    return this._isInitialized();
  }

  /**
   * Helper function to convert an input like "1.13" to 1_130_000n for input to other functions
   * Number of decimals for a token depends on the chain.
   * ex: USDC on BNB chain has 18 decimals and 6 decimals on most other chains.
   */
  public convertTokenReadableAmountToBigInt = this._convertTokenReadableAmountToBigInt;
}
