import { UnifiedTransactionModal } from '../shared/unified-transaction-modal';
import { SimulationResult } from '@nexus/commons';
import { UnifiedInputData, UnifiedTransactionForm } from '../shared/unified-transaction-form';
import { SwapInputData } from '../../types';
import PrefilledInputs from '../shared/prefilled-inputs';
import { useInternalNexus } from '../../providers/InternalNexusProvider';

interface TransferFormSectionProps {
  inputData: UnifiedInputData | SwapInputData;
  onUpdate: (data: UnifiedInputData | SwapInputData) => void;
  disabled: boolean;
  prefillFields?: any;
}

type InputData = {
  chainId?: number;
  token?: string;
  amount?: string | number;
  recipient?: string;
};

function TransferFormSection({
  inputData,
  onUpdate,
  disabled = false,
  prefillFields = {},
}: TransferFormSectionProps) {
  const { activeController } = useInternalNexus();

  if (!activeController) return null;

  // Cast to UnifiedInputData since transfer operations only use this type
  const transferInputData = inputData as UnifiedInputData;

  const requiredFields: (keyof InputData)[] = ['chainId', 'token', 'amount', 'recipient'];
  const hasEnoughInputs = requiredFields.every(
    (field) =>
      transferInputData[field] !== undefined &&
      transferInputData[field] !== null &&
      transferInputData[field] !== '',
  );

  if (hasEnoughInputs) {
    return <PrefilledInputs inputData={transferInputData} />;
  }

  return (
    <UnifiedTransactionForm
      type="transfer"
      inputData={transferInputData}
      onUpdate={onUpdate as (data: UnifiedInputData) => void}
      disabled={disabled}
      prefillFields={prefillFields}
    />
  );
}

export default function TransferModal({ title = 'Nexus Widget' }: { title?: string }) {
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
      modalTitle={title}
      FormComponent={TransferFormSection}
      getSimulationError={getSimulationError}
      getMinimumAmount={getMinimumAmount}
      getSourceChains={getSourceChains}
    />
  );
}
