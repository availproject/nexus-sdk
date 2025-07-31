import * as React from 'react';
import { FormField } from './form-field';
import { ChainSelect } from './chain-select';
import { TokenSelect } from './token-select';
import { AmountInput } from './amount-input';
import { AddressField } from './address-field';
import { cn } from '../../utils/utils';
import { useInternalNexus } from '../../providers/InternalNexusProvider';
import { calculateEffectiveBalance, type TransactionType } from '../../utils/balance-utils';
import { SUPPORTED_CHAINS_IDS, SUPPORTED_TOKENS } from '../../../types';

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
  className?: string;
  prefillFields?: {
    chainId?: boolean;
    toChainId?: boolean;
    token?: boolean;
    amount?: boolean;
    recipient?: boolean;
  };
}

const FORM_CONFIG = {
  bridge: {
    chainLabel: 'Destination Network',
    tokenLabel: 'Token to be transferred',
    chainField: 'chainId',
    showRecipient: false,
    showSecondAmountField: true,
  },
  bridgeAndExecute: {
    chainLabel: 'Destination Network',
    tokenLabel: 'Token to be deposited',
    chainField: 'toChainId',
    showRecipient: false,
    showSecondAmountField: false,
  },
  transfer: {
    chainLabel: 'Source Network',
    tokenLabel: 'Token to transfer',
    chainField: 'chainId',
    showRecipient: true,
    showSecondAmountField: false,
  },
};

export function UnifiedTransactionForm({
  type,
  inputData,
  onUpdate,
  disabled = false,
  className,
  prefillFields = {},
}: UnifiedTransactionFormProps) {
  const { config, isSdkInitialized, isSimulating, unifiedBalance } = useInternalNexus();
  const isInputDisabled = disabled || isSimulating;

  const getEffectiveBalanceText = () => {
    if (!isSdkInitialized) return undefined;
    const destinationChainId =
      type === 'bridgeAndExecute'
        ? (inputData?.toChainId as SUPPORTED_CHAINS_IDS)
        : (inputData?.chainId as SUPPORTED_CHAINS_IDS);

    const { contextualMessage } = calculateEffectiveBalance({
      unifiedBalance,
      token: inputData?.token as SUPPORTED_TOKENS,
      destinationChainId,
      type,
    });

    return contextualMessage;
  };

  const formConfig = FORM_CONFIG[type];

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
          helperText={getEffectiveBalanceText()}
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
