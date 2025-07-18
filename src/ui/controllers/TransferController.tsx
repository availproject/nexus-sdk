import React from 'react';
import type { ITransactionController, ActiveTransaction } from '../types';
import { NexusSDK } from '../../core/sdk';
import { TransferParams, TransferResult } from '../../types';
import { UnifiedTransactionForm } from '../components/shared/unified-transaction-form';
import { logger } from '../../core/utils';

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
  return (
    <UnifiedTransactionForm
      type="transfer"
      inputData={prefill}
      onUpdate={onUpdate}
      disabled={isBusy}
      tokenBalance={tokenBalance}
      prefillFields={prefillFields}
    />
  );
};

export class TransferController implements ITransactionController {
  InputForm = TransferInputForm;

  hasSufficientInput(inputData: Partial<TransferParams>): boolean {
    if (!inputData.amount || !inputData.chainId || !inputData.token || !inputData.recipient) {
      return false;
    }

    const amount = parseFloat(inputData.amount.toString());
    if (isNaN(amount) || amount <= 0) {
      return false;
    }

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
