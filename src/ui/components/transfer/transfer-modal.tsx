import React from 'react';
import { UnifiedTransactionModal } from '../shared/unified-transaction-modal';
import { SimulationResult } from '../../../types';
import { UnifiedTransactionForm } from '../shared/unified-transaction-form';
import { TransferConfig } from '../../types';
import { useInternalNexus } from '../../providers/InternalNexusProvider';

interface TransferFormSectionProps {
  inputData: {
    chainId?: number;
    token?: string;
    amount?: string | number;
    recipient?: string;
  };
  onUpdate: (data: Partial<TransferConfig>) => void;
  disabled?: boolean;
  className?: string;
  prefillFields?: {
    chainId?: boolean;
    token?: boolean;
    amount?: boolean;
    recipient?: boolean;
  };
}

export function TransferFormSection({
  inputData,
  onUpdate,
  disabled = false,
  className,
  prefillFields = {},
}: TransferFormSectionProps) {
  const { activeController } = useInternalNexus();

  if (!activeController) return null;
  return (
    <UnifiedTransactionForm
      type="transfer"
      inputData={inputData}
      onUpdate={onUpdate}
      disabled={disabled}
      className={className}
      prefillFields={prefillFields}
    />
  );
}

export default function TransferModal() {
  const getSimulationError = (simulationResult: SimulationResult) => {
    return simulationResult && !simulationResult.intent;
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
      transactionType="transfer"
      modalTitle="Transfer Tokens"
      FormComponent={TransferFormSection}
      getSimulationError={getSimulationError}
      getMinimumAmount={getMinimumAmount}
      getSourceChains={getSourceChains}
    />
  );
}
