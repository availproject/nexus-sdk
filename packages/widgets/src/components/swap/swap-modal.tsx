import { UnifiedTransactionModal } from '../shared/unified-transaction-modal';
import { SwapTransactionForm, UnifiedInputData } from '../shared/unified-transaction-form';
import { SwapSimulationResult, SwapInputData } from '../../types';
import SwapPrefilledInputs from '../shared/swap-prefilled-inputs';

interface SwapFormSectionProps {
  inputData: SwapInputData | UnifiedInputData;
  onUpdate: (data: SwapInputData | UnifiedInputData) => void;
  disabled: boolean;
  prefillFields?: any;
}

function SwapFormSection({
  inputData,
  onUpdate,
  disabled = false,
  prefillFields = {},
}: SwapFormSectionProps) {
  // Cast to SwapInputData since swap operations only use this type
  const swapInputData = inputData as SwapInputData;
  const requiredFields = [
    'fromChainID',
    'toChainID',
    'fromTokenAddress',
    'toTokenAddress',
    'fromAmount',
  ];
  // Check if fields are actually prefilled (boolean values in prefillFields indicate prefilled fields)
  const hasPrefilledInputs = requiredFields.every((field) => prefillFields[field] === true);

  if (hasPrefilledInputs) {
    return <SwapPrefilledInputs inputData={inputData as SwapInputData} />;
  }

  return (
    <SwapTransactionForm
      inputData={swapInputData}
      onUpdate={onUpdate as (data: SwapInputData) => void}
      disabled={disabled}
      prefillFields={prefillFields}
    />
  );
}

export default function SwapModal({ title = 'Nexus Widget' }: { title?: string }) {
  const getSimulationError = (simulationResult: SwapSimulationResult): boolean => {
    if (!simulationResult) return true;
    return (
      simulationResult.success === false ||
      Boolean(simulationResult.error) ||
      !simulationResult.intent
    );
  };
  const transformInputData = (inputData: SwapInputData | null | undefined) => {
    if (!inputData) return {};
    return inputData;
  };

  return (
    <UnifiedTransactionModal
      transactionType="swap"
      modalTitle={title}
      FormComponent={SwapFormSection}
      getSimulationError={getSimulationError}
      transformInputData={transformInputData}
    />
  );
}
