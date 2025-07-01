import * as React from 'react';
import { FormField } from '../shared/form-field';
import { ChainSelect } from '../shared/chain-select';
import { TokenSelect } from '../shared/token-select';
import { AmountInput } from '../shared/amount-input';
import { Input } from '../shared/input';
import { cn } from '../../utils/utils';
import { useNexus } from '../../providers/NexusProvider';

interface TransferFormSectionProps {
  inputData: {
    chainId?: number;
    token?: string;
    amount?: string | number;
    recipient?: string;
  };
  onUpdate: (data: any) => void;
  disabled?: boolean;
  tokenBalance?: string;
  className?: string;
}

export function TransferFormSection({
  inputData,
  onUpdate,
  disabled = false,
  tokenBalance,
  className,
}: TransferFormSectionProps) {
  const { config, isSdkInitialized, isSimulating } = useNexus();
  const isInputDisabled = disabled || isSimulating;

  // Address validation
  const validateAddress = (address: string): boolean => {
    if (!address) return true; // Allow empty for now
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  };

  const hasValidationError = inputData.recipient && !validateAddress(inputData.recipient);

  return (
    <div className={cn('px-6 flex flex-col gap-y-4 w-full', className)}>
      <div className="flex gap-x-4 w-full">
        <FormField label="Source Network" className="flex-1">
          <ChainSelect
            value={inputData.chainId?.toString() || ''}
            onValueChange={(chainId) =>
              !isInputDisabled && onUpdate({ chainId: parseInt(chainId, 10) })
            }
            disabled={isInputDisabled}
            network={config.network}
          />
        </FormField>

        <FormField label="Token to transfer" className="flex-1">
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

        <FormField
          label="Recipient Address"
          className="flex-1"
          helperText={hasValidationError ? 'Invalid address format (must be 0x...)' : undefined}
        >
          <div
            className={cn(
              'px-4 py-2 rounded-lg border border-zinc-400 flex justify-between items-center',
              'bg-transparent h-12',
              'focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]',
              disabled && 'opacity-50 cursor-not-allowed',
              className,
            )}
          >
            <div className="flex items-center gap-x-1.5 flex-1">
              <Input
                placeholder="0x..."
                value={inputData.recipient || ''}
                onChange={(e) => !isInputDisabled && onUpdate({ recipient: e.target.value })}
                disabled={isInputDisabled}
                className={hasValidationError ? 'border-red-500 focus:border-red-500' : ''}
              />
            </div>
          </div>
        </FormField>
      </div>
    </div>
  );
}
