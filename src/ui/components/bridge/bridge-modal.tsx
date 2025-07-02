import React, { useState } from 'react';
import { BaseModal } from '../shared/base-modal';
import { useInternalNexus } from '../../providers/InternalNexusProvider';
import { BridgeAndExecuteSimulationResult, SimulationResult } from '../../../types';
import { getButtonText } from '../../utils/utils';
import { BridgeFormSection } from './bridge-form-section';
import { InfoMessage, ActionButtons, AllowanceForm, EnhancedInfoMessage } from '../shared';
import TransactionProcessor from '../processing/transaction-processor';
import { TransactionSimulation } from '../processing/transaction-simulation';
import { logger } from '../../../utils';

export function BridgeModal() {
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
    isTransactionCollapsed,
    allowanceError,
    isSettingAllowance,
    approveAllowance,
    denyAllowance,
    startAllowanceFlow,
  } = useInternalNexus();

  const { status, reviewStatus, inputData, simulationResult, type, prefillFields } =
    activeTransaction;

  const [isInitializing, setIsInitializing] = useState(false);

  if (type !== 'bridge') {
    return null;
  }

  const isOpen = status !== 'idle' && !isTransactionCollapsed;
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
    if (!activeController) return null;

    const hasSufficientInput = activeController.hasSufficientInput(inputData || {});
    const tokenBalance = unifiedBalance.find((asset) => asset.symbol === inputData?.token)?.balance;

    // Show simulation section only after SDK is initialized and all inputs are complete
    const shouldShowSimulation = isSdkInitialized && hasSufficientInput;

    return (
      <div className="h-full pb-6 w-full">
        <BridgeFormSection
          inputData={inputData || {}}
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

        {activeTransaction.error && status === 'simulation_error' && (
          <EnhancedInfoMessage
            error={activeTransaction.error}
            context="simulation"
            className="mt-4"
          />
        )}

        {shouldShowSimulation && !insufficientBalance && status !== 'simulation_error' && (
          <div className="px-6 mt-4">
            <TransactionSimulation
              isLoading={isSimulating}
              simulationResult={simulationResult || undefined}
            />
          </div>
        )}
      </div>
    );
  };

  const renderAllowanceContent = () => {
    if (!simulationResult || !inputData) return null;

    // Get minimum amount and input amount for allowance
    const minimumAmount = (simulationResult as SimulationResult)?.intent?.sourcesTotal || '0';
    const sourceChains: { chainId: number; amount: string }[] =
      (simulationResult as SimulationResult)?.intent?.sources?.map((source) => ({
        chainId: source.chainID,
        amount: source.amount,
      })) || [];

    return (
      <AllowanceForm
        token={inputData.token || ''}
        minimumAmount={minimumAmount}
        inputAmount={inputData.amount?.toString() || '0'}
        sourceChains={sourceChains}
        onApprove={approveAllowance}
        onCancel={denyAllowance}
        isLoading={isSettingAllowance}
        error={allowanceError}
      />
    );
  };

  const renderProcessingContent = () => {
    if (insufficientBalance || !simulationResult || !inputData) {
      return renderReviewContent();
    }

    try {
      const sources =
        type === 'bridge' || type === 'transfer'
          ? (simulationResult as SimulationResult)?.intent?.sources?.map((s) => s.chainID) || []
          : (
              simulationResult as BridgeAndExecuteSimulationResult
            )?.bridgeSimulation?.intent?.sources?.map((s: any) => s.chainID) || [];

      const token = inputData?.token || '';

      const destination =
        type === 'bridge' || type === 'transfer'
          ? (simulationResult as SimulationResult)?.intent?.destination?.chainID || 0
          : (simulationResult as BridgeAndExecuteSimulationResult)?.bridgeSimulation?.intent
              ?.destination?.chainID || 0;

      const transactionType = type || 'bridge';

      // Additional validation - ensure we have valid data
      if (!sources.length || !token || !destination) {
        logger.warn('Invalid transaction data for processor:', {
          sources,
          token,
          destination,
        });
        return renderReviewContent(); // Fall back to review content
      }

      return (
        <TransactionProcessor
          sources={sources}
          token={token}
          destination={destination}
          transactionType={transactionType}
          onClose={cancelTransaction}
        />
      );
    } catch (error) {
      logger.error('❌ Error rendering TransactionProcessor:', error as Error);
      return (
        <div className="text-center py-12">
          <div className="text-red-600">Error loading processing view</div>
          <pre className="text-xs mt-2">{String(error)}</pre>
          <button
            onClick={cancelTransaction}
            className="mt-4 px-4 py-2 bg-blue-500 text-white rounded"
          >
            Back to Review
          </button>
        </div>
      );
    }
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
        return renderProcessingContent();
      default:
        return null;
    }
  };

  const showFooterButtons =
    status !== 'processing' &&
    status !== 'success' &&
    status !== 'error' &&
    status !== 'set_allowance';
  const preventClose = status === 'processing';

  const getModalTitle = () => {
    switch (status) {
      case 'set_allowance':
        return 'Approve Allowance';
      default:
        return 'Review Information';
    }
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={preventClose ? () => {} : cancelTransaction}
      title={getModalTitle()}
    >
      {renderContent()}

      {showFooterButtons && (
        <ActionButtons
          onCancel={cancelTransaction}
          onPrimary={handleButtonClick}
          primaryText={
            isInitializing
              ? 'Signing...'
              : reviewStatus === 'needs_allowance'
                ? 'Set Allowance'
                : getButtonText(status, reviewStatus)
          }
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
