import React, { useState } from 'react';
import { BaseModal } from './base-modal';
import { useInternalNexus } from '../../providers/InternalNexusProvider';
import { cn, getButtonText, getContentKey } from '../../utils/utils';
import {
  InfoMessage,
  ActionButtons,
  AllowanceForm,
  EnhancedInfoMessage,
  DialogHeader,
  DialogTitle,
  SlideTransition,
} from './';
import { TransactionSimulation } from '../processing/transaction-simulation';
import { AvailLogo } from '../icons/AvailLogo';
import { motion } from 'motion/react';
import { BridgeConfig, TransferConfig } from '../../types';
import { BridgeAndExecuteParams } from '../../../types';

interface UnifiedTransactionModalProps {
  transactionType: 'bridge' | 'transfer' | 'bridgeAndExecute';
  modalTitle: string;
  FormComponent: React.ComponentType<{
    inputData: any;
    onUpdate: (
      data: Partial<BridgeConfig> | Partial<TransferConfig> | Partial<BridgeAndExecuteParams>,
    ) => void;
    disabled: boolean;
    tokenBalance?: string;
    prefillFields?: any;
  }>;
  getSimulationError?: (simulationResult: any) => boolean;
  getMinimumAmount?: (simulationResult: any) => string;
  getSourceChains?: (simulationResult: any) => { chainId: number; amount: string }[];
  transformInputData?: (inputData: any) => any;
  containerClassName?: string;
}

export function UnifiedTransactionModal({
  transactionType,
  modalTitle,
  FormComponent,
  getSimulationError,
  getMinimumAmount,
  getSourceChains,
  transformInputData,
  containerClassName = 'pb-6',
}: UnifiedTransactionModalProps) {
  const {
    activeTransaction,
    activeController,
    updateInput,
    confirmAndProceed,
    cancelTransaction,
    initializeSdk,
    triggerSimulation,
    retrySimulation,
    unifiedBalance,
    isSdkInitialized,
    isSimulating,
    insufficientBalance,
    allowanceError,
    isSettingAllowance,
    approveAllowance,
    denyAllowance,
    startAllowanceFlow,
  } = useInternalNexus();

  const { status, reviewStatus, inputData, simulationResult, type, prefillFields } =
    activeTransaction;
  const [isInitializing, setIsInitializing] = useState(false);

  // Type guard - return null if wrong transaction type
  if (type !== transactionType) {
    return null;
  }

  const isOpen =
    status !== 'idle' && status !== 'processing' && status !== 'success' && status !== 'error';
  const isBusy = status === 'processing' || reviewStatus === 'simulating';

  const handleButtonClick = () => {
    if (status === 'initializing') {
      setIsInitializing(true);
      initializeSdk();
      setIsInitializing(false);
    } else if (status === 'simulation_error') {
      // Reset to review state and trigger simulation again
      retrySimulation();
    } else if (
      status === 'review' &&
      reviewStatus === 'gathering_input' &&
      activeController?.hasSufficientInput(inputData || {})
    ) {
      triggerSimulation();
    } else if (status === 'review' && reviewStatus === 'needs_allowance') {
      startAllowanceFlow();
    } else {
      confirmAndProceed();
    }
  };

  const renderReviewContent = () => {
    const hasSufficientInput = activeController?.hasSufficientInput(inputData || {});
    const tokenBalance = unifiedBalance?.find(
      (asset) => asset?.symbol === inputData?.token,
    )?.balance;

    // Show simulation section only after SDK is initialized and all inputs are complete
    const shouldShowSimulation = isSdkInitialized && hasSufficientInput;

    // Transform input data if needed (for bridge_execute)
    const transformedInputData = transformInputData ? transformInputData(inputData) : inputData;

    return (
      <div className={cn('h-full w-full', containerClassName)}>
        <FormComponent
          inputData={transformedInputData || {}}
          onUpdate={updateInput}
          disabled={!isSdkInitialized}
          tokenBalance={tokenBalance}
          prefillFields={prefillFields}
        />

        {!isSdkInitialized && (
          <InfoMessage variant="success" className="mt-4">
            You need to sign a message in your wallet to allow cross chain transactions using Nexus.
          </InfoMessage>
        )}

        {isSdkInitialized && insufficientBalance && (
          <InfoMessage variant="error" className="mt-4">
            Insufficient balance. You don't have enough {inputData?.token} to complete this
            transaction.
          </InfoMessage>
        )}

        {(activeTransaction?.error && status === 'simulation_error') ||
        (simulationResult && getSimulationError && getSimulationError(simulationResult)) ? (
          <EnhancedInfoMessage
            error={activeTransaction?.error || new Error('Simulation failed')}
            context="simulation"
            className="mt-4"
          />
        ) : (
          shouldShowSimulation &&
          !insufficientBalance &&
          status !== 'simulation_error' && (
            <div className="px-6 mt-4">
              <TransactionSimulation
                isLoading={isSimulating}
                simulationResult={simulationResult || undefined}
              />
            </div>
          )
        )}
      </div>
    );
  };

  const renderAllowanceContent = () => {
    if (!simulationResult || !inputData) return null;

    // Get minimum amount and source chains using provided functions or defaults
    const minimumAmount = getMinimumAmount ? getMinimumAmount(simulationResult) : '0';
    const sourceChains = getSourceChains ? getSourceChains(simulationResult) : [];

    return (
      <AllowanceForm
        token={inputData?.token || ''}
        minimumAmount={minimumAmount}
        inputAmount={inputData?.amount?.toString() || '0'}
        sourceChains={sourceChains}
        onApprove={approveAllowance}
        onCancel={denyAllowance}
        isLoading={isSettingAllowance}
        error={allowanceError}
      />
    );
  };

  const renderContent = () => {
    switch (status) {
      case 'initializing':
      case 'review':
      case 'simulation_error':
        return renderReviewContent();
      case 'set_allowance':
        return renderAllowanceContent();
      case 'processing':
      case 'success':
      case 'error':
        return null;
      default:
        return null;
    }
  };

  const getModalTitle = () => {
    if (status === 'initializing') return 'Initialize Nexus';
    if (status === 'set_allowance') return 'Approve Token Allowance';
    return modalTitle;
  };

  const showFooterButtons =
    status !== 'processing' &&
    status !== 'success' &&
    status !== 'error' &&
    status !== 'set_allowance';

  const preventClose = status === 'processing' || reviewStatus === 'simulating';

  const showHeader =
    activeTransaction?.status !== 'processing' &&
    activeTransaction?.status !== 'success' &&
    activeTransaction?.status !== 'error';

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={preventClose ? () => {} : cancelTransaction}
      hideCloseButton={true}
    >
      <motion.div layoutId="tx-processor" layout="position" className="w-full h-full relative">
        {showHeader && (
          <DialogHeader className="flex flex-row items-center justify-between relative px-6 py-5 h-[88px] w-full">
            <AvailLogo className="absolute top-0 left-1/2 -translate-x-1/2 opacity-10" />
            <DialogTitle className="font-semibold">{getModalTitle()}</DialogTitle>
          </DialogHeader>
        )}
        <SlideTransition contentKey={getContentKey(status, [reviewStatus])}>
          {renderContent()}
        </SlideTransition>
      </motion.div>
      {showFooterButtons && (
        <ActionButtons
          primaryText={getButtonText(status, reviewStatus)}
          onPrimary={handleButtonClick}
          onCancel={cancelTransaction}
          primaryLoading={isBusy || isInitializing}
          primaryDisabled={
            isInitializing ||
            isBusy ||
            insufficientBalance ||
            isSimulating ||
            (status === 'review' &&
              reviewStatus === 'gathering_input' &&
              !activeController?.hasSufficientInput(inputData || {})) ||
            (status === 'review' &&
              reviewStatus !== 'ready' &&
              reviewStatus !== 'needs_allowance' &&
              reviewStatus !== 'gathering_input') ||
            (status === 'simulation_error' &&
              !activeController?.hasSufficientInput(inputData || {}))
          }
          className="border-t border-zinc-400/40 bg-gray-100"
        />
      )}
    </BaseModal>
  );
}
