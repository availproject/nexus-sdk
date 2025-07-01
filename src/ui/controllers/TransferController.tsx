import React from 'react';
import type { ITransactionController, ActiveTransaction } from '../types';
import { NexusSDK } from '../..';
import { TransferParams, TransferResult } from '../../types';
import { FormField } from '../components/shared/form-field';
import { Input } from '../components/shared/input';
import { ChainSelect } from '../components/shared/chain-select';
import { TokenSelect } from '../components/shared/token-select';
import { AmountInput } from '../components/shared/amount-input';
import { useNexus } from '../providers/NexusProvider';
import { cn } from '../utils/utils';

// Transfer-specific config interface
export interface TransferConfig extends Partial<TransferParams> {}

const TransferInputForm: React.FC<{
  prefill: Partial<TransferConfig>;
  onUpdate: (data: Partial<TransferConfig>) => void;
  isBusy: boolean;
  tokenBalance?: string;
}> = ({ prefill, onUpdate, isBusy, tokenBalance }) => {
  const { config, isSdkInitialized, isSimulating } = useNexus();
  const isInputDisabled = isBusy || isSimulating;

  const handleUpdate = (field: keyof TransferConfig, value: string | number) => {
    onUpdate({ [field]: value });
  };

  // Address validation
  const validateAddress = (address: string): boolean => {
    // Check if it's a valid Ethereum address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return false;
    }
    return true;
  };

  // Check if address is the user's own address (prevent self-transfers)
  const isSelfTransfer = (address: string): boolean => {
    // For now, we'll skip self-transfer validation since we need async call
    // This can be enhanced later when we have access to current account
    return false;
  };

  return (
    <div className={cn('px-6 flex flex-col gap-y-4 w-full')}>
      <div className="flex gap-x-4 w-full">
        <FormField label="Source Network" className="flex-1">
          <ChainSelect
            value={prefill.chainId?.toString() || ''}
            onValueChange={(chainId) =>
              !isInputDisabled && handleUpdate('chainId', parseInt(chainId, 10))
            }
            disabled={isInputDisabled}
            network={config.network}
          />
        </FormField>

        <FormField label="Token to transfer" className="flex-1">
          <TokenSelect
            value={prefill.token || ''}
            onValueChange={(token) => !isInputDisabled && handleUpdate('token', token)}
            disabled={isInputDisabled}
            network={config.network}
          />
        </FormField>
      </div>

      <div className="flex gap-x-4 w-full">
        <FormField
          label="Amount"
          helperText={
            isSdkInitialized ? `Balance:- ${tokenBalance ?? ''} ${prefill?.token ?? ''}` : undefined
          }
          className="flex-1"
        >
          <AmountInput
            value={prefill?.amount ? prefill.amount?.toString() : ''}
            suffix={prefill.token || ''}
            disabled={isInputDisabled}
            onChange={isInputDisabled ? undefined : (value) => handleUpdate('amount', value)}
          />
        </FormField>

        <FormField
          label="Recipient Address"
          className="flex-1"
          helperText={
            prefill.recipient && !validateAddress(prefill.recipient)
              ? 'Invalid address format'
              : prefill.recipient && isSelfTransfer(prefill.recipient)
                ? 'Cannot transfer to your own address'
                : undefined
          }
        >
          <Input
            placeholder="0x..."
            value={prefill.recipient || ''}
            onChange={(e) => !isInputDisabled && handleUpdate('recipient', e.target.value)}
            disabled={isInputDisabled}
            className={
              prefill.recipient &&
              (!validateAddress(prefill.recipient) || isSelfTransfer(prefill.recipient))
                ? 'border-red-500 focus:border-red-500'
                : ''
            }
          />
        </FormField>
      </div>
    </div>
  );
};

export class TransferController implements ITransactionController {
  InputForm = TransferInputForm;

  hasSufficientInput(inputData: Partial<TransferParams>): boolean {
    if (!inputData.amount || !inputData.chainId || !inputData.token || !inputData.recipient) {
      return false;
    }

    // Validate amount is a valid positive number
    const amount = parseFloat(inputData.amount.toString());
    if (isNaN(amount) || amount <= 0) {
      return false;
    }

    // Validate recipient address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(inputData.recipient)) {
      return false;
    }

    return true;
  }

  async runReview(
    sdk: NexusSDK,
    inputData: TransferParams,
  ): Promise<ActiveTransaction['simulationResult']> {
    const simulationResult = await sdk.simulateTransfer(inputData);
    console.log('transfer simulationResult', simulationResult);

    const tokenMeta = sdk.utils.getTokenMetadata(inputData.token);
    const requiredAmount = sdk.utils.parseUnits(
      inputData.amount.toString(),
      tokenMeta?.decimals ?? 18,
    );

    const allowances = await sdk.getAllowance(inputData.chainId, [inputData.token]);
    const currentAllowance = allowances[0]?.allowance ?? 0n;
    const needsApproval = currentAllowance < requiredAmount;

    return {
      ...simulationResult,
      allowance: {
        needsApproval,
      },
    };
  }

  async confirmAndProceed(
    sdk: NexusSDK,
    inputData: TransferParams,
    simulationResult: ActiveTransaction['simulationResult'],
  ): Promise<TransferResult> {
    if (simulationResult?.allowance?.needsApproval) {
      const tokenMeta = await sdk.utils.getTokenMetadata(inputData.token);
      const amountToApprove = sdk.utils.parseUnits(
        inputData.amount.toString(),
        tokenMeta?.decimals ?? 18,
      );
      await sdk.setAllowance(inputData.chainId, [inputData.token], amountToApprove);
    }
    const result = await sdk.transfer(inputData);
    return result;
  }
}
