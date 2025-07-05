import React from 'react';
import type { ITransactionController, BridgeConfig, ActiveTransaction } from '../types';
import { NexusSDK } from '../..';
import { BridgeParams, BridgeResult } from '../../types';
import { Label } from '../components/shared/label';
import { Input } from '../components/shared/input';
import { ChainSelect } from '../components/shared/chain-select';
import { TokenSelect } from '../components/shared/token-select';
import { useInternalNexus } from '../providers/InternalNexusProvider';
import { logger } from '../../utils';

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
  const { config } = useInternalNexus();

  const handleUpdate = (field: keyof BridgeConfig, value: string | number) => {
    onUpdate({ [field]: value });
  };

  return (
    <div className="flex flex-col gap-y-4 w-full items-start">
      <div className="flex items-start justify-between w-full">
        <div className="flex flex-col gap-y-1.5 items-start">
          <Label htmlFor="toChain">Destination Network</Label>
          <ChainSelect
            value={prefill.chainId?.toString() || ''}
            onValueChange={(chainId: string) =>
              !(isBusy || prefillFields.chainId) && handleUpdate('chainId', parseInt(chainId, 10))
            }
            disabled={isBusy || prefillFields.chainId}
            network={config}
          />
        </div>

        <div className="flex flex-col gap-y-1.5 items-start">
          <Label htmlFor="token">Token to be transferred</Label>
          <TokenSelect
            value={prefill.token || ''}
            onValueChange={(token: string) =>
              !(isBusy || prefillFields.token) && handleUpdate('token', token)
            }
            disabled={isBusy || prefillFields.token}
            network={config}
          />
        </div>
      </div>

      <div className="flex flex-col gap-y-1.5 items-start">
        <Label htmlFor="amount">Amount</Label>
        <Input
          id="amount"
          placeholder="0.01"
          value={prefill.amount || ''}
          onChange={(e) =>
            !(isBusy || prefillFields.amount) && handleUpdate('amount', e.target.value)
          }
          disabled={isBusy || prefillFields.amount}
        />
        <Label htmlFor="balance">
          Balance: - {tokenBalance ?? '0'} {prefill.token || ''}
        </Label>
      </div>
    </div>
  );
};

export class BridgeController implements ITransactionController {
  InputForm = BridgeInputForm;

  hasSufficientInput(inputData: Partial<BridgeParams>): boolean {
    if (!inputData.amount || !inputData.chainId || !inputData.token) {
      return false;
    }

    // Validate amount is a valid positive number
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
    // Check allowance on all source chains
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
