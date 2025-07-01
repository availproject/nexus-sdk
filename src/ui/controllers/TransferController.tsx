import React from 'react';
import type { ITransactionController, ActiveTransaction } from '../types';
import { NexusSDK } from '../..';
import { TransferParams, TransferResult } from '../../types';
import { FormField } from '../components/shared/form-field';
import { Input } from '../components/shared/input';
import { ChainSelect } from '../components/shared/chain-select';
import { TokenSelect } from '../components/shared/token-select';
import { AmountInput } from '../components/shared/amount-input';
import { useInternalNexus } from '../providers/InternalNexusProvider';
import { cn } from '../utils/utils';
import { logger } from '../../utils';

// Transfer-specific config interface
export interface TransferConfig extends Partial<TransferParams> {}

const TransferInputForm: React.FC<{
  prefill: Partial<TransferConfig>;
  onUpdate: (data: Partial<TransferConfig>) => void;
  isBusy: boolean;
  tokenBalance?: string;
  prefillFields?: {
    chainId?: boolean;
    toChainId?: boolean;
    token?: boolean;
    amount?: boolean;
    recipient?: boolean;
  };
}> = ({ prefill, onUpdate, isBusy, tokenBalance, prefillFields = {} }) => {
  const { config, isSdkInitialized, isSimulating } = useInternalNexus();
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

  return (
    <div className={cn('px-6 flex flex-col gap-y-4 w-full')}>
      <div className="flex gap-x-4 w-full">
        <FormField label="Source Network" className="flex-1">
          <ChainSelect
            value={prefill.chainId?.toString() || ''}
            onValueChange={(chainId) =>
              !(isInputDisabled || prefillFields.chainId) &&
              handleUpdate('chainId', parseInt(chainId, 10))
            }
            disabled={isInputDisabled || prefillFields.chainId}
            network={config.network}
          />
        </FormField>

        <FormField label="Token to transfer" className="flex-1">
          <TokenSelect
            value={prefill.token || ''}
            onValueChange={(token) =>
              !(isInputDisabled || prefillFields.token) && handleUpdate('token', token)
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
            isSdkInitialized ? `Balance:- ${tokenBalance ?? ''} ${prefill?.token ?? ''}` : undefined
          }
          className="flex-1"
        >
          <AmountInput
            value={prefill?.amount ? prefill.amount?.toString() : ''}
            suffix={prefill.token || ''}
            disabled={isInputDisabled || prefillFields.amount}
            onChange={
              isInputDisabled || prefillFields.amount
                ? undefined
                : (value) => handleUpdate('amount', value)
            }
          />
        </FormField>

        <FormField
          label="Recipient Address"
          className="flex-1"
          helperText={
            prefill.recipient && !validateAddress(prefill.recipient)
              ? 'Invalid address format'
              : prefill.recipient
                ? 'Cannot transfer to your own address'
                : undefined
          }
        >
          <Input
            placeholder="0x..."
            value={prefill.recipient || ''}
            onChange={(e) =>
              !(isInputDisabled || prefillFields.recipient) &&
              handleUpdate('recipient', e.target.value)
            }
            disabled={isInputDisabled || prefillFields.recipient}
            className={
              prefill.recipient && !validateAddress(prefill.recipient)
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
    logger.info('transfer simulationResult', simulationResult);
    const sourcesData = simulationResult?.intent?.sources || [];
    let needsApproval = false;

    // Check allowance on all source chains
    for (const source of sourcesData) {
      if (inputData?.token === 'ETH') break;
      const requiredAmount = sdk.utils.parseUnits(
        simulationResult?.intent?.sourcesTotal,
        sdk.utils.getTokenMetadata(inputData.token)?.decimals ?? 18,
      );
      const allowances = await sdk.getAllowance(source.chainID, [inputData.token]);
      logger.info(`transfer allowances for chain ${source.chainID}:`, allowances);

      const currentAllowance = allowances[0]?.allowance ?? 0n;

      if (currentAllowance < requiredAmount) {
        needsApproval = true;
        logger.info(
          `Transfer allowance needed on chain ${source.chainID}: required=${requiredAmount}, current=${currentAllowance}`,
        );
        break;
      }
    }

    return {
      ...simulationResult,
      allowance: {
        needsApproval,
      },
    };
  }

  async confirmAndProceed(sdk: NexusSDK, inputData: TransferParams): Promise<TransferResult> {
    const result = await sdk.transfer(inputData);
    return result;
  }
}
