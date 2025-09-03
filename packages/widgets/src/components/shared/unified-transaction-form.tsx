import { AmountInput } from './amount-input';
import { AddressField } from './address-field';
import { cn } from '../../utils/utils';
import { useInternalNexus } from '../../providers/InternalNexusProvider';
import { type TransactionType } from '../../utils/balance-utils';
import { useMemo } from 'react';
import { CHAIN_METADATA, NexusNetwork } from '@nexus/commons';
import { FormField } from '../motion/form-field';
import DestinationDrawer from './destination-drawer';
import { isAddress } from 'viem';
import { SwapSimulationResult, SwapInputData } from 'src/types';

export interface UnifiedInputData {
  chainId?: number;
  toChainId?: number;
  token?: string;
  inputToken?: string;
  outputToken?: string;
  amount?: string | number;
  recipient?: string;
}

interface UnifiedTransactionFormProps {
  type: TransactionType;
  inputData: UnifiedInputData;
  onUpdate: (data: UnifiedInputData) => void;
  disabled?: boolean;
  className?: string;
  prefillFields?: {
    chainId?: boolean;
    toChainId?: boolean;
    token?: boolean;
    inputToken?: boolean;
    outputToken?: boolean;
    amount?: boolean;
    recipient?: boolean;
  };
}

interface SwapTransactionFormProps {
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

interface SwapFormProps {
  title: string;
  inputData: SwapInputData;
  isAmountDisabled?: boolean;
  handleUpdate: (data: Partial<SwapInputData>) => void;
  isChainSelectDisabled?: boolean;
  isTokenSelectDisabled?: boolean;
  isOutputTokenSelectDisabled?: boolean;
  network?: NexusNetwork;
  destinationAmount?: string;
}

const FORM_CONFIG = {
  bridge: {
    chainLabel: 'Destination Network',
    tokenLabel: 'Token to be transferred',
    chainField: 'chainId',
    showRecipient: false,
    showOutputToken: false,
    showDestinationAmount: false,
  },
  bridgeAndExecute: {
    chainLabel: 'Destination Network',
    tokenLabel: 'Token to be deposited',
    chainField: 'toChainId',
    showRecipient: false,
    showOutputToken: false,
    showDestinationAmount: false,
  },
  transfer: {
    chainLabel: 'Source Network',
    tokenLabel: 'Token to transfer',
    chainField: 'chainId',
    showRecipient: true,
    showOutputToken: false,
    showDestinationAmount: false,
  },
  swap: {
    chainLabel: 'Source Network',
    tokenLabel: 'Input Token',
    outputTokenLabel: 'Output Token',
    chainField: 'fromChainID',
    toChainField: 'toChainID',
    showRecipient: false,
    showDestinationAmount: true,
    showOutputToken: true,
    showDestinationChain: true,
  },
} as const;

const SwapForm = ({
  title,
  inputData,
  isAmountDisabled,
  handleUpdate,
  isChainSelectDisabled,
  isTokenSelectDisabled,
  isOutputTokenSelectDisabled,
  network = 'mainnet',
  destinationAmount,
}: SwapFormProps) => {
  return (
    <div className="flex flex-col items-center gap-y-4">
      <div className="flex gap-x-4 justify-between items-start w-full">
        <FormField label={title} className="flex-1 font-nexus-primary gap-y-2 w-full max-w-max">
          <AmountInput
            value={inputData?.amount ? inputData.amount?.toString() : '0'}
            disabled={isAmountDisabled}
            onChange={isAmountDisabled ? undefined : (value) => handleUpdate({ fromAmount: value })}
            token={inputData?.fromTokenAddress}
            debounceMs={1000}
          />
        </FormField>

        <DestinationDrawer
          chainValue={inputData.fromChainID?.toString() ?? ''}
          tokenValue={inputData.fromTokenAddress}
          onChainValueChange={(chainId) => {
            if (isChainSelectDisabled) return;
            handleUpdate({ fromChainID: parseInt(chainId, 10) });
          }}
          onTokenValueChange={(token) => {
            if (!isTokenSelectDisabled) {
              handleUpdate({ fromTokenAddress: token });
            }
          }}
          isTokenSelectDisabled={isTokenSelectDisabled}
          isChainSelectDisabled={isChainSelectDisabled}
          network={network}
          drawerTitle="Select Source Chain & Token"
        />
      </div>
      <div className="flex gap-x-4 justify-between items-start w-full">
        <FormField label={'Recevie'} className="flex-1 font-nexus-primary gap-y-2 w-full max-w-max">
          <AmountInput
            value={destinationAmount}
            disabled={true}
            token={inputData?.toTokenAddress}
          />
        </FormField>

        <DestinationDrawer
          chainValue={inputData.toChainID?.toString() ?? ''}
          tokenValue={inputData.toTokenAddress}
          onChainValueChange={(chainId) => {
            if (isChainSelectDisabled) return;
            handleUpdate({ toChainID: parseInt(chainId, 10) });
          }}
          onTokenValueChange={(token) => {
            if (!isOutputTokenSelectDisabled) {
              handleUpdate({ toTokenAddress: token });
            }
          }}
          isTokenSelectDisabled={isOutputTokenSelectDisabled}
          isChainSelectDisabled={isChainSelectDisabled} // Allow destination chain selection
          network={network}
          drawerTitle="Select Destination Chain & Token"
        />
      </div>
    </div>
  );
};

export function SwapTransactionForm({
  inputData,
  onUpdate,
  disabled = false,
  className,
  prefillFields = {},
}: SwapTransactionFormProps) {
  const { config, isSimulating, activeTransaction } = useInternalNexus();

  const isInputDisabled = disabled || isSimulating;
  const isChainSelectDisabled = isInputDisabled || prefillFields.fromChainID;
  const isTokenSelectDisabled = isInputDisabled || prefillFields.fromTokenAddress;
  const isOutputTokenSelectDisabled = isInputDisabled || prefillFields.toTokenAddress;
  const isAmountDisabled = isInputDisabled || prefillFields.fromAmount;

  const title = useMemo(() => {
    const fromToken = inputData?.fromTokenAddress;
    const toToken = inputData?.toTokenAddress;
    if (fromToken && toToken) {
      return `Swapping (${fromToken} → ${toToken})`;
    }
    return 'Swapping';
  }, [inputData?.fromTokenAddress, inputData?.toTokenAddress]);

  const handleUpdate = (data: Partial<SwapInputData>) => {
    onUpdate({ ...inputData, ...data });
  };

  return (
    <div className={cn('px-6 flex flex-col gap-y-4 w-full', className)}>
      <SwapForm
        title={title}
        isAmountDisabled={isAmountDisabled}
        isChainSelectDisabled={isChainSelectDisabled}
        isOutputTokenSelectDisabled={isOutputTokenSelectDisabled}
        isTokenSelectDisabled={isTokenSelectDisabled}
        inputData={inputData}
        destinationAmount={
          (activeTransaction?.simulationResult as SwapSimulationResult)?.intent?.destination?.amount
        }
        handleUpdate={handleUpdate}
        network={config?.network}
      />
    </div>
  );
}

export function UnifiedTransactionForm({
  type,
  inputData,
  onUpdate,
  disabled = false,
  className,
  prefillFields = {},
}: UnifiedTransactionFormProps) {
  const { config, isSimulating } = useInternalNexus();

  const formConfig = FORM_CONFIG[type];
  const isInputDisabled = disabled || isSimulating;
  const isChainSelectDisabled =
    isInputDisabled || prefillFields[formConfig.chainField as keyof typeof prefillFields];
  const isTokenSelectDisabled = isInputDisabled || prefillFields.token || prefillFields.inputToken;
  const isAmountDisabled = isInputDisabled || prefillFields.amount;
  const isReceipientDisabled = isInputDisabled || prefillFields.recipient;

  const title = useMemo(() => {
    const chainId = inputData?.chainId || inputData?.toChainId;
    const token = inputData?.token || inputData?.inputToken;

    if (chainId && token) {
      return `Sending (${token} to ${CHAIN_METADATA[chainId]?.name})`;
    }
    return 'Sending';
  }, [inputData, type]);

  const hasValidationError = useMemo(
    () => inputData?.recipient && !isAddress(inputData?.recipient ?? ''),
    [inputData?.recipient],
  );

  const handleUpdate = (data: UnifiedInputData) => {
    onUpdate(data);
  };

  return (
    <div className={cn('px-6 flex flex-col gap-y-4 w-full', className)}>
      <div
        className={cn(
          'flex flex-col gap-y-4 w-full',
          type !== 'bridgeAndExecute' && 'font-nexus-primary',
        )}
      >
        <div className="flex gap-x-4 justify-between items-start w-full">
          <FormField label={title} className="flex-1 font-nexus-primary gap-y-2 w-full max-w-max">
            <AmountInput
              value={inputData?.amount ? inputData.amount?.toString() : '0'}
              disabled={isAmountDisabled}
              onChange={isAmountDisabled ? undefined : (value) => handleUpdate({ amount: value })}
              token={inputData?.token || inputData?.inputToken}
              debounceMs={1000}
            />
          </FormField>

          <DestinationDrawer
            chainValue={
              formConfig.chainField === 'toChainId'
                ? (inputData.toChainId?.toString() ?? '')
                : (inputData.chainId?.toString() ?? '')
            }
            tokenValue={inputData.token}
            onChainValueChange={(chainId) => {
              if (isChainSelectDisabled) return;
              const fieldName = formConfig.chainField;
              handleUpdate({ [fieldName]: parseInt(chainId, 10) });
            }}
            onTokenValueChange={(token) => {
              if (!isTokenSelectDisabled) {
                handleUpdate({ token });
              }
            }}
            isTokenSelectDisabled={isTokenSelectDisabled}
            isChainSelectDisabled={isChainSelectDisabled}
            network={config?.network ?? 'mainnet'}
          />
        </div>

        {formConfig.showRecipient && (
          <FormField
            label="Receivers Address"
            className="flex-1"
            helperText={hasValidationError ? 'Invalid address format (must be 0x...)' : undefined}
          >
            <AddressField
              value={inputData?.recipient ?? ''}
              onChange={(value) => {
                if (!isReceipientDisabled) {
                  handleUpdate({ recipient: value });
                }
              }}
              disabled={isReceipientDisabled}
            />
          </FormField>
        )}
      </div>
    </div>
  );
}
