import React from 'react';
import type { ITransactionController, BridgeConfig, ActiveTransaction } from '../types';
import { NexusSDK } from '../../core/sdk';
import { BridgeParams, BridgeResult } from '../../types';
import { UnifiedTransactionForm } from '../components/shared/unified-transaction-form';
import { logger } from '../../core/utils';

const BridgeInputForm: React.FC<{
  prefill: Partial<BridgeConfig>;
  onUpdate: (data: Partial<BridgeConfig>) => void;
  isBusy: boolean;
  prefillFields?: {
    chainId?: boolean;
    toChainId?: boolean;
    token?: boolean;
    amount?: boolean;
    recipient?: boolean;
  };
}> = ({ prefill, onUpdate, isBusy, prefillFields = {} }) => {
  return (
    <UnifiedTransactionForm
      type="bridge"
      inputData={prefill}
      onUpdate={onUpdate}
      disabled={isBusy}
      prefillFields={prefillFields}
    />
  );
};

export class BridgeController implements ITransactionController {
  InputForm = BridgeInputForm;

  hasSufficientInput(inputData: Partial<BridgeParams>): boolean {
    if (!inputData.amount || !inputData.chainId || !inputData.token) {
      return false;
    }

    const amount = parseFloat(inputData.amount.toString());
    return !isNaN(amount) && amount > 0;
  }

  async runReview(
    sdk: NexusSDK,
    inputData: BridgeParams,
  ): Promise<ActiveTransaction['simulationResult']> {
    const simulationResult = await sdk.simulateBridge(inputData);
    logger.info('bridge simulationResult', simulationResult);

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
      logger.info(`allowances for chain ${source.chainID}:`, allowances);

      const currentAllowance = allowances[0]?.allowance ?? 0n;
      const chainNeedsApproval = currentAllowance < requiredAmount;

      if (chainNeedsApproval) {
        needsApproval = true;
        logger.info(
          `Allowance needed on chain ${source.chainID}: required=${requiredAmount}, current=${currentAllowance}`,
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

  async confirmAndProceed(sdk: NexusSDK, inputData: BridgeParams): Promise<BridgeResult> {
    const result = await sdk.bridge(inputData);
    return result;
  }
}
