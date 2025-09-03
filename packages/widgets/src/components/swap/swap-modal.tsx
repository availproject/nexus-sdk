import { UnifiedTransactionModal } from '../shared/unified-transaction-modal';
import { SwapTransactionForm } from '../shared/unified-transaction-form';
import PrefilledInputs from '../shared/prefilled-inputs';
import { useInternalNexus } from '../../providers/InternalNexusProvider';
import { SwapSimulationResult, SwapInputData } from '../../types';

interface SwapFormSectionProps {
  inputData: SwapInputData;
  onUpdate: (data: SwapInputData) => void;
  disabled?: boolean;
  className?: string;
  prefillFields?: {
    fromChainID?: boolean;
    toChainID?: boolean;
    fromTokenAddress?: boolean;
    toTokenAddress?: boolean;
    fromAmount?: boolean;
    toAmount?: boolean;
  };
}

function SwapFormSection({
  inputData,
  onUpdate,
  disabled = false,
  className,
  prefillFields = {},
}: SwapFormSectionProps) {
  const { activeController } = useInternalNexus();

  if (!activeController) return null;

  const requiredPrefillFields = ['fromChainID', 'toChainID', 'fromTokenAddress', 'toTokenAddress', 'fromAmount'];
  const hasEnoughInputs = requiredPrefillFields.every(
    (field) => (prefillFields as any)[field] !== undefined,
  );

  if (hasEnoughInputs) {
    return <PrefilledInputs inputData={inputData} />;
  }

  return (
    <SwapTransactionForm
      inputData={inputData}
      onUpdate={onUpdate}
      disabled={disabled}
      className={className}
      prefillFields={prefillFields}
    />
  );
}

export default function SwapModal({ title = 'Nexus Widget' }: { title?: string }) {
  const getSimulationError = (simulationResult: SwapSimulationResult): boolean => {
    // For swap, simulation error means intent capture failed
    if (!simulationResult) return true;
    return (
      simulationResult.success === false ||
      Boolean(simulationResult.error) ||
      !simulationResult.intent
    );
  };
  const transformInputData = (inputData: SwapInputData | null | undefined) => {
    if (!inputData) return {};
    // SwapInputData is already in the correct format, no transformation needed
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
