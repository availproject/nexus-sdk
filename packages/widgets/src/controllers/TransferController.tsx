import React from 'react';
import type { ITransactionController, ActiveTransaction } from '../types';
import { NexusSDK } from '@avail-project/nexus-core';
import { NexusNetwork, type TransferParams, type TransferResult, logger } from '@nexus/commons';
import {
  UnifiedTransactionForm,
  UnifiedInputData,
} from '../components/shared/unified-transaction-form';

export interface TransferConfig extends Partial<TransferParams> {}

const TransferInputForm: React.FC<{
  prefill: Partial<TransferConfig>;
  onUpdate: (data: Partial<TransferConfig>) => void;
  isBusy: boolean;
  prefillFields?: {
    chainId?: boolean;
    toChainId?: boolean;
    token?: boolean;
    amount?: boolean;
    recipient?: boolean;
  };
}> = ({ prefill, onUpdate, isBusy, prefillFields = {} }) => {
  // Transform TransferConfig to UnifiedInputData
  const unifiedInputData: UnifiedInputData = {
    chainId: prefill?.chainId,
    toChainId: prefill?.chainId, // Transfer uses same chain
    token: prefill?.token,
    amount: prefill?.amount,
    recipient: prefill?.recipient,
  };

  // Transform UnifiedInputData back to TransferConfig
  const handleUpdate = (data: UnifiedInputData) => {
    onUpdate({
      chainId: data.chainId as any,
      token: data.token as any,
      amount: data.amount,
      recipient: data.recipient as any, // Cast to proper hex string type
    });
  };

  return (
    <UnifiedTransactionForm
      type="transfer"
      inputData={unifiedInputData}
      onUpdate={handleUpdate}
      disabled={isBusy}
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
    const chainDetails: Array<{
      chainId: number;
      amount: string;
      needsApproval: boolean;
    }> = [];

    for (const source of sourcesData) {
      if (inputData?.token === 'ETH') {
        chainDetails.push({
          chainId: source.chainID,
          amount: source.amount,
          needsApproval: false,
        });
        continue;
      }

      const requiredAmount = sdk.utils.parseUnits(
        source.amount,
        sdk.utils.getTokenMetadata(inputData.token)?.decimals ?? 18,
      );
      const allowances = await sdk.getAllowance(source.chainID, [inputData.token]);
      logger.info(`transfer allowances for chain ${source.chainID}:`, allowances);

      const currentAllowance = allowances[0]?.allowance ?? 0n;
      const chainNeedsApproval = currentAllowance < requiredAmount;

      if (chainNeedsApproval) {
        needsApproval = true;
        logger.info(
          `Transfer allowance needed on chain ${source.chainID}: required=${requiredAmount.toString()}, current=${currentAllowance.toString()}`,
        );
      }

      chainDetails.push({
        chainId: source.chainID,
        amount: requiredAmount.toString(),
        needsApproval: chainNeedsApproval,
      });
    }

    return {
      ...simulationResult,
      allowance: {
        needsApproval,
        chainDetails,
      },
    };
  }

  async confirmAndProceed(
    sdk: NexusSDK,
    config: { network?: NexusNetwork; debug?: boolean },
    inputData: TransferParams,
  ): Promise<TransferResult> {
    const result = await sdk.transfer(inputData);
    // const intentData = {
    //   intentType: 'transfer',
    //   ...inputData,
    // };
    // trackIntentCreated(
    //   { network: config?.network ?? 'mainnet', debug: config?.debug ?? false },
    //   intentData as any,
    // );
    return result;
  }
}
