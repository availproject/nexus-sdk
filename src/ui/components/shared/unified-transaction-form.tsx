import { AmountInput } from './amount-input';
import { AddressField } from './address-field';
import { cn } from '../../utils/utils';
import { useInternalNexus } from '../../providers/InternalNexusProvider';
import { type TransactionType } from '../../utils/balance-utils';
import React, { useMemo } from 'react';
import { CHAIN_METADATA } from '../../../constants';
import { FormField } from '../motion/form-field';
import DestinationDrawer from './destination-drawer';
import { isAddress } from 'viem';

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
  const { config, isSimulating } = useInternalNexus();

  const formConfig = FORM_CONFIG[type];
  const isInputDisabled = disabled || isSimulating;
  const isChainSelectDisabled =
    isInputDisabled || prefillFields[formConfig.chainField as keyof typeof prefillFields];
  const isTokenSelectDisabled = isInputDisabled || prefillFields.token;
  const isAmountDisabled = isInputDisabled || prefillFields.amount;
  const isReceipientDisabled = isInputDisabled || prefillFields.recipient;

  const title = useMemo(() => {
    const chainId = inputData?.chainId || inputData?.toChainId;
    if (chainId && inputData?.token)
      return `Sending (${inputData?.token} to ${CHAIN_METADATA[chainId]?.name})`;
    return 'Sending';
  }, [inputData]);

  const hasValidationError = useMemo(
    () => inputData?.recipient && !isAddress(inputData?.recipient ?? ''),
    [inputData?.recipient],
  );

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
              onChange={isAmountDisabled ? undefined : (value) => onUpdate({ amount: value })}
              token={inputData?.token}
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
              onUpdate({ [fieldName]: parseInt(chainId, 10) });
            }}
            onTokenValueChange={(token) => !isTokenSelectDisabled && onUpdate({ token })}
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
              onChange={(value) => !isReceipientDisabled && onUpdate({ recipient: value })}
              disabled={isReceipientDisabled}
            />
          </FormField>
        )}
      </div>
    </div>
  );
}
