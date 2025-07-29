import React from 'react';
import type { ITransactionController, ActiveTransaction } from '../types';
import { NexusSDK } from '../../core/sdk';
import {
  BridgeAndExecuteParams,
  BridgeAndExecuteResult,
  BridgeAndExecuteSimulationResult,
} from '../../types';
import { UnifiedTransactionForm } from '../components/shared/unified-transaction-form';
import { logger } from '../../core/utils';
import type {
  DynamicParamBuilder,
  ExecuteParams,
  SUPPORTED_TOKENS,
  SUPPORTED_CHAINS_IDS,
} from '../../types';
import { Abi } from 'viem';

export interface BridgeAndExecuteConfig extends Partial<BridgeAndExecuteParams> {}

const BridgeAndExecuteInputForm: React.FC<{
  prefill: Partial<BridgeAndExecuteConfig>;
  onUpdate: (data: Partial<BridgeAndExecuteConfig>) => void;
  isBusy: boolean;
  prefillFields?: {
    toChainId?: boolean;
    token?: boolean;
    amount?: boolean;
  };
}> = ({ prefill, onUpdate, isBusy, prefillFields = {} }) => {
  return (
    <UnifiedTransactionForm
      type="bridgeAndExecute"
      inputData={prefill}
      onUpdate={onUpdate}
      disabled={isBusy}
      prefillFields={prefillFields}
    />
  );
};

export class BridgeAndExecuteController implements ITransactionController {
  InputForm = BridgeAndExecuteInputForm;

  hasSufficientInput(inputData: Partial<BridgeAndExecuteParams>): boolean {
    const {
      token,
      amount,
      toChainId,
      contractAddress,
      contractAbi,
      functionName,
      buildFunctionParams,
    } = inputData as any;

    if (!token || !amount || !toChainId) return false;
    if (!contractAddress || !contractAbi || !functionName || !buildFunctionParams) return false;

    const amt = parseFloat(amount.toString());
    return !isNaN(amt) && amt > 0;
  }

  private buildExecute(inputData: {
    token: SUPPORTED_TOKENS;
    amount: string | number;
    toChainId: SUPPORTED_CHAINS_IDS;
    contractAddress: `0x${string}`;
    contractAbi: Abi;
    functionName: string;
    buildFunctionParams: DynamicParamBuilder;
  }): Omit<ExecuteParams, 'toChainId'> {
    // Return new callback-based execute params directly
    return {
      contractAddress: inputData.contractAddress,
      contractAbi: inputData.contractAbi,
      functionName: inputData.functionName,
      buildFunctionParams: inputData.buildFunctionParams,
      tokenApproval:
        inputData.token !== 'ETH'
          ? {
              token: inputData.token,
              amount: inputData.amount.toString(),
            }
          : undefined,
    };
  }

  async runReview(
    sdk: NexusSDK,
    inputData: Partial<BridgeAndExecuteParams>,
  ): Promise<ActiveTransaction['simulationResult']> {
    let params: BridgeAndExecuteParams = inputData as BridgeAndExecuteParams;
    if (!params.execute) {
      const execute = this.buildExecute(inputData as any);
      params = { ...inputData, execute } as BridgeAndExecuteParams;
    }
    const simulationResult = await sdk.simulateBridgeAndExecute(params);
    logger.info('bridgeAndExecute simulationResult', simulationResult);

    let needsApproval = false;
    const chainDetails: Array<{
      chainId: number;
      amount: string;
      needsApproval: boolean;
    }> = [];

    // Check if bridge part needs allowance (when bridge is NOT skipped)
    if (simulationResult?.bridgeSimulation?.intent?.sources && inputData.token !== 'ETH') {
      const sourcesData = simulationResult.bridgeSimulation.intent.sources;
      
      for (const source of sourcesData) {
        const requiredAmount = sdk.utils.parseUnits(
          source.amount,
          sdk.utils.getTokenMetadata(inputData.token!)?.decimals ?? 18,
        );

        const allowances = await sdk.getAllowance(source.chainID, [inputData.token!]);
        logger.info(`bridgeAndExecute bridge allowances for chain ${source.chainID}:`, allowances);

        const currentAllowance = allowances[0]?.allowance ?? 0n;
        const chainNeedsApproval = currentAllowance < requiredAmount;

        if (chainNeedsApproval) {
          needsApproval = true;
          logger.info(
            `BridgeAndExecute bridge allowance needed on chain ${source.chainID}: required=${requiredAmount.toString()}, current=${currentAllowance.toString()}`,
          );
        }

        chainDetails.push({
          chainId: source.chainID,
          amount: requiredAmount.toString(),
          needsApproval: chainNeedsApproval,
        });
      }
    }

    // Also check if contract execution needs approval (when bridge is skipped)
    // This is handled by the execute service internally, but we can inform the UI
    const contractApprovalNeeded = !!simulationResult?.metadata?.approvalRequired;
    if (contractApprovalNeeded) {
      needsApproval = true;
    }

    return {
      ...simulationResult,
      allowance: {
        needsApproval,
        chainDetails: chainDetails.length > 0 ? chainDetails : undefined,
      },
    } as BridgeAndExecuteSimulationResult & {
      allowance: { 
        needsApproval: boolean;
        chainDetails?: Array<{
          chainId: number;
          amount: string;
          needsApproval: boolean;
        }>;
      };
    };
  }

  async confirmAndProceed(
    sdk: NexusSDK,
    inputData: Partial<BridgeAndExecuteParams>,
    _simulationResult?: ActiveTransaction['simulationResult'],
  ): Promise<BridgeAndExecuteResult> {
    let params: BridgeAndExecuteParams = inputData as BridgeAndExecuteParams;

    if (!params.execute) {
      const execute = this.buildExecute(inputData as any);
      params = { ...inputData, execute } as BridgeAndExecuteParams;
    }

    const result = await sdk.bridgeAndExecute(params);
    return result;
  }
}
