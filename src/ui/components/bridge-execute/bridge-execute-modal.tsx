import React from 'react';
import { UnifiedTransactionModal } from '../shared/unified-transaction-modal';
import { BridgeAndExecuteParams, BridgeAndExecuteSimulationResult } from '../../../types';
import { useInternalNexus } from '../../providers/InternalNexusProvider';

function BridgeExecuteForm({
  inputData,
  onUpdate,
  disabled,
  tokenBalance,
  prefillFields,
}: {
  inputData: any;
  onUpdate: (data: BridgeAndExecuteParams) => void;
  disabled: boolean;
  tokenBalance?: string;
  prefillFields?: any;
}) {
  const { activeController } = useInternalNexus();

  if (!activeController) return null;

  const handleUpdate = (data: any) => {
    if (data.toChainId !== undefined) {
      const updateData = { ...data, chainId: data.toChainId };
      onUpdate(updateData);
    } else {
      onUpdate(data);
    }
  };

  return (
    <activeController.InputForm
      prefill={inputData}
      onUpdate={handleUpdate}
      isBusy={disabled}
      tokenBalance={tokenBalance}
      prefillFields={prefillFields}
    />
  );
}

export default function BridgeAndExecuteModal() {
  const getSimulationError = (simulationResult: BridgeAndExecuteSimulationResult) => {
    if (!simulationResult) return true;

    // Check if the overall simulation failed
    if (simulationResult.success === false || simulationResult.error) {
      return true;
    }
    const isBridgeSkipped = simulationResult.metadata?.bridgeSkipped;

    if (!isBridgeSkipped) {
      if (!simulationResult.bridgeSimulation || !simulationResult.bridgeSimulation.intent) {
        return true;
      }
    }
    if (simulationResult.executeSimulation && !simulationResult.executeSimulation.success) {
      return true;
    }

    return false;
  };

  const getMinimumAmount = (simulationResult: BridgeAndExecuteSimulationResult) => {
    // If bridge was skipped, use the input amount instead of bridge simulation data
    if (simulationResult?.metadata?.bridgeSkipped) {
      return simulationResult.metadata.inputAmount || '0';
    }

    const bridgeSim = simulationResult?.bridgeSimulation;
    return bridgeSim?.intent?.sourcesTotal || '0';
  };

  const getSourceChains = (simulationResult: BridgeAndExecuteSimulationResult) => {
    // If bridge was skipped, return empty array since there's no bridge routing
    if (simulationResult?.metadata?.bridgeSkipped) {
      return [];
    }

    const bridgeSim = simulationResult?.bridgeSimulation;
    return bridgeSim?.intent?.sources?.map((s) => ({ chainId: s.chainID, amount: s.amount })) || [];
  };

  const transformInputData = (inputData: any) => {
    if (!inputData) return {};
    return {
      ...inputData,
      toChainId: (inputData as BridgeAndExecuteParams).toChainId,
    };
  };

  return (
    <UnifiedTransactionModal
      transactionType="bridgeAndExecute"
      modalTitle="Bridge and Execute"
      FormComponent={BridgeExecuteForm}
      getSimulationError={getSimulationError}
      getMinimumAmount={getMinimumAmount}
      getSourceChains={getSourceChains}
      transformInputData={transformInputData}
    />
  );
}
