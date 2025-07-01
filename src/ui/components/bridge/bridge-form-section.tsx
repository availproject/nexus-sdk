import * as React from 'react';
import { FormField } from '../shared/form-field';
import { ChainSelect } from '../shared/chain-select';
import { TokenSelect } from '../shared/token-select';
import { AmountInput } from '../shared/amount-input';
import { cn } from '../../utils/utils';
import { useNexus } from '../../providers/NexusProvider';

interface BridgeFormSectionProps {
  inputData: {
    chainId?: number;
    token?: string;
    amount?: string | number;
  };
  onUpdate: (data: any) => void;
  disabled?: boolean;
  tokenBalance?: string;
  className?: string;
}

export function BridgeFormSection({
  inputData,
  onUpdate,
  disabled = false,
  tokenBalance,
  className,
}: BridgeFormSectionProps) {
  const { config, isSdkInitialized, isSimulating } = useNexus();
  const isInputDisabled = disabled || isSimulating;
  return (
    <div className={cn('px-6 flex flex-col gap-y-4 w-full', className)}>
      <div className="flex gap-x-4 w-full">
        <FormField label="Destination Network" className="flex-1">
          <ChainSelect
            value={inputData.chainId?.toString() || ''}
            onValueChange={(chainId) =>
              !isInputDisabled && onUpdate({ chainId: parseInt(chainId, 10) })
            }
            disabled={isInputDisabled}
            network={config.network}
          />
        </FormField>

        <FormField label="Token to be transferred" className="flex-1">
          <TokenSelect
            value={inputData.token}
            onValueChange={(token) => !isInputDisabled && onUpdate({ token })}
            disabled={isInputDisabled}
            network={config.network}
          />
        </FormField>
      </div>

      <div className="flex gap-x-4 w-full">
        <FormField
          label="Amount"
          helperText={
            isSdkInitialized
              ? `Balance:- ${tokenBalance ?? ''} ${inputData?.token ?? ''}`
              : undefined
          }
          className="flex-1"
        >
          <AmountInput
            value={inputData?.amount ? inputData.amount?.toString() : ''}
            suffix={inputData.token || ''}
            disabled={isInputDisabled}
            onChange={isInputDisabled ? undefined : (value) => onUpdate({ amount: value })}
          />
        </FormField>

        <div className="flex-1 opacity-0 select-none">
          <FormField label="Amount">
            <AmountInput value="0.1" suffix="ETH" disabled />
          </FormField>
        </div>
      </div>
    </div>
  );
}
