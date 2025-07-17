import React from 'react';
import type { ITransactionController, BridgeConfig, ActiveTransaction } from '../types';
import { NexusSDK } from '../..';
import { BridgeParams, BridgeResult } from '../../types';
import { UnifiedTransactionForm } from '../components/shared/unified-transaction-form';
import { logger } from '../../core/utils';

const BridgeInputForm: React.FC<{
  prefill: Partial<BridgeConfig>;
  onUpdate: (data: Partial<BridgeConfig>) => void;
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
      type="bridge"
      inputData={prefill}
      onUpdate={onUpdate}
      disabled={isBusy}
      tokenBalance={tokenBalance}
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
    for (const source of sourcesData) {
      if (inputData?.token === 'ETH') break;
      const requiredAmount = sdk.utils.parseUnits(
        simulationResult?.intent?.sourcesTotal,
        sdk.utils.getTokenMetadata(inputData.token)?.decimals ?? 18,
      );

      const allowances = await sdk.getAllowance(source.chainID, [inputData.token]);
      logger.info(`allowances for chain ${source.chainID}:`, allowances);

      const currentAllowance = allowances[0]?.allowance ?? 0n;

      if (currentAllowance < requiredAmount) {
        needsApproval = true;
        logger.info(
          `Allowance needed on chain ${source.chainID}: required=${requiredAmount}, current=${currentAllowance}`,
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

  async confirmAndProceed(sdk: NexusSDK, inputData: BridgeParams): Promise<BridgeResult> {
    const result = await sdk.bridge(inputData);
    return result;
  }
}
