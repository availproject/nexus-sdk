import * as React from 'react';
import { FormField } from '../shared/form-field';
import { ChainSelect } from '../shared/chain-select';
import { TokenSelect } from '../shared/token-select';
import { AmountInput } from '../shared/amount-input';
import { Input } from '../shared/input';
import { cn } from '../../utils/utils';
import { useInternalNexus } from '../../providers/InternalNexusProvider';

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
  tokenBalance,
  className,
  prefillFields = {},
}: TransferFormSectionProps) {
  const { config, isSdkInitialized, isSimulating } = useInternalNexus();
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
              !(isInputDisabled || prefillFields.chainId) &&
              onUpdate({ chainId: parseInt(chainId, 10) })
            }
            disabled={isInputDisabled || prefillFields.chainId}
            network={config.network}
          />
        </FormField>

        <FormField label="Token to transfer" className="flex-1">
          <TokenSelect
            value={inputData.token}
            onValueChange={(token) =>
              !(isInputDisabled || prefillFields.token) && onUpdate({ token })
            }
            disabled={isInputDisabled || prefillFields.token}
            network={config.network}
          />
        </FormField>
      </div>

      <div className="flex gap-x-4 w-full">
        <FormField
          label="Amount"
          helperText={
            isSdkInitialized
              ? `Balance:- ${parseFloat(tokenBalance ?? '0').toFixed(6) ?? ''} ${inputData?.token ?? ''}`
              : undefined
          }
          className="flex-1"
        >
          <AmountInput
            value={inputData?.amount ? inputData.amount?.toString() : ''}
            suffix={inputData.token || ''}
            disabled={isInputDisabled || prefillFields.amount}
            onChange={
              isInputDisabled || prefillFields.amount
                ? undefined
                : (value) => onUpdate({ amount: value })
            }
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
              (isInputDisabled || prefillFields.recipient) && 'opacity-50 cursor-not-allowed',
              className,
            )}
          >
            <div className="flex items-center gap-x-1.5 flex-1">
              <Input
                placeholder="0x..."
                value={inputData.recipient || ''}
                onChange={(e) =>
                  !(isInputDisabled || prefillFields.recipient) &&
                  onUpdate({ recipient: e.target.value })
                }
                disabled={isInputDisabled || prefillFields.recipient}
                className={cn(
                  '!bg-transparent !focus:ring-0 !focus:border-none !focus:outline-none px-0',
                  hasValidationError ? 'border-red-500 focus:border-red-500' : '',
                )}
              />
            </div>
          </div>
        </FormField>
      </div>
    </div>
  );
}
