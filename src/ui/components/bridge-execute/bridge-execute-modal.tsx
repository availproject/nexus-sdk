import React, { useState } from 'react';
import { BaseModal } from '../shared/base-modal';
import { useInternalNexus } from '../../providers/InternalNexusProvider';
import { BridgeAndExecuteSimulationResult } from '../../../types';
import { getButtonText } from '../../utils/utils';

import { InfoMessage, ActionButtons, AllowanceForm, EnhancedInfoMessage } from '../shared';
import TransactionProcessor from '../processing/transaction-processor';
import { TransactionSimulation } from '../processing/transaction-simulation';
import { logger } from '../../../utils';

export function BridgeAndExecuteModal() {
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

  if (type !== 'bridgeAndExecute') {
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

    const inputDataForValidation = inputData
      ? {
          ...inputData,
          toChainId: (inputData as any).chainId,
        }
      : {};

    const hasSufficientInput = activeController.hasSufficientInput(inputDataForValidation);
    const tokenBalance = unifiedBalance.find((asset) => asset.symbol === inputData?.token)?.balance;

    const shouldShowSimulation = isSdkInitialized && hasSufficientInput;

    // Convert chainId to toChainId for bridge-and-execute
    const convertedInputData = inputData
      ? {
          ...inputData,
          toChainId: (inputData as any).chainId,
        }
      : {};

    // Convert field updates from chainId to toChainId for bridge-and-execute
    const handleUpdate = (data: any) => {
      if (data.toChainId !== undefined) {
        // Convert toChainId back to chainId for storage
        const updateData = { ...data, chainId: data.toChainId };
        updateInput(updateData);
      } else {
        updateInput(data);
      }
    };

    return (
      <div className="h-full pb-6 w-full">
        <activeController.InputForm
          prefill={convertedInputData}
          onUpdate={handleUpdate}
          isBusy={!isSdkInitialized}
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

    const bridgeSim = (simulationResult as BridgeAndExecuteSimulationResult)?.bridgeSimulation;
    const minimumAmount = bridgeSim?.intent?.sourcesTotal || '0';
    const sourceChains: { chainId: number; amount: string }[] =
      bridgeSim?.intent?.sources?.map((s) => ({ chainId: s.chainID, amount: s.amount })) || [];

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
      const bridgeSim = (simulationResult as BridgeAndExecuteSimulationResult)?.bridgeSimulation;
      const sources = bridgeSim?.intent?.sources?.map((s) => s.chainID) || [];
      const token = inputData?.token || '';
      const destination = bridgeSim?.intent?.destination?.chainID || 0;
      const transactionType = type;

      if (!sources.length || !token || !destination) {
        return renderReviewContent();
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
      logger.error('Error rendering TransactionProcessor:', error as Error);
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
