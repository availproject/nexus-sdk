import React from 'react';
import type { ITransactionController, BridgeConfig, ActiveTransaction } from '../types';
import { NexusSDK } from '../..';
import { BridgeParams, BridgeResult } from '../../types';
import { Label } from '../components/shared/label';
import { Input } from '../components/shared/input';
import { ChainSelect } from '../components/shared/chain-select';
import { TokenSelect } from '../components/shared/token-select';
import { useNexus } from '../providers/NexusProvider';

const BridgeInputForm: React.FC<{
  prefill: Partial<BridgeConfig>;
  onUpdate: (data: Partial<BridgeConfig>) => void;
  isBusy: boolean;
  tokenBalance?: string;
}> = ({ prefill, onUpdate, isBusy, tokenBalance }) => {
  const { config } = useNexus();

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
            onValueChange={(chainId: string) => handleUpdate('chainId', parseInt(chainId, 10))}
            disabled={isBusy}
            network={config.network}
          />
        </div>

        <div className="flex flex-col gap-y-1.5 items-start">
          <Label htmlFor="token">Token to be transferred</Label>
          <TokenSelect
            value={prefill.token || ''}
            onValueChange={(token: string) => handleUpdate('token', token)}
            disabled={isBusy}
            network={config.network}
          />
        </div>
      </div>

      <div className="flex flex-col gap-y-1.5 items-start">
        <Label htmlFor="amount">Amount</Label>
        <Input
          id="amount"
          placeholder="0.01"
          value={prefill.amount || ''}
          onChange={(e) => handleUpdate('amount', e.target.value)}
          disabled={isBusy}
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
    console.log('simulationResult', simulationResult);

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
    inputData: BridgeParams,
    simulationResult: ActiveTransaction['simulationResult'],
  ): Promise<BridgeResult> {
    if (simulationResult?.allowance?.needsApproval) {
      const tokenMeta = sdk.utils.getTokenMetadata(inputData.token);
      const amountToApprove = sdk.utils.parseUnits(
        inputData.amount.toString(),
        tokenMeta?.decimals ?? 18,
      );
      await sdk.setAllowance(inputData.chainId, [inputData.token], amountToApprove);
    }
    console.log('called bridge', inputData);
    const result = await sdk.bridge(inputData);
    return result;
  }
}
