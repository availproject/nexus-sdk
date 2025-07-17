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
  const getSimulationError = (_simulationResult: BridgeAndExecuteSimulationResult) => {
    return false;
  };

  const getMinimumAmount = (simulationResult: BridgeAndExecuteSimulationResult) => {
    const bridgeSim = simulationResult?.bridgeSimulation;
    return bridgeSim?.intent?.sourcesTotal || '0';
  };

  const getSourceChains = (simulationResult: BridgeAndExecuteSimulationResult) => {
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
