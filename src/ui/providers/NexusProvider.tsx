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
import { NexusSDK } from '../..';
import {
  BridgeAndExecuteSimulationResult,
  EthereumProvider,
  SimulationResult,
  UserAsset,
} from '../../types';
import type {
  ActiveTransaction,
  BridgeConfig,
  NexusConfig,
  NexusContextValue,
  TransactionType,
  ITransactionController,
} from '../types';
import type { TransferConfig } from '../controllers/TransferController';
import { BridgeController } from '../controllers/BridgeController';
import { TransferController } from '../controllers/TransferController';
import { TransactionProcessorMini } from '../components/processing/transaction-processor-mini';
import useListenTransaction from '../hooks/useListenTransaction';
import { logger } from '../../utils';

const controllers: Record<TransactionType, ITransactionController> = {
  bridge: new BridgeController(),
  transfer: new TransferController(),
  bridgeAndExecute: new BridgeController(), // Placeholder
};

const NexusContext = createContext<NexusContextValue | null>(null);

const initialState: ActiveTransaction = {
  type: null,
  status: 'idle',
  reviewStatus: 'gathering_input',
  inputData: null,
  simulationResult: null,
  executionResult: null,
  error: null,
};

export function NexusProvider({ config, children }: { config: NexusConfig; children: ReactNode }) {
  const [sdk] = useState(() => new NexusSDK(config));
  const [provider, setProvider] = useState<EthereumProvider | null>(null);
  const [isSdkInitialized, setIsSdkInitialized] = useState(false);
  const [activeTransaction, setActiveTransaction] = useState<ActiveTransaction>(initialState);
  const [unifiedBalance, setUnifiedBalance] = useState<UserAsset[]>([]);
  const [isSimulating, setIsSimulating] = useState(false);
  const [insufficientBalance, setInsufficientBalance] = useState(false);
  const [isTransactionCollapsed, setIsTransactionCollapsed] = useState(false);
  const [timer, setTimer] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const activeController = activeTransaction.type ? controllers[activeTransaction.type] : null;
  const { processing, explorerURL, resetProcessingState } = useListenTransaction({
    sdk,
    activeTransaction,
  });

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
    (type: TransactionType, prefillData: Partial<BridgeConfig> | Partial<TransferConfig> = {}) => {
      setActiveTransaction({
        ...initialState,
        type,
        status: isSdkInitialized ? 'review' : 'initializing',
        inputData: prefillData,
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

  const updateInput = useCallback((data: Partial<BridgeConfig> | Partial<TransferConfig>) => {
    setActiveTransaction((prev) => ({
      ...prev,
      inputData: { ...prev.inputData, ...data },
      reviewStatus: 'gathering_input',
      status: prev.status === 'simulation_error' ? 'review' : prev.status,
      error: prev.status === 'simulation_error' ? null : prev.error,
    }));

    setIsSimulating(false);
    setInsufficientBalance(false);
  }, []);

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

    if (
      isSdkInitialized &&
      (activeTransaction.status === 'review' || activeTransaction.status === 'simulation_error') &&
      activeTransaction.reviewStatus === 'gathering_input' &&
      activeController &&
      activeTransaction.inputData &&
      activeController.hasSufficientInput(activeTransaction.inputData) &&
      !isSimulating
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
          currentInputData?.chainId !== inputData.chainId
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
          const simulationResult = await activeController.runReview(sdk, inputData);

          // Final check before applying results - ensure input hasn't changed
          const finalInputData = activeTransaction.inputData;
          if (
            finalInputData?.amount !== inputData.amount ||
            finalInputData?.token !== inputData.token ||
            finalInputData?.chainId !== inputData.chainId
          ) {
            setIsSimulating(false);
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
      console.log('called confirmAndProceed', activeTransaction.inputData);
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
    activeTransaction.inputData?.chainId,
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
      processing,
      explorerURL,
    ],
  );

  const displayMiniProcessor = useMemo(() => {
    return (
      isTransactionCollapsed &&
      activeTransaction.status !== 'review' &&
      activeTransaction.status !== 'simulation_error' &&
      activeTransaction.status !== 'idle' &&
      activeTransaction.status !== 'initializing' &&
      activeTransaction.type &&
      activeTransaction.simulationResult &&
      !insufficientBalance &&
      !isSimulating
    );
  }, [isTransactionCollapsed, activeTransaction, isSimulating, insufficientBalance]);

  return (
    <NexusContext.Provider value={value}>
      {children}
      {displayMiniProcessor && activeTransaction.type && (
        <TransactionProcessorMini
          sources={
            activeTransaction.type === 'bridge' || activeTransaction.type === 'transfer'
              ? (activeTransaction.simulationResult as SimulationResult)?.intent?.sources?.map(
                  (s) => s.chainID,
                ) || []
              : (
                  activeTransaction.simulationResult as BridgeAndExecuteSimulationResult
                )?.bridgeSimulation?.intent?.sources?.map((s) => s.chainID) || []
          }
          token={activeTransaction.inputData?.token || ''}
          destination={
            activeTransaction.type === 'bridge' || activeTransaction.type === 'transfer'
              ? (activeTransaction.simulationResult as any)?.intent?.destination?.chainID || 0
              : (activeTransaction.simulationResult as any)?.bridgeSimulation?.intent?.destination
                  ?.chainID || 0
          }
          transactionType={activeTransaction.type}
        />
      )}
    </NexusContext.Provider>
  );
}

export function useNexus() {
  const context = useContext(NexusContext);
  if (!context) {
    throw new Error('useNexus must be used within a NexusProvider');
  }
  return context;
}
