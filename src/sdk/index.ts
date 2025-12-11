// src/core/sdk/index.ts
import { NexusUtils } from './utils';
import type {
  BridgeParams,
  BridgeResult,
  TransferParams,
  TransferResult,
  OnIntentHook,
  EthereumProvider,
  ExactInSwapInput,
  ExactOutSwapInput,
  ExecuteParams,
  ExecuteResult,
  ExecuteSimulation,
  NexusNetwork,
  OnAllowanceHook,
  OnEventParam,
  OnSwapIntentHook,
  RequestForFunds,
  SimulationResult,
  SwapResult,
  SupportedChainsResult,
  AnalyticsConfig,
  BridgeMaxResult,
  BridgeAndExecuteSimulationResult,
  BridgeAndExecuteParams,
  BridgeAndExecuteResult,
  BeforeExecuteHook,
} from '../commons';
import { logger } from '../commons';
import { AnalyticsManager } from '../analytics/AnalyticsManager';
import { NexusAnalyticsErrors, NexusAnalyticsEvents, NexusAnalyticsPerformanceEvents } from '../analytics/events';
import { extractBridgeProperties, extractSwapProperties } from '../analytics/utils';
import { CA } from './ca-base/ca';
import Decimal from 'decimal.js';

function getNetwork(network: NexusNetwork) {
  if (typeof network !== 'string') {
    return 'custom';
  }
  return network;
}

function getBalanceBucket(totalBalance: string) {
  const balance = Number(totalBalance);
  if (balance < 10) {
    return '$0-$10';
  }
  if (balance < 100) {
    return '$10-$100';
  }
  if (balance < 1000) {
    return '$100-$1K';
  }
  if (balance < 10_000) {
    return '$1K-$10K';
  }
  if (balance < 100_000) {
    return '$10K-$100K';
  }
  return '$100K+';
}

export class NexusSDK extends CA {
  public readonly utils: NexusUtils;
  public readonly analytics: AnalyticsManager;

  constructor(config?: {
    network?: NexusNetwork;
    debug?: boolean;
    siweChain?: number;
    analytics?: AnalyticsConfig;
  }) {
    super(config);
    logger.debug('Nexus SDK initialized with config:', config);
    this.utils = new NexusUtils(this.chainList);

    // Initialize analytics (backwards compatible - enabled by default)
    this.analytics = new AnalyticsManager(
      getNetwork(config?.network || 'mainnet'),
      config?.analytics,
    );

    // Make analytics available to CA base class for wallet/balance events
    this._analytics = this.analytics;

    // Track SDK initialization
    this.analytics.track(NexusAnalyticsEvents.SDK_INITIALIZED, {
      debug: config?.debug || false,
    });
  }

  /**
   * Initialize the SDK with a provider
   * @param provider Ethereum provider
   * @throws NexusError if the initialize fails
   * @returns Promise resolving to void
   */
  public async initialize(provider: EthereumProvider): Promise<void> {
    await this.analytics.trackPerformance(NexusAnalyticsPerformanceEvents.PERF_SDK_INITIALIZED, async () => {
      await this._setEVMProvider(provider);
      await this._init();
      return;
    })
  }

  /**
   * Bridge to destination chain from auto-selected sources or provided source chains
   * @param params bridge parameters
   * @param options event parameters
   * @throws NexusError if the bridge fails
   * @returns bridge result with explorer URL
   */
  public async bridge(params: BridgeParams, options?: OnEventParam): Promise<BridgeResult> {
    // Track bridge started
    this.analytics.track(NexusAnalyticsEvents.BRIDGE_INITIATED, {
      toChainId: params.toChainId,
      tokenSymbol: params.token,
      sourceChains: params.sourceChains,
    });

    try {
      const result = await this.analytics.trackPerformance(NexusAnalyticsPerformanceEvents.PERF_BRIDGE_TRANSACTION, async () => (await this._createBridgeHandler(params, options)).execute(), {
        toChainId: params.toChainId,
        tokenSymbol: params.token,
        sourceChains: params.sourceChains,
      });
      // Track bridge completed
      this.analytics.track(NexusAnalyticsEvents.BRIDGE_TRANSACTION_SUCCESS, {
        toChainId: params.toChainId,
        tokenSymbol: params.token,
        explorerUrl: result.explorerURL,
        ...extractBridgeProperties(result.intent),
        intent: result.intentID.toString(),
      });
      return {
        explorerUrl: result.explorerURL,
        sourceTxs: result.sourceTxs,
        intent: result.intent,
      };
    } catch (error) {
      // Track bridge failed
      this.analytics.trackError(NexusAnalyticsErrors.BRIDGE, error, {
        toChainId: params.toChainId,
        tokenSymbol: params.token,
      });
      throw error;
    }
  }

  /**
   * Calculates the maximum amount that can be bridged for a given token and destination chain
   * @param params
   * @returns
   */
  public async calculateMaxForBridge(
    params: Omit<BridgeParams, 'amount'>,
  ): Promise<BridgeMaxResult> {
    return this._calculateMaxForBridge(params);
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
    // Track transfer started
    this.analytics.track(NexusAnalyticsEvents.TRANSFER_INITIATED, {
      toChainId: params.toChainId,
      tokenSymbol: params.token,
      recipient: params.recipient,
    });

    try {
      const result = await this.analytics.trackPerformance(NexusAnalyticsPerformanceEvents.PERF_TRANSFER_TRANSACTION, () => this._bridgeAndTransfer(params, options));

      // Track transfer completed
      this.analytics.track(NexusAnalyticsEvents.TRANSFER_TRANSACTION_SUCCESS, {
        toChainId: params.toChainId,
        tokenSymbol: params.token,
        recipient: params.recipient,
        transactionHash: result.executeTransactionHash,
        explorerUrl: result.executeExplorerUrl,
        bridgeExplorerUrl: result.bridgeExplorerUrl,
        ...extractBridgeProperties(result.intent),
      });

      return {
        transactionHash: result.executeTransactionHash,
        explorerUrl: result.executeExplorerUrl,
      };
    } catch (error) {
      // Track transfer failed
      this.analytics.trackError(NexusAnalyticsErrors.TRANSFER, error, {
        toChainId: params.toChainId,
        tokenSymbol: params.token,
        recipient: params.recipient,
      });
      throw error;
    }
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
    // Track swap started
    this.analytics.track(NexusAnalyticsEvents.SWAP_INITIATED, {
      swapType: 'exactIn',
      toChainId: input.toChainId,
      toTokenAddress: input.toTokenAddress,
      sourceChains: input.from.map((f) => f.chainId),
    });

    try {
      const result = await this.analytics.trackPerformance(NexusAnalyticsPerformanceEvents.PERF_SWAP_TRANSACTION, () => this._swapWithExactIn(input, options), {
        swapType: 'exactIn',
        toChainId: input.toChainId,
        toTokenAddress: input.toTokenAddress,
        sourceChains: input.from.map((f) => f.chainId),
      });

      // Track swap completed
      this.analytics.track(NexusAnalyticsEvents.SWAP_TRANSACTION_SUCCESS, {
        swapType: 'exactIn',
        toChainId: input.toChainId,
        toTokenAddress: input.toTokenAddress,
        ...extractSwapProperties(result),
      });

      return {
        success: true,
        result,
      };
    } catch (error) {
      // Track swap failed
      this.analytics.trackError(NexusAnalyticsErrors.SWAP, error, {
        swapType: 'exactIn',
        toChainId: input.toChainId,
        toTokenAddress: input.toTokenAddress,
      });
      throw error;
    }
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
    // Track swap started
    this.analytics.track(NexusAnalyticsEvents.SWAP_INITIATED, {
      swapType: 'exactOut',
      toChainId: input.toChainId,
      toTokenAddress: input.toTokenAddress,
    });

    try {
      const result = await this.analytics.trackPerformance(NexusAnalyticsPerformanceEvents.PERF_SWAP_TRANSACTION, () => this._swapWithExactOut(input, options), {
        swapType: 'exactOut',
        toChainId: input.toChainId,
        toTokenAddress: input.toTokenAddress,
      });

      // Track swap completed
      this.analytics.track(NexusAnalyticsEvents.SWAP_TRANSACTION_SUCCESS, {
        swapType: 'exactOut',
        toChainId: input.toChainId,
        toTokenAddress: input.toTokenAddress,
        ...extractSwapProperties(result),
      });

      return {
        success: true,
        result,
      };
    } catch (error) {
      // Track swap failed
      this.analytics.trackError(NexusAnalyticsErrors.SWAP, error, {
        swapType: 'exactOut',
        toChainId: input.toChainId,
        toTokenAddress: input.toTokenAddress,
      });
      throw error;
    }
  }

  /**
   * Simulate bridge transaction to get costs and fees
   * @param params bridge parameters
   * @returns simulation result with gas estimates
   */
  public async simulateBridge(params: BridgeParams): Promise<SimulationResult> {
    try {
      this.analytics.track(NexusAnalyticsEvents.BRIDGE_SIMULATION_STARTED, {
        toChainId: params.toChainId,
        tokenSymbol: params.token,
      });

      const result = await this.analytics.trackPerformance(NexusAnalyticsPerformanceEvents.PERF_BRIDGE_SIMULATION, async () => (await this._createBridgeHandler(params)).simulate());

      // Track simulation success
      this.analytics.track(NexusAnalyticsEvents.BRIDGE_SIMULATION_SUCCESS, {
        toChainId: params.toChainId,
        tokenSymbol: params.token,
      });
      return result;
    } catch (error) {
      // Track simulation failed
      this.analytics.trackError(NexusAnalyticsErrors.BRIDGE_SIMULATION, error, {
        toChainId: params.toChainId,
        tokenSymbol: params.token,
      });
      throw error;
    }
  }

  /**
   * Simulate bridge + transfer transaction to get costs and fees
   * @param params transfer parameters
   * @returns simulation result with gas estimates
   */
  public async simulateBridgeAndTransfer(
    params: TransferParams,
  ): Promise<BridgeAndExecuteSimulationResult> {
    try {
      this.analytics.track(NexusAnalyticsEvents.BRIDGE_AND_EXECUTE_SIMULATION_STARTED, {
        toChainId: params.toChainId,
        tokenSymbol: params.token,
        recipient: params.recipient,
      });

      const result = await this.analytics.trackPerformance(NexusAnalyticsPerformanceEvents.PERF_TRANSFER_SIMULATION, () => this._simulateBridgeAndTransfer(params));

      // Track simulation success
      this.analytics.track(NexusAnalyticsEvents.TRANSFER_SIMULATION_SUCCESS, {
        toChainId: params.toChainId,
        tokenSymbol: params.token,
        recipient: params.recipient,
      });
      return result;
    } catch (error) {
      // Track simulation failed
      this.analytics.trackError(NexusAnalyticsErrors.TRANSFER_SIMULATION, error, {
        toChainId: params.toChainId,
        tokenSymbol: params.token,
      });
      throw error;
    }
  }

  /**
   * Get user's past intents with pagination
   * @param page page number
   * @returns list of intents
   */
  public async getMyIntents(page: number = 1): Promise<RequestForFunds[]> {
    const result = await this.analytics.trackPerformance(NexusAnalyticsPerformanceEvents.PERF_GET_MY_INTENTS, () => this._getMyIntents(page));
    return result;
  }

  /**
   * Set callback for intent status updates
   * Useful for capturing intent and displaying information to the user
   * Once set up, data will be automatically emitted, can be stored in a state or a variable for further use.
   * @param callback intent status update callback
   */
  public setOnIntentHook(callback: OnIntentHook): void {
    this._setOnIntentHook(callback);
  }

  /**
   * Set callback for swap intent details
   * Useful for capturing swap intent and displaying information to the user
   * Once set up, data will be automatically emitted, can be stored in a state or a variable for further use.
   * @param callback swap intent details callback
   */
  public setOnSwapIntentHook(callback: OnSwapIntentHook): void {
    this._setOnSwapIntentHook(callback);
  }

  // public addTron(adapter: AdapterProps) {
  //   this._setTronAdapter(adapter);
  // }

  /**
   * Set callback for allowance approval events
   * Useful for capturing allowance approval and displaying information to the user
   * Once set up, data will be automatically emitted, can be stored in a state or a variable for further use.
   * @param callback allowance approval event callback
   */
  public setOnAllowanceHook(callback: OnAllowanceHook): void {
    this._setOnAllowanceHook(callback);
  }

  /**
   * Deinitialize the SDK
   * @returns Promise resolving to void
   */
  public async deinit(): Promise<void> {
    // Track session end before deinitializing
    this.analytics.trackSessionEnd();

    await this.analytics.trackPerformance(NexusAnalyticsPerformanceEvents.PERF_SDK_DEINITIALIZED, async () => this._deinit());

    this.analytics.track(NexusAnalyticsEvents.SDK_DEINITIALIZED, {
      sessionDuration: Date.now() - this.analytics.getSessionId().length, // Approximate
    });
    return;
  }

  /**
   * Standalone function to execute funds into a smart contract
   * @param params execute parameters including contract details and transaction settings
   * @param options event parameters
   * @throws NexusError if the execute fails
   * @returns Promise resolving to execute result with transaction hash and explorer URL
   */
  public async execute(params: ExecuteParams, options?: OnEventParam): Promise<ExecuteResult> {
    // Track execute started
    this.analytics.track(NexusAnalyticsEvents.EXECUTE_INITIATED, {
      toChainId: params.toChainId,
      contractAddress: params.to,
    });

    try {
      const result = await this.analytics.trackPerformance(NexusAnalyticsPerformanceEvents.PERF_EXECUTE_TRANSACTION, () => this._execute(params, options));

      // Track execute completed
      this.analytics.track(NexusAnalyticsEvents.EXECUTE_TRANSACTION_SUCCESS, {
        toChainId: params.toChainId,
        contractAddress: params.to,
        transactionHash: result.transactionHash,
        explorerUrl: result.explorerUrl,
      });
      return result;
    } catch (error) {
      // Track execute failed
      this.analytics.trackError(NexusAnalyticsErrors.EXECUTE, error, {
        toChainId: params.toChainId,
        contractAddress: params.to,
      });
      throw error;
    }
  }

  /**
   * Simulate a standalone execute to estimate gas costs and validate parameters
   * @param params execute parameters for simulation
   * @throws NexusError if the simulate execute fails
   * @returns Promise resolving to simulation result with gas estimates
   */
  public async simulateExecute(params: ExecuteParams): Promise<ExecuteSimulation> {
    try {
      this.analytics.track(NexusAnalyticsEvents.EXECUTE_SIMULATION_STARTED, {
        toChainId: params.toChainId,
        contractAddress: params.to,
      });
      const result = await this.analytics.trackPerformance(NexusAnalyticsPerformanceEvents.PERF_EXECUTE_SIMULATION, () => this._simulateExecute(params));

      // Track simulation success
      this.analytics.track(NexusAnalyticsEvents.EXECUTE_SIMULATION_SUCCESS, {
        toChainId: params.toChainId,
        contractAddress: params.to,
      });
      return result;
    } catch (error) {
      // Track simulation failed
      this.analytics.trackError(NexusAnalyticsErrors.EXECUTE_SIMULATION, error, {
        toChainId: params.toChainId,
        contractAddress: params.to,
      });
      throw error;
    }
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
    options?: OnEventParam & BeforeExecuteHook,
  ): Promise<BridgeAndExecuteResult> {
    // Track bridge and execute started
    this.analytics.track(NexusAnalyticsEvents.BRIDGE_AND_EXECUTE_INITIATED, {
      toChainId: params.toChainId,
      tokenSymbol: params.token,
      contractAddress: params.execute?.to,
    });

    try {
      const result = await this.analytics.trackPerformance(NexusAnalyticsPerformanceEvents.PERF_BRIDGE_AND_EXECUTE_TRANSACTION, () => this._bridgeAndExecute(params, options));

      // Track bridge and execute completed
      this.analytics.track(NexusAnalyticsPerformanceEvents.PERF_BRIDGE_AND_EXECUTE_TRANSACTION, {
        toChainId: params.toChainId,
        tokenSymbol: params.token,
        contractAddress: params.execute?.to,
        executeTransactionHash: result.executeTransactionHash,
        bridgeExplorerUrl: result.bridgeExplorerUrl,
        ...extractBridgeProperties(result.intent),
      });
      return result;
    } catch (error) {
      // Track bridge and execute failed
      this.analytics.trackError(NexusAnalyticsErrors.BRIDGE_AND_EXECUTE, error, {
        toChainId: params.toChainId,
        tokenSymbol: params.token,
        contractAddress: params.execute?.to,
      });
      throw error;
    }
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
    try {
      this.analytics.track(NexusAnalyticsEvents.BRIDGE_AND_EXECUTE_SIMULATION_STARTED, {
        toChainId: params.toChainId,
        tokenSymbol: params.token,
        contractAddress: params.execute?.to,
      });
      const result = await this.analytics.trackPerformance(NexusAnalyticsPerformanceEvents.PERF_BRIDGE_AND_EXECUTE_SIMULATION, () => this._simulateBridgeAndExecute(params));

      // Track simulation success
      this.analytics.track(NexusAnalyticsEvents.BRIDGE_AND_EXECUTE_SIMULATION_SUCCESS, {
        toChainId: params.toChainId,
        tokenSymbol: params.token,
        contractAddress: params.execute?.to,
      });

      return result;
    } catch (error) {
      // Track simulation failed
      this.analytics.trackError(NexusAnalyticsErrors.BRIDGE_AND_EXECUTE_SIMULATION, error, {
        toChainId: params.toChainId,
        tokenSymbol: params.token,
        contractAddress: params.execute?.to,
      });
      throw error;
    }
  }

  /**
   * Tokens returned here should be used in `input` for exact in swap
   * @throws NexusError if the get balances for swap fails
   * @returns balances that can be used in swap operations
   */
  public async getBalancesForSwap() {
    this.analytics.track(NexusAnalyticsEvents.BALANCES_FETCH_STARTED, {
      swap: true,
      bridge: false
    })
    try {
      const result = await this.analytics.trackPerformance(NexusAnalyticsPerformanceEvents.PERF_BALANCES_FETCH, () => this._getBalancesForSwap(), {
        swap: true,
        bridge: false
      });
      this.analytics.track(NexusAnalyticsEvents.BALANCES_FETCH_SUCCESS, {
        swap: true,
        bridge: false,
        swappableBalanceBucket: getBalanceBucket(result?.assets?.reduce((acc, asset) => acc.add(asset?.balanceInFiat || 0), new Decimal(0) || 0).toFixed())
      })
      return result.assets;
    } catch (e) {
      this.analytics.trackError(NexusAnalyticsErrors.BALANCES_FETCH, e, {
        swap: true,
        bridge: false
      })
      throw e;
    }
  }

  /**
   * Tokens returned here should be used in bridge, bridgeAndTransfer and bridgeAndExecute operations
   * @throws NexusError if the get balances for bridge fails
   * @returns balances that can be used in bridge operations
   */
  public async getBalancesForBridge() {
    this.analytics.track(NexusAnalyticsEvents.BALANCES_FETCH_STARTED, {
      swap: false,
      bridge: true
    })
    try {
      const result = await this.analytics.trackPerformance(NexusAnalyticsPerformanceEvents.PERF_BALANCES_FETCH, () => this._getBalancesForBridge(), {
        swap: false,
        bridge: true
      });
      this.analytics.track(NexusAnalyticsEvents.BALANCES_FETCH_SUCCESS, {
        swap: false,
        bridge: true,
        bridgeableBalanceBucket: getBalanceBucket(result?.reduce((acc, asset) => acc.add(asset?.balanceInFiat || 0), new Decimal(0) || 0).toFixed())
      })
      return result;
    } catch (e) {
      this.analytics.trackError(NexusAnalyticsErrors.BALANCES_FETCH, e, {
        swap: false,
        bridge: true
      })
      throw e;
    }
  }

  /**
   * Get list of chains where swap is supported
   * @returns list of chains where swap is supported
   */
  public getSwapSupportedChains(): SupportedChainsResult {
    return this._getSwapSupportedChains();
  }

  public isInitialized() {
    return this._isInitialized();
  }

  /**
   * Used to set EVM provider outside of initialize, should allow fetching balances without initializing the SDK.
   */
  public setEVMProvider = this._setEVMProvider;

  /**
   * Useful for checking if the SDK has succesfully received the EVM provider
   */
  public get hasEvmProvider(): boolean {
    return !!this._evm;
  }

  /**
   * For triggering account change, if provider in initialize doesn't have event hooks like .on(...) and .removeListener(...).
   * It doesnt do anything if address has not changed since last check.
   */
  public triggerAccountChange = this._triggerAccountChange;

  /**
   * Helper function to convert an input like "1.13" to 1_130_000n for input to other functions
   * Number of decimals for a token depends on the chain.
   * ex: USDC on BNB chain has 18 decimals and 6 decimals on most other chains.
   */
  public convertTokenReadableAmountToBigInt = this._convertTokenReadableAmountToBigInt;
}
