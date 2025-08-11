import React, { useState } from 'react';
import { BaseModal } from '../motion/base-modal';
import { useInternalNexus } from '../../providers/InternalNexusProvider';
import { cn, getButtonText, getContentKey } from '../../utils/utils';
import { type TransactionType } from '../../utils/balance-utils';
import { TransactionSimulation } from '../processing/transaction-simulation';
import { AvailLogo } from '../icons/AvailLogo';
import { BridgeConfig, TransferConfig } from '../../types';
import { BridgeAndExecuteParams } from '../../../types';
import UnifiedBalance from './unified-balance';
import { InfoMessage } from './info-message';
import { AllowanceForm } from './allowance-form';
import { DialogFooter, DialogHeader, DialogTitle } from '../motion/dialog-motion';
import { SlideTransition } from '../motion/slide-transition';
import { EnhancedInfoMessage } from './enhanced-info-message';
import { ActionButtons } from './action-buttons';

interface UnifiedTransactionModalProps {
  transactionType: TransactionType;
  modalTitle: string;
  FormComponent: React.ComponentType<{
    inputData: any;
    onUpdate: (
      data: Partial<BridgeConfig> | Partial<TransferConfig> | Partial<BridgeAndExecuteParams>,
    ) => void;
    disabled: boolean;
    prefillFields?: any;
  }>;
  getSimulationError?: (simulationResult: any) => boolean;
  getMinimumAmount?: (simulationResult: any) => string;
  getSourceChains?: (
    simulationResult: any,
  ) => { chainId: number; amount: string; needsApproval?: boolean }[];
  transformInputData?: (inputData: any) => any;
}

export function UnifiedTransactionModal({
  transactionType,
  modalTitle,
  FormComponent,
  getSimulationError,
  getMinimumAmount,
  getSourceChains,
  transformInputData,
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
  const [allowanceFormValid, setAllowanceFormValid] = useState(false);
  const [allowanceApproveHandler, setAllowanceApproveHandler] = useState<(() => void) | null>(null);

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
    } else if (status === 'set_allowance' && allowanceApproveHandler) {
      allowanceApproveHandler();
    } else {
      confirmAndProceed();
    }
  };

  const debouncedClick = () => {
    setTimeout(handleButtonClick, 500);
  };

  const hasSufficientInput = activeController?.hasSufficientInput(inputData || {});
  const shouldShowSimulation = isSdkInitialized && hasSufficientInput;
  const transformedInputData = transformInputData ? transformInputData(inputData) : inputData;

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
        onFormStateChange={(isValid, handler) => {
          setAllowanceFormValid(isValid);
          setAllowanceApproveHandler(() => handler);
        }}
      />
    );
  };

  const getModalTitle = () => {
    if (status === 'initializing') return 'Initialize Nexus';
    if (status === 'set_allowance') return 'Approve Token Allowance';
    return modalTitle;
  };

  const getPrimaryButtonText = () => {
    if (status === 'set_allowance') return 'Approve & Continue';
    return getButtonText(status, reviewStatus);
  };

  const showFooterButtons = status !== 'processing' && status !== 'success' && status !== 'error';

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
      {/* Header - Fixed at top */}
      {showHeader && (
        <DialogHeader className="flex-shrink-0 flex flex-row items-center justify-between relative px-6 py-4 h-16 overflow-hidden w-full">
          <AvailLogo className="absolute top-0 left-1/2 -translate-x-1/2 opacity-10" />
          <DialogTitle className="font-semibold">{getModalTitle()}</DialogTitle>
        </DialogHeader>
      )}

      {/* Content - Flexible middle area */}
      <div
        className={cn(
          'flex-1 flex flex-col overflow-hidden w-full',
          status !== 'set_allowance' && transactionType !== 'transfer' ? 'mt-14' : '',
        )}
      >
        <SlideTransition contentKey={getContentKey(status, [reviewStatus])}>
          {(status === 'initializing' || status === 'review' || status === 'simulation_error') && (
            <>
              <UnifiedBalance />

              <FormComponent
                inputData={transformedInputData || {}}
                onUpdate={updateInput}
                disabled={!isSdkInitialized}
                prefillFields={prefillFields}
              />
              <div className="flex-1 flex flex-col py-4 w-full overflow-y-auto">
                {!isSdkInitialized && (
                  <InfoMessage variant="success" className="mt-4">
                    Sign a quick message to turn on cross-chain transfers. Don&apos;t worry
                    it&apos;s gasless & no funds will move yet.
                  </InfoMessage>
                )}

                {isSdkInitialized && insufficientBalance && (
                  <InfoMessage variant="error" className="mt-4">
                    <div className="space-y-2">
                      <p className="font-semibold">Insufficient {inputData?.token} balance</p>
                      <p className="text-sm">
                        You don't have enough {inputData?.token} to complete this transaction.
                        {transactionType === 'bridgeAndExecute'
                          ? ' Consider using a smaller amount or add more funds to your wallet.'
                          : ' Please add more funds to your wallet or reduce the transaction amount.'}
                      </p>
                    </div>
                  </InfoMessage>
                )}
                {(activeTransaction?.error && status === 'simulation_error') ||
                (simulationResult && getSimulationError && getSimulationError(simulationResult)) ? (
                  <EnhancedInfoMessage
                    error={activeTransaction?.error || new Error('Simulation failed')}
                    context="simulation"
                    className="mt-4 w-full"
                  />
                ) : (
                  shouldShowSimulation &&
                  !insufficientBalance &&
                  status !== 'simulation_error' && (
                    <TransactionSimulation
                      isLoading={isSimulating}
                      simulationResult={simulationResult || undefined}
                      inputData={transformedInputData}
                      callback={debouncedClick}
                      type={transactionType}
                    />
                  )
                )}
              </div>
            </>
          )}
          {status === 'set_allowance' && <>{renderAllowanceContent()}</>}
        </SlideTransition>
      </div>

      {/* Footer - Fixed at bottom */}
      {showFooterButtons && (
        <DialogFooter className="flex-shrink-0 w-full mt-auto">
          <ActionButtons
            primaryText={getPrimaryButtonText()}
            onPrimary={handleButtonClick}
            onCancel={cancelTransaction}
            primaryLoading={isBusy || isInitializing}
            primaryDisabled={
              isInitializing ||
              isBusy ||
              insufficientBalance ||
              isSimulating ||
              (status === 'set_allowance' && !allowanceFormValid) ||
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
        </DialogFooter>
      )}
    </BaseModal>
  );
}
