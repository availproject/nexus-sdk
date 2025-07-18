'use client';
import React, {
  createContext,
  useContext,
  useState,
  ReactNode,
  useCallback,
  useMemo,
  useEffect,
  useRef,
} from 'react';
import { NexusSDK } from '../../core/sdk';
import {
  EthereumProvider,
  UserAsset,
  BridgeParams,
  TransferParams,
  BridgeAndExecuteParams,
  SimulationResult,
  NexusNetwork,
} from '../../types';
import type {
  ActiveTransaction,
  BridgeConfig,
  NexusContextValue,
  TransactionType,
  ITransactionController,
} from '../types';
import type { TransferConfig } from '../controllers/TransferController';
import { BridgeController } from '../controllers/BridgeController';
import { TransferController } from '../controllers/TransferController';
import { BridgeAndExecuteController } from '../controllers/BridgeAndExecuteController';
import { TransactionProcessorShell } from '../components/processing/transaction-processor-shell';
import { DragConstraintsProvider } from '../components/shared';
import { LayoutGroup } from 'motion/react';
import useListenTransaction from '../hooks/useListenTransaction';
import { logger } from '../../core/utils';

const controllers: Record<TransactionType, ITransactionController> = {
  bridge: new BridgeController(),
  transfer: new TransferController(),
  bridgeAndExecute: new BridgeAndExecuteController(),
};

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
}: {
  config?: { network?: NexusNetwork; debug?: boolean };
  children: ReactNode;
}) {
  const [sdk] = useState(
    () => new NexusSDK({ network: config?.network ?? 'mainnet', debug: config?.debug ?? false }),
  );
  const [provider, setProvider] = useState<EthereumProvider | null>(null);
  const [isSdkInitialized, setIsSdkInitialized] = useState(false);
  const [activeTransaction, setActiveTransaction] = useState<ActiveTransaction>(initialState);
  const [unifiedBalance, setUnifiedBalance] = useState<UserAsset[]>([]);
  const [isSimulating, setIsSimulating] = useState(false);
  const [insufficientBalance, setInsufficientBalance] = useState(false);
  const [isTransactionCollapsed, setIsTransactionCollapsed] = useState(false);
  const [timer, setTimer] = useState(0);
  const [allowanceError, setAllowanceError] = useState<string | null>(null);
  const [isSettingAllowance, setIsSettingAllowance] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const { processing, explorerURL, resetProcessingState } = useListenTransaction({
    sdk,
    activeTransaction,
  });

  const activeController = useMemo(
    () => (activeTransaction.type ? controllers[activeTransaction.type] : null),
    [activeTransaction.type],
  );

  const initializeSdk = useCallback(async () => {
    if (isSdkInitialized) return true;
    if (!provider) {
      setActiveTransaction((prev) => ({
        ...prev,
        status: 'simulation_error',
        error: new Error('Wallet provider not connected.'),
      }));
      return false;
    }
    try {
      setActiveTransaction((prev) => ({ ...prev, status: 'initializing' }));
      await sdk.initialize(provider);
      const unifiedBalance = await sdk.getUnifiedBalances();
      logger.debug('Unified balance', { unifiedBalance });
      setUnifiedBalance(unifiedBalance);
      setIsSdkInitialized(true);
      setActiveTransaction((prev) => ({ ...prev, status: 'review' }));
      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('SDK Initialization failed.');
      setActiveTransaction((prev) => ({ ...prev, status: 'simulation_error', error }));
      return false;
    }
  }, [provider, sdk, isSdkInitialized]);

  const startTransaction = useCallback(
    (
      type: TransactionType,
      prefillData:
        | Partial<BridgeConfig>
        | Partial<TransferConfig>
        | Partial<BridgeAndExecuteParams> = {},
    ) => {
      // Track which fields were prefilled
      const prefillFields: {
        chainId?: boolean;
        toChainId?: boolean;
        token?: boolean;
        amount?: boolean;
        recipient?: boolean;
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
        inputData: normalizedPrefillData,
        prefillFields,
      });
    },
    [isSdkInitialized],
  );

  const cancelTransaction = useCallback(async () => {
    setIsSimulating(false);
    setInsufficientBalance(false);
    setIsTransactionCollapsed(false);
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
    (data: Partial<BridgeConfig> | Partial<TransferConfig> | Partial<BridgeAndExecuteParams>) => {
      setActiveTransaction((prev) => ({
        ...prev,
        inputData: { ...prev.inputData, ...data },
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
    (inputData: Partial<BridgeConfig> | Partial<TransferConfig>) => {
      if (!inputData.token || !inputData.amount || !unifiedBalance.length) {
        return false;
      }

      const tokenBalance = unifiedBalance.find((asset) => asset.symbol === inputData.token);
      if (!tokenBalance) return false;

      const requestedAmount = parseFloat(inputData.amount.toString());
      const availableBalance = parseFloat(tokenBalance.balance);

      return requestedAmount > availableBalance;
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

      hasSufficientInput:
        activeController && activeTransaction.inputData
          ? (() => {
              let inputDataForValidation = activeTransaction.inputData;
              if (activeTransaction.type === 'bridgeAndExecute') {
                inputDataForValidation = {
                  ...activeTransaction.inputData,
                  toChainId: (activeTransaction.inputData as any).chainId,
                };
              }
              return activeController.hasSufficientInput(inputDataForValidation as any);
            })()
          : false,
      notSimulating: !isSimulating,
    };

    if (
      activeController &&
      activeTransaction.inputData &&
      conditions.isSdkInitialized &&
      conditions.statusOk &&
      conditions.reviewStatusOk &&
      conditions.hasController &&
      conditions.hasSufficientInput &&
      conditions.notSimulating
    ) {
      const { inputData } = activeTransaction;

      const hasInsufficientBalance = checkInsufficientBalance(inputData);
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
          currentInputData?.amount !== inputData.amount ||
          currentInputData?.token !== inputData.token ||
          getInputChainId(currentInputData) !== getInputChainId(inputData)
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
          // Convert chainId to toChainId for bridge-and-execute before simulation
          let inputDataForSimulation = inputData;
          if (activeTransaction.type === 'bridgeAndExecute') {
            inputDataForSimulation = {
              ...inputData,
              toChainId: (inputData as any).chainId,
            };
          }

          const simulationResult = await activeController.runReview(sdk, inputDataForSimulation);

          // Final check before applying results - ensure input hasn't changed
          const finalInputData = activeTransaction.inputData;
          if (
            finalInputData?.amount !== inputData.amount ||
            finalInputData?.token !== inputData.token ||
            getInputChainId(finalInputData) !== getInputChainId(inputData)
          ) {
            setIsSimulating(false);
            return;
          }

          // Check if simulation failed
          if (
            simulationResult &&
            // For BridgeAndExecuteSimulationResult
            (('success' in simulationResult && !simulationResult.success) ||
              ('error' in simulationResult && simulationResult.error) ||
              // For bridge simulation within BridgeAndExecuteSimulationResult
              ('bridgeSimulation' in simulationResult &&
                simulationResult.bridgeSimulation === null))
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

    setActiveTransaction((prev) => ({ ...prev, status: 'processing' }));
    try {
      const executionResult = await activeController.confirmAndProceed(
        sdk,
        activeTransaction.inputData,
        activeTransaction.simulationResult,
      );
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

        let sourcesData: Array<{ chainID: number; amount: string }> =
          (simulationResult as SimulationResult)?.intent?.sources || [];

        // If bridge & execute simulation, sources are inside bridgeSimulation
        if (sourcesData.length === 0 && 'bridgeSimulation' in (simulationResult as any)) {
          const bridgeSim = (simulationResult as any).bridgeSimulation as SimulationResult;
          sourcesData = bridgeSim?.intent?.sources || [];
        }

        for (const source of sourcesData) {
          const tokenMeta = sdk.utils.getTokenMetadata(inputData.token!);
          const amountToApprove = isMinimum
            ? sdk.utils.parseUnits(amount, tokenMeta?.decimals ?? 18)
            : sdk.utils.parseUnits(amount, tokenMeta?.decimals ?? 18);

          await sdk.setAllowance(source.chainID, [inputData.token!], amountToApprove);
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
        const error = err instanceof Error ? err : new Error('Failed to set allowance.');
        setAllowanceError(error.message);
        logger.error('Allowance setting failed:', error);
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
    activeTransaction.inputData?.amount,
    activeTransaction.inputData?.token,
    getInputChainId(activeTransaction.inputData),
    activeTransaction.status,
    activeTransaction.reviewStatus,
    triggerSimulation,
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
      config,
      provider,
      unifiedBalance,
      isSimulating,
      insufficientBalance,
      isTransactionCollapsed,
      timer,
      allowanceError,
      isSettingAllowance,

      // Transaction processing state
      processing,
      explorerURL,

      // Actions
      setProvider,
      startTransaction,
      updateInput,
      confirmAndProceed,
      cancelTransaction,
      initializeSdk,
      triggerSimulation,
      retrySimulation,
      toggleTransactionCollapse,
      approveAllowance,
      denyAllowance,
      startAllowanceFlow,
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
      triggerSimulation,
      retrySimulation,
      unifiedBalance,
      isSimulating,
      insufficientBalance,
      isTransactionCollapsed,
      toggleTransactionCollapse,
      timer,
      allowanceError,
      isSettingAllowance,
      processing,
      explorerURL,
      approveAllowance,
      denyAllowance,
      startAllowanceFlow,
    ],
  );

  return (
    <NexusContext.Provider value={value}>
      <DragConstraintsProvider>
        <LayoutGroup id="tx-processor-layout-group">
          {children}
          <TransactionProcessorShell />
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
