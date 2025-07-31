import React from 'react';
import { UnifiedTransactionModal } from '../shared/unified-transaction-modal';
import { SimulationResult } from '../../../types';
import { UnifiedTransactionForm } from '../shared/unified-transaction-form';
import { BridgeConfig } from '../../types';

interface BridgeFormSectionProps {
  inputData: {
    chainId?: number;
    token?: string;
    amount?: string | number;
  };
  onUpdate: (data: Partial<BridgeConfig>) => void;
  disabled?: boolean;
  className?: string;
  prefillFields?: {
    chainId?: boolean;
    token?: boolean;
    amount?: boolean;
  };
}

function BridgeFormSection({
  inputData,
  onUpdate,
  disabled = false,
  className,
  prefillFields = {},
}: BridgeFormSectionProps) {
  return (
    <UnifiedTransactionForm
      type="bridge"
      inputData={inputData}
      onUpdate={onUpdate}
      disabled={disabled}
      className={className}
      prefillFields={prefillFields}
    />
  );
}

export default function BridgeModal() {
  const getSimulationError = (simulationResult: SimulationResult) => {
    return (
      simulationResult &&
      'bridgeSimulation' in simulationResult &&
      !simulationResult.bridgeSimulation
    );
  };

  const getMinimumAmount = (simulationResult: SimulationResult) => {
    return simulationResult?.intent?.sourcesTotal || '0';
  };

  const getSourceChains = (
    simulationResult: SimulationResult & {
      allowance?: {
        chainDetails?: Array<{ chainId: number; amount: string; needsApproval: boolean }>;
      };
    },
  ) => {
    // Use chainDetails from allowance if available (provides needsApproval info)
    if (simulationResult?.allowance?.chainDetails) {
      return simulationResult.allowance.chainDetails;
    }

    // Fallback to original sources mapping
    return (
      simulationResult?.intent?.sources?.map((source) => ({
        chainId: source.chainID,
        amount: source.amount,
      })) || []
    );
  };

  return (
    <UnifiedTransactionModal
      transactionType="bridge"
      modalTitle="Bridge Tokens"
      FormComponent={BridgeFormSection}
      getSimulationError={getSimulationError}
      getMinimumAmount={getMinimumAmount}
      getSourceChains={getSourceChains}
      containerClassName="py-6"
    />
  );
}
