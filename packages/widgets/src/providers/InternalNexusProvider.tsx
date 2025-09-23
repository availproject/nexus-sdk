'use client';
import {
  createContext,
  useContext,
  useState,
  ReactNode,
  useCallback,
  useMemo,
  useEffect,
  useRef,
} from 'react';
import {
  NexusSDK,
  EthereumProvider,
  UserAsset,
  BridgeParams,
  TransferParams,
  BridgeAndExecuteParams,
  SimulationResult,
  NexusNetwork,
  BridgeAndExecuteSimulationResult,
} from '@nexus/core';
import type {
  ActiveTransaction,
  BridgeConfig,
  NexusContextValue,
  TransactionType,
  ITransactionController,
  SwapInputData,
} from '../types';
import type { TransferConfig } from '../controllers/TransferController';
import { BridgeController } from '../controllers/BridgeController';
import { TransferController } from '../controllers/TransferController';
import { BridgeAndExecuteController } from '../controllers/BridgeAndExecuteController';
import TransactionProcessorShell from '../components/processing/transaction-processor-shell';
import { LayoutGroup } from 'motion/react';
import useListenTransaction from '../hooks/useListenTransaction';
import {
  logger,
  SwapIntentHook,
  parseUnits,
  TOKEN_METADATA,
  ExactInSwapInput,
} from '@nexus/commons';
import { DragConstraintsProvider } from '../components/motion/drag-constraints';
import { getTokenFromInputData, getAmountFromInputData, formatSwapError } from '../utils/utils';
import { getTokenAddress } from '../utils/token-utils';

const controllers: Record<Exclude<TransactionType, 'swap'>, ITransactionController> = {
  bridge: new BridgeController(),
  transfer: new TransferController(),
  bridgeAndExecute: new BridgeAndExecuteController(),
};

// Type guards

const NexusContext = createContext<NexusContextValue | null>(null);

const initialState: ActiveTransaction = {
  type: null,
  status: 'idle',
  reviewStatus: 'gathering_input',
  inputData: null,
  prefillFields: {},
  simulationResult: null,
  executionResult: null,
  error: null,
};

// Utility: extract chain identifier regardless of transaction type
function getInputChainId(
  data:
    | Partial<BridgeParams>
    | Partial<TransferParams>
    | Partial<BridgeAndExecuteParams>
    | Partial<SwapInputData>
    | null
    | undefined,
): number | undefined {
  if (!data) return undefined;
  if ('chainId' in data && data.chainId !== undefined) return data.chainId as number;
  if ('toChainId' in data && (data as Partial<BridgeAndExecuteParams>).toChainId !== undefined)
    return (data as Partial<BridgeAndExecuteParams>).toChainId;
  return undefined;
}

export function InternalNexusProvider({
  config,
  children,
  disableCollapse,
}: {
  config?: { network?: NexusNetwork; debug?: boolean };
  children: ReactNode;
  disableCollapse?: boolean;
}) {
  const [sdk] = useState(
    () => new NexusSDK({ network: config?.network ?? 'mainnet', debug: config?.debug ?? false }),
  );

  const [provider, setProvider] = useState<EthereumProvider | undefined>(undefined);
  const [isSdkInitialized, setIsSdkInitialized] = useState(false);
  const [activeTransaction, setActiveTransaction] = useState<ActiveTransaction>(initialState);
  const [unifiedBalance, setUnifiedBalance] = useState<UserAsset[]>([]);
  const [exchangeRates, setExchangeRates] = useState<Record<string, number>>({});
  const [isSimulating, setIsSimulating] = useState(false);
  const [insufficientBalance, setInsufficientBalance] = useState(false);
  const [isTransactionCollapsed, setIsTransactionCollapsed] = useState(false);
  const [timer, setTimer] = useState(0);
  const [allowanceError, setAllowanceError] = useState<string | null>(null);
  const [isSettingAllowance, setIsSettingAllowance] = useState(false);

  // Swap-specific state
  const swapAllowCallbackRef = useRef<(() => void) | null>(null);
  const [isSwapExecuting, setIsSwapExecuting] = useState(false);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const activeController = useMemo(() => {
    if (!activeTransaction.type) return null;
    if (activeTransaction.type === 'swap') return null; // Swaps handled directly in provider
    return controllers[activeTransaction.type];
  }, [activeTransaction.type]);

  const { processing, explorerURL, explorerURLs, resetProcessingState } = useListenTransaction({
    sdk,
    activeTransaction,
  });

  const fetchExchangeRates = useCallback(async () => {
    try {
      const response = await fetch('https://api.coinbase.com/v2/exchange-rates?currency=USD');
      const data = await response.json();
      const rates = (data?.data?.rates ?? {}) as Record<string, string>;
      logger.info('all rates', rates);
      // Convert from "units per USD" to "USD per unit" for easier UI multiplication
      const usdPerUnit: Record<string, number> = {};
      for (const [symbol, value] of Object.entries(rates)) {
        const unitsPerUsd = parseFloat(value);
        if (Number.isFinite(unitsPerUsd) && unitsPerUsd > 0) {
          usdPerUnit[symbol] = 1 / unitsPerUsd;
        }
      }

      // Ensure common stablecoins have a sane fallback
      ['USD', 'USDC', 'USDT'].forEach((stable) => {
        if (usdPerUnit[stable] === undefined) usdPerUnit[stable] = 1;
      });
      logger.info('exchange rates', usdPerUnit);
      setExchangeRates(usdPerUnit);
    } catch (error) {
      logger.error('Error fetching exchange rates:', error as Error);
    }
  }, []);

  const fetchBalances = async () => {
    const unifiedBalance = await sdk.getUnifiedBalances();
    logger.debug('Unified balance', { unifiedBalance });
    setUnifiedBalance(unifiedBalance);
  };

  const initializeSdk = async (ethProvider?: EthereumProvider) => {
    if (isSdkInitialized) return true;
    const eipProvider = ethProvider ?? provider;
    if (!eipProvider) {
      setActiveTransaction((prev) => ({
        ...prev,
        status: 'simulation_error',
        error: new Error('Wallet provider not connected.'),
      }));
      return false;
    }

    if (!provider && eipProvider) {
      setProvider(ethProvider);
    }

    try {
      setActiveTransaction((prev) => ({ ...prev, status: 'initializing' }));
      await sdk.initialize(eipProvider);
      await fetchExchangeRates();
      await fetchBalances();
      setIsSdkInitialized(true);
      setActiveTransaction((prev) => ({ ...prev, status: 'review' }));
      return true;
    } catch (err) {
      logger.error('SDK initialization failed:', err as Error);
      const error = err instanceof Error ? err : new Error('SDK Initialization failed.');
      setActiveTransaction((prev) => ({ ...prev, status: 'simulation_error', error }));
      return false;
    }
  };

  const deinitializeSdk = async () => {
    if (!isSdkInitialized) return;
    try {
      await sdk?.deinit();
      reset();
    } catch (e) {
      logger.error('Error deinitializing SDK', e as Error);
    }
  };

  const reset = () => {
    setProvider(undefined);
    setIsSdkInitialized(false);
    setActiveTransaction(initialState);
    setUnifiedBalance([]);
    setIsSimulating(false);
    setInsufficientBalance(false);
    setIsTransactionCollapsed(true);
    setTimer(0);
    setAllowanceError(null);
    setIsSettingAllowance(false);
  };

  const startTransaction = useCallback(
    (
      type: TransactionType,
      prefillData:
        | Partial<BridgeConfig>
        | Partial<TransferConfig>
        | Partial<SwapInputData>
        | Partial<BridgeAndExecuteParams> = {},
    ) => {
      // Track which fields were prefilled
      const prefillFields: {
        chainId?: boolean;
        toChainId?: boolean;
        token?: boolean;
        amount?: boolean;
        recipient?: boolean;
        fromChainID?: boolean;
        toChainID?: boolean;
        fromTokenAddress?: boolean;
        toTokenAddress?: boolean;
        fromAmount?: boolean;
        toAmount?: boolean;
      } = {};

      if (prefillData) {
        if ('chainId' in prefillData && prefillData.chainId !== undefined) {
          prefillFields.chainId = true;
          if (type === 'bridgeAndExecute') {
            prefillFields.toChainId = true;
          }
        }
        if (
          type === 'bridgeAndExecute' &&
          'toChainId' in prefillData &&
          prefillData.toChainId !== undefined
        ) {
          prefillFields.toChainId = true;
        }
        if ('token' in prefillData && prefillData.token !== undefined) {
          prefillFields.token = true;
        }
        if ('amount' in prefillData && prefillData.amount !== undefined) {
          prefillFields.amount = true;
        }
        if ('recipient' in prefillData && prefillData.recipient !== undefined) {
          prefillFields.recipient = true;
        }
        // Handle swap-specific fields
        if ('fromChainID' in prefillData && prefillData.fromChainID !== undefined) {
          prefillFields.fromChainID = true;
        }
        if ('toChainID' in prefillData && prefillData.toChainID !== undefined) {
          prefillFields.toChainID = true;
        }
        if ('fromTokenAddress' in prefillData && prefillData.fromTokenAddress !== undefined) {
          prefillFields.fromTokenAddress = true;
        }
        if ('toTokenAddress' in prefillData && prefillData.toTokenAddress !== undefined) {
          prefillFields.toTokenAddress = true;
        }
        if ('fromAmount' in prefillData && prefillData.fromAmount !== undefined) {
          prefillFields.fromAmount = true;
        }
        if ('toAmount' in prefillData && prefillData.toAmount !== undefined) {
          prefillFields.toAmount = true;
        }
      }
      const normalizedPrefillData =
        type === 'bridgeAndExecute' &&
        'toChainId' in prefillData &&
        prefillData.toChainId !== undefined
          ? { ...prefillData, chainId: prefillData.toChainId }
          : prefillData;

      setActiveTransaction({
        ...initialState,
        type,
        status: isSdkInitialized ? 'review' : 'initializing',
        inputData: normalizedPrefillData as any,
        prefillFields,
      });
    },
    [isSdkInitialized],
  );

  const cancelTransaction = useCallback(async () => {
    setIsSimulating(false);
    setInsufficientBalance(false);
    setIsTransactionCollapsed(true);
    setTimer(0);
    setActiveTransaction(initialState);
    resetProcessingState();
    if (isSdkInitialized && sdk) {
      try {
        const updatedBalance = await sdk.getUnifiedBalances();
        setUnifiedBalance(updatedBalance);
      } catch (err) {
        logger.warn('Failed to refetch unified balance after transaction completion:', err);
      }
    }
  }, [isSdkInitialized, sdk, resetProcessingState]);

  const toggleTransactionCollapse = useCallback(() => {
    setIsTransactionCollapsed((prev) => !prev);
  }, []);

  const updateInput = useCallback(
    (
      data:
        | Partial<BridgeParams>
        | Partial<TransferParams>
        | Partial<BridgeAndExecuteParams>
        | Partial<SwapInputData>,
    ) => {
      setActiveTransaction((prev) => ({
        ...prev,
        inputData: { ...prev.inputData, ...data } as any,
        reviewStatus: 'gathering_input',
        status: prev.status === 'simulation_error' ? 'review' : prev.status,
        error: prev.status === 'simulation_error' ? null : prev.error,
      }));

      setIsSimulating(false);
      setInsufficientBalance(false);
    },
    [],
  );

  const checkInsufficientBalance = useCallback(
    (inputData: Partial<BridgeConfig> | Partial<TransferConfig> | Partial<SwapInputData>) => {
      const token = getTokenFromInputData(inputData);
      const amount = getAmountFromInputData(inputData);

      if (!token || !amount || !unifiedBalance.length) {
        return false;
      }

      const tokenBalance = unifiedBalance.find((asset) => asset.symbol === token);
      if (!tokenBalance) {
        logger.warn('Token not found in unified balance:', {
          requestedToken: token,
          availableTokens: unifiedBalance.map((asset) => asset.symbol),
        });
        return true; // Consider it insufficient if token not found
      }

      const requestedAmount = parseFloat(amount.toString());
      const availableBalance = parseFloat(tokenBalance.balance);

      const isInsufficient = requestedAmount > availableBalance;

      if (isInsufficient) {
        logger.warn('Insufficient balance detected:', {
          token: token,
          requested: requestedAmount,
          available: availableBalance,
          deficit: requestedAmount - availableBalance,
        });
      }

      return isInsufficient;
    },
    [unifiedBalance],
  );

  const retrySimulation = useCallback(() => {
    setIsSimulating(false);
    setActiveTransaction((prev) => ({
      ...prev,
      status: 'review',
      error: null,
      reviewStatus: 'gathering_input',
    }));
  }, []);

  const triggerSimulation = useCallback(async () => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
      debounceTimeoutRef.current = null;
    }

    const conditions = {
      isSdkInitialized,
      statusOk:
        activeTransaction.status === 'review' || activeTransaction.status === 'simulation_error',
      reviewStatusOk: activeTransaction.reviewStatus === 'gathering_input',
      hasController: !!activeController,

      hasSufficientInput: activeTransaction.inputData
        ? (() => {
            if (activeTransaction.type === 'swap') {
              // For swaps, check if we have sufficient input directly
              const data = activeTransaction.inputData as Partial<SwapInputData>;
              return !!(
                data.fromChainID &&
                data.toChainID &&
                data.fromTokenAddress &&
                data.toTokenAddress &&
                data.fromAmount &&
                parseFloat(data.fromAmount?.toString() || '0') > 0
              );
            } else if (activeController) {
              return activeController.hasSufficientInput(activeTransaction.inputData as any);
            }
            return false;
          })()
        : false,
      notSimulating: !isSimulating,
    };

    if (
      activeTransaction.inputData &&
      conditions.isSdkInitialized &&
      conditions.statusOk &&
      conditions.reviewStatusOk &&
      (activeController || activeTransaction.type === 'swap') && // Swaps don't use controller
      conditions.hasSufficientInput &&
      conditions.notSimulating
    ) {
      const { inputData } = activeTransaction;

      const hasInsufficientBalance = checkInsufficientBalance(inputData as any);
      setInsufficientBalance(hasInsufficientBalance);

      if (hasInsufficientBalance) {
        // Clear simulation result and ensure we stay in review mode for insufficient balance
        setActiveTransaction((prev) => ({
          ...prev,
          simulationResult: null,
          reviewStatus: 'gathering_input',
          status: 'review', // Explicitly ensure we stay in review mode
        }));
        setIsSimulating(false); // Ensure simulation state is cleared
        return;
      }

      setIsSimulating(true);

      debounceTimeoutRef.current = setTimeout(async () => {
        // Check if input has changed since this timeout was set (simple cancellation)
        const currentInputData = activeTransaction.inputData;
        if (
          getAmountFromInputData(currentInputData as any) !==
            getAmountFromInputData(inputData as any) ||
          getTokenFromInputData(currentInputData as any) !==
            getTokenFromInputData(inputData as any) ||
          getInputChainId(currentInputData as any) !== getInputChainId(inputData as any)
        ) {
          setIsSimulating(false); // Reset simulation state
          return;
        }

        // Clear previous simulation result when starting new simulation
        setActiveTransaction((prev) => ({
          ...prev,
          simulationResult: null,
          reviewStatus: 'simulating',
          status: 'review', // Explicitly maintain review status
        }));

        try {
          let simulationResult: any;

          if (activeTransaction.type === 'swap') {
            // For swaps, we skip simulation here since it's handled by initiateSwap
            // This code path should not be reached for swaps anymore
            await initiateSwap(inputData as SwapInputData);
            return;
          } else if (activeController) {
            // Handle regular transaction controllers
            simulationResult = await activeController.runReview(sdk, inputData);
          } else {
            throw new Error('No controller available for transaction type');
          }

          // Final check before applying results - ensure input hasn't changed
          const finalInputData = activeTransaction.inputData;
          if (
            getAmountFromInputData(finalInputData as any) !==
              getAmountFromInputData(inputData as any) ||
            getTokenFromInputData(finalInputData as any) !==
              getTokenFromInputData(inputData as any) ||
            getInputChainId(finalInputData as any) !== getInputChainId(inputData as any)
          ) {
            setIsSimulating(false);
            return;
          }

          // Check if simulation failed
          if (
            simulationResult &&
            (('success' in simulationResult && !simulationResult.success) ||
              ('error' in simulationResult && simulationResult.error) ||
              // For bridge simulation within BridgeAndExecuteSimulationResult
              // Only consider null bridgeSimulation a failure if bridge wasn't intentionally skipped
              ('bridgeSimulation' in simulationResult &&
                simulationResult.bridgeSimulation === null &&
                !(simulationResult as BridgeAndExecuteSimulationResult)?.metadata?.bridgeSkipped))
          ) {
            setActiveTransaction((prev) => ({
              ...prev,
              simulationResult,
              status: 'simulation_error',
              error: new Error(
                'error' in simulationResult
                  ? simulationResult.error || 'Simulation failed'
                  : 'Simulation failed',
              ),
              reviewStatus: 'gathering_input',
            }));
            return;
          }

          setActiveTransaction((prev) => ({
            ...prev,
            simulationResult,
            reviewStatus: simulationResult?.allowance?.needsApproval ? 'needs_allowance' : 'ready',
            status: 'review',
          }));
        } catch (err) {
          logger.error('Simulation failed:', err as Error);
          const error = err instanceof Error ? err : new Error('Simulation failed.');
          setActiveTransaction((prev) => ({
            ...prev,
            status: 'simulation_error',
            error,
            reviewStatus: 'gathering_input',
          }));
        } finally {
          setIsSimulating(false);
        }
      }, 2000);
    }
  }, [
    activeTransaction.status,
    activeTransaction.reviewStatus,
    activeTransaction.inputData,
    activeController,
    sdk,
    isSdkInitialized,
    checkInsufficientBalance,
  ]);

  const confirmAndProceed = useCallback(async () => {
    if (!activeController || !activeTransaction.inputData || !activeTransaction.simulationResult)
      return;

    if (insufficientBalance) {
      logger.warn('Attempted to process transaction with insufficient balance');
      return;
    }

    if (isSimulating) {
      logger.warn('Attempted to process transaction while simulation is running');
      return;
    }

    if (activeTransaction.status !== 'review') {
      logger.warn(
        'Attempted to process transaction from invalid status:',
        activeTransaction.status,
      );
      return;
    }

    if (
      activeTransaction.reviewStatus !== 'ready' &&
      activeTransaction.reviewStatus !== 'needs_allowance'
    ) {
      logger.warn(
        'Attempted to process transaction with invalid review status:',
        activeTransaction.reviewStatus,
      );
      return;
    }

    if (activeTransaction.type === 'swap') {
      // Swaps should not use confirmAndProceed - they use proceedWithSwap instead
      logger.error(
        'confirmAndProceed should not be called for swaps - use proceedWithSwap instead',
      );
      throw new Error(
        'confirmAndProceed should not be called for swaps - use proceedWithSwap instead',
      );
    }

    if (!activeController) {
      throw new Error('No controller available for transaction type');
    }

    setActiveTransaction((prev) => ({ ...prev, status: 'processing' }));
    try {
      // Handle regular transaction controllers
      const executionResult = await activeController.confirmAndProceed(
        sdk,
        activeTransaction.inputData,
        activeTransaction.simulationResult,
      );

      // For non-swap transactions, use the traditional success/error handling
      setActiveTransaction((prev) => ({
        ...prev,
        status: executionResult?.success ? 'success' : 'error',
        error: executionResult?.error ? new Error(executionResult.error) : null,
        executionResult,
      }));
    } catch (err) {
      logger.error('Transaction failed.', err as Error);
      const error = err instanceof Error ? err : new Error('Transaction failed.');
      setActiveTransaction((prev) => ({ ...prev, status: 'error', error }));
    }
  }, [
    activeController,
    sdk,
    activeTransaction.inputData,
    activeTransaction.simulationResult,
    insufficientBalance,
    isSimulating,
    activeTransaction.status,
    activeTransaction.reviewStatus,
  ]);

  // Single function to handle entire swap flow
  const initiateSwap = useCallback(
    async (inputData: SwapInputData) => {
      try {
        logger.info('Swap Provider: Starting swap process', inputData);

        // Validate required fields
        if (
          !inputData?.fromChainID ||
          !inputData?.toChainID ||
          !inputData?.toTokenAddress ||
          !inputData?.fromAmount ||
          !inputData?.fromTokenAddress
        ) {
          throw new Error('Missing required fields for swap');
        }

        // Convert SwapInputData to SwapInput format for SDK
        const fromAmountStr = inputData.fromAmount ?? '0';
        const fromAmountNumber = parseFloat(fromAmountStr.toString());

        if (isNaN(fromAmountNumber) || fromAmountNumber <= 0) {
          throw new Error('Invalid amount provided for swap');
        }

        const actualFromTokenAddress = getTokenAddress(
          inputData.fromTokenAddress,
          inputData.fromChainID,
          'swap',
        );
        const actualToTokenAddress = getTokenAddress(
          inputData.toTokenAddress,
          inputData.toChainID,
          'swap',
        );

        const swapInput: ExactInSwapInput = {
          from: [
            {
              chainId: inputData.fromChainID,
              amount: parseUnits(
                fromAmountStr.toString(),
                TOKEN_METADATA[inputData?.fromTokenAddress]?.decimals,
              ),
              tokenAddress: actualFromTokenAddress as `0x${string}`,
            },
          ],
          toChainId: inputData.toChainID,
          toTokenAddress: actualToTokenAddress as `0x${string}`,
        };

        logger.info('Swap Provider: Prepared swap input', swapInput);

        // Start the swap process
        sdk
          .swapWithExactIn(swapInput, {
            swapIntentHook: async (data: Parameters<SwapIntentHook>[0]) => {
              swapAllowCallbackRef.current = data.allow;
              // Update UI with captured intent (simulation result)
              setActiveTransaction((prev) => ({
                ...prev,
                simulationResult: {
                  success: true,
                  intent: data.intent,
                  swapMetadata: {
                    type: 'swap' as const,
                    inputToken: actualFromTokenAddress as `0x${string}`,
                    outputToken: swapInput.toTokenAddress,
                    fromChainId: inputData?.fromChainID,
                    toChainId: inputData.toChainID,
                    inputAmount: inputData?.fromAmount ?? '',
                    outputAmount: data.intent.destination?.amount?.toString() ?? '0',
                  },
                  allowance: {
                    needsApproval: false,
                    chainDetails: [],
                  },
                },
                reviewStatus: 'ready',
                status: 'review',
              }));
            },
          })
          .then((result) => {
            if (result.success) {
              // Swap succeeded - let useListenTransaction handle the success state
              logger.info('Swap Provider: Swap execution succeeded');
              setActiveTransaction((prev) => ({
                ...prev,
                status: 'success',
              }));
            } else {
              // Swap failed - this captures your error!
              logger.error('Swap Provider: Swap execution failed:', result.error);

              // Set a flag to prevent success callbacks from overriding this error
              setActiveTransaction((prev) => ({
                ...prev,
                status: 'simulation_error',
                reviewStatus: 'gathering_input', // Reset reviewStatus to stop loading state
                error: new Error(result?.error ?? 'Swap execution failed'),
                executionResult: result,
              }));

              // Clear the allow callback to prevent further execution
              swapAllowCallbackRef.current = null;
            }
          })
          .catch((error) => {
            // Network/SDK errors
            logger.error('Swap Provider: Swap SDK error:', error);
            const errorMessage = formatSwapError(error);
            setActiveTransaction((prev) => ({
              ...prev,
              status: 'simulation_error',
              reviewStatus: 'gathering_input', // Reset reviewStatus to stop loading state
              error: new Error(errorMessage),
            }));
          })
          .finally(() => {
            setIsSwapExecuting(false);
            swapAllowCallbackRef.current = null;
          });
      } catch (error) {
        logger.error('Swap Provider: Swap initiation failed:', error as Error);
        const errorMessage = formatSwapError(error);
        setActiveTransaction((prev) => ({
          ...prev,
          status: 'simulation_error',
          error: new Error(errorMessage),
        }));
      }
    },
    [sdk],
  );

  // Function called when user clicks "Swap" button
  const proceedWithSwap = useCallback(() => {
    if (swapAllowCallbackRef.current && !isSwapExecuting) {
      logger.info('Swap Provider: User confirmed swap - executing');
      setIsSwapExecuting(true);
      setActiveTransaction((prev) => ({ ...prev, status: 'processing' }));

      // This triggers the .then() block above
      swapAllowCallbackRef.current();
    } else {
      logger.warn('Swap Provider: No allow callback available or already executing', {
        hasCallback: !!swapAllowCallbackRef.current,
        isExecuting: isSwapExecuting,
      });
    }
  }, [isSwapExecuting]);

  const approveAllowance = useCallback(
    async (amount: string, isMinimum: boolean) => {
      if (
        !activeController ||
        !activeTransaction.inputData ||
        !activeTransaction.simulationResult
      ) {
        return;
      }

      if (activeTransaction.status !== 'set_allowance') {
        logger.warn(
          'Attempted to approve allowance from invalid status:',
          activeTransaction.status,
        );
        return;
      }

      setIsSettingAllowance(true);
      setAllowanceError(null);

      try {
        // For each source chain that needs allowance, set it
        const { inputData, simulationResult } = activeTransaction;

        // Use chain-specific allowance details if available
        const chainDetails = simulationResult?.allowance?.chainDetails;
        if (chainDetails && chainDetails.length > 0) {
          // Use the new chain-specific approach
          for (const chainDetail of chainDetails) {
            if (chainDetail.needsApproval) {
              const token = getTokenFromInputData(inputData);
              if (!token) continue;

              const tokenMeta = sdk.utils.getTokenMetadata(token as any);
              const amountToApprove = isMinimum
                ? sdk.utils.parseUnits(amount, tokenMeta?.decimals ?? 18)
                : sdk.utils.parseUnits(amount, tokenMeta?.decimals ?? 18);

              await sdk.setAllowance(chainDetail.chainId, [token as any], amountToApprove);
            }
          }
        } else {
          // Fallback to original approach for backward compatibility
          let sourcesData: Array<{ chainID: number; amount: string }> =
            (simulationResult as SimulationResult)?.intent?.sources || [];

          // If bridge & execute simulation, sources are inside bridgeSimulation
          if (sourcesData.length === 0 && 'bridgeSimulation' in (simulationResult as any)) {
            const bridgeSim = (simulationResult as any).bridgeSimulation as SimulationResult;
            sourcesData = bridgeSim?.intent?.sources || [];
          }

          for (const source of sourcesData) {
            const token = getTokenFromInputData(inputData);
            if (!token) continue;

            const tokenMeta = sdk.utils.getTokenMetadata(token as any);
            const amountToApprove = isMinimum
              ? sdk.utils.parseUnits(amount, tokenMeta?.decimals ?? 18)
              : sdk.utils.parseUnits(amount, tokenMeta?.decimals ?? 18);

            await sdk.setAllowance(source.chainID, [token as any], amountToApprove);
          }
        }

        // After successful allowance setting, proceed directly to transaction
        setActiveTransaction((prev) => ({ ...prev, status: 'processing' }));

        try {
          const executionResult = await activeController.confirmAndProceed(
            sdk,
            inputData,
            simulationResult,
          );
          setActiveTransaction((prev) => ({
            ...prev,
            status: executionResult?.success ? 'success' : 'error',
            error: executionResult?.error ? new Error(executionResult.error) : null,
            executionResult,
          }));
        } catch (execErr) {
          logger.error('Transaction failed after allowance approval.', execErr as Error);
          const error = execErr instanceof Error ? execErr : new Error('Transaction failed.');
          setActiveTransaction((prev) => ({ ...prev, status: 'error', error }));
        }
      } catch (err) {
        logger.error('Allowance setting failed:', err as Error);
        const error = err instanceof Error ? err : new Error('Failed to set allowance.');
        setAllowanceError(error.message);
      } finally {
        setIsSettingAllowance(false);
      }
    },
    [
      activeController,
      sdk,
      activeTransaction.inputData,
      activeTransaction.simulationResult,
      activeTransaction.status,
    ],
  );

  const denyAllowance = useCallback(() => {
    setActiveTransaction((prev) => ({
      ...prev,
      status: 'review',
      reviewStatus: 'needs_allowance',
    }));
    setAllowanceError(null);
  }, []);

  const startAllowanceFlow = useCallback(() => {
    if (
      activeTransaction.status !== 'review' ||
      activeTransaction.reviewStatus !== 'needs_allowance'
    ) {
      logger.warn('Attempted to start allowance flow from invalid state:', {
        status: activeTransaction.status,
        reviewStatus: activeTransaction.reviewStatus,
      });
      return;
    }

    setActiveTransaction((prev) => ({
      ...prev,
      status: 'set_allowance',
    }));
    setAllowanceError(null);
  }, [activeTransaction.status, activeTransaction.reviewStatus]);

  useEffect(() => {
    if (
      activeTransaction.status === 'review' &&
      activeTransaction.reviewStatus === 'gathering_input' &&
      activeTransaction.inputData
    ) {
      triggerSimulation();
    }
  }, [
    getAmountFromInputData(activeTransaction.inputData),
    getTokenFromInputData(activeTransaction.inputData),
    getInputChainId(activeTransaction.inputData),
    activeTransaction.status,
    activeTransaction.reviewStatus,
    activeTransaction.type,
    triggerSimulation,
    initiateSwap,
  ]);

  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
        debounceTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (activeTransaction.status === 'processing') {
      timerRef.current = setInterval(() => {
        setTimer((prev) => prev + 0.1);
      }, 100);
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [activeTransaction.status]);

  const value: NexusContextValue = useMemo(
    () => ({
      // State
      sdk,
      activeTransaction,
      isSdkInitialized,
      activeController,
      disableCollapse,
      config,
      provider,
      unifiedBalance,
      exchangeRates,
      isSimulating,
      insufficientBalance,
      isTransactionCollapsed,
      timer,
      allowanceError,
      isSettingAllowance,

      // Transaction processing state
      processing,
      explorerURL,
      explorerURLs,

      // Actions
      setProvider,
      startTransaction,
      updateInput,
      confirmAndProceed,
      cancelTransaction,
      initializeSdk,
      deinitializeSdk,
      triggerSimulation,
      retrySimulation,
      toggleTransactionCollapse,
      approveAllowance,
      denyAllowance,
      startAllowanceFlow,

      // Swap-specific functions
      initiateSwap,
      proceedWithSwap,
    }),
    [
      sdk,
      activeTransaction,
      isSdkInitialized,
      activeController,
      config,
      provider,
      setProvider,
      startTransaction,
      updateInput,
      confirmAndProceed,
      cancelTransaction,
      initializeSdk,
      deinitializeSdk,
      triggerSimulation,
      retrySimulation,
      unifiedBalance,
      exchangeRates,
      isSimulating,
      insufficientBalance,
      isTransactionCollapsed,
      toggleTransactionCollapse,
      timer,
      allowanceError,
      isSettingAllowance,
      processing,
      explorerURL,
      explorerURLs,
      approveAllowance,
      denyAllowance,
      startAllowanceFlow,
      initiateSwap,
      proceedWithSwap,
    ],
  );

  return (
    <NexusContext.Provider value={value}>
      <DragConstraintsProvider>
        <LayoutGroup id="tx-processor-layout-group">
          {children}
          <TransactionProcessorShell disableCollapse={disableCollapse} />
        </LayoutGroup>
      </DragConstraintsProvider>
    </NexusContext.Provider>
  );
}

export function useInternalNexus() {
  const context = useContext(NexusContext);
  if (!context) {
    throw new Error('useInternalNexus must be used within a NexusProvider');
  }
  return context;
}
