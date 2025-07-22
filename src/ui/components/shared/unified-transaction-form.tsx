import * as React from 'react';
import { FormField } from './form-field';
import { ChainSelect } from './chain-select';
import { TokenSelect } from './token-select';
import { AmountInput } from './amount-input';
import { AddressField } from './address-field';
import { cn } from '../../utils/utils';
import { useInternalNexus } from '../../providers/InternalNexusProvider';

type TransactionType = 'bridge' | 'transfer' | 'bridgeAndExecute';

interface UnifiedTransactionFormProps {
  type: TransactionType;
  inputData: {
    chainId?: number;
    toChainId?: number;
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
    toChainId?: boolean;
    token?: boolean;
    amount?: boolean;
    recipient?: boolean;
  };
}

export function UnifiedTransactionForm({
  type,
  inputData,
  onUpdate,
  disabled = false,
  tokenBalance,
  className,
  prefillFields = {},
}: UnifiedTransactionFormProps) {
  const { config, isSdkInitialized, isSimulating } = useInternalNexus();
  const isInputDisabled = disabled || isSimulating;

  const getFormConfig = () => {
    switch (type) {
      case 'bridge':
        return {
          chainLabel: 'Destination Network',
          tokenLabel: 'Token to be transferred',
          chainField: 'chainId',
          showRecipient: false,
          showSecondAmountField: true, // For the invisible spacer
        };
      case 'transfer':
        return {
          chainLabel: 'Source Network',
          tokenLabel: 'Token to transfer',
          chainField: 'chainId',
          showRecipient: true,
          showSecondAmountField: false,
        };
      case 'bridgeAndExecute':
        return {
          chainLabel: 'Destination Network',
          tokenLabel: 'Token to be deposited',
          chainField: 'toChainId',
          showRecipient: false,
          showSecondAmountField: false,
        };
      default:
        return {
          chainLabel: 'Network',
          tokenLabel: 'Token',
          chainField: 'chainId',
          showRecipient: false,
          showSecondAmountField: false,
        };
    }
  };

  const formConfig = getFormConfig();

  return (
    <div className={cn('px-6 flex flex-col gap-y-4 w-full relative', className)}>
      <div className="flex gap-x-4 justify-between items-center w-full">
        <FormField
          label={formConfig.chainLabel}
          className={cn(
            'flex-1 font-nexus-primary',
            type === 'bridge' ? 'w-full max-w-[208px]' : '',
          )}
        >
          <ChainSelect
            value={
              formConfig.chainField === 'toChainId'
                ? inputData.toChainId?.toString() || ''
                : inputData.chainId?.toString() || ''
            }
            onValueChange={(chainId) => {
              if (
                isInputDisabled ||
                prefillFields[formConfig.chainField as keyof typeof prefillFields]
              )
                return;
              const fieldName = formConfig.chainField;
              onUpdate({ [fieldName]: parseInt(chainId, 10) });
            }}
            disabled={
              isInputDisabled || prefillFields[formConfig.chainField as keyof typeof prefillFields]
            }
            network={config?.network ?? 'mainnet'}
            className="w-full"
          />
        </FormField>

        <FormField
          label={formConfig.tokenLabel}
          className={cn('flex-1 font-nexus-primary', type === 'bridge' ? 'min-w-max' : '')}
        >
          <TokenSelect
            value={inputData.token}
            onValueChange={(token) =>
              !(isInputDisabled || prefillFields.token) && onUpdate({ token })
            }
            disabled={isInputDisabled || prefillFields.token}
            network={config?.network ?? 'mainnet'}
            className="w-full"
          />
        </FormField>
      </div>

      <div
        className={cn('flex gap-x-4 w-full', type !== 'bridgeAndExecute' && 'font-nexus-primary')}
      >
        <FormField
          label="Amount"
          helperText={
            isSdkInitialized
              ? `Balance: ${parseFloat(tokenBalance ?? '0').toFixed(6)} ${inputData?.token ?? ''}`
              : undefined
          }
          className="flex-1 font-nexus-primary"
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

        {formConfig.showRecipient && (
          <AddressField
            label="Recipient Address"
            value={inputData?.recipient ?? ''}
            onChange={(value) =>
              !(isInputDisabled || prefillFields.recipient) && onUpdate({ recipient: value })
            }
            disabled={isInputDisabled || prefillFields.recipient}
          />
        )}

        {formConfig.showSecondAmountField && (
          <div className="flex-1 opacity-0 invisible aria-hidden select-none aria-hidden='true">
            <FormField label="Amount">
              <AmountInput value="0.1" suffix="ETH" disabled />
            </FormField>
          </div>
        )}
      </div>
    </div>
  );
}
