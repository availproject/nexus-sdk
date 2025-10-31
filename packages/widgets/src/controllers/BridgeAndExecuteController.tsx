import React from 'react';
import type { ITransactionController, ActiveTransaction } from '../types';
import { NexusSDK } from '@avail-project/nexus-core';
import {
  UnifiedTransactionForm,
  UnifiedInputData,
} from '../components/shared/unified-transaction-form';

import {
  type DynamicParamBuilder,
  type ExecuteParams,
  type SUPPORTED_TOKENS,
  type SUPPORTED_CHAINS_IDS,
  type BridgeAndExecuteParams,
  type BridgeAndExecuteResult,
  type BridgeAndExecuteSimulationResult,
  logger,
  NexusNetwork,
} from '@nexus/commons';
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
  // Transform BridgeAndExecuteConfig to UnifiedInputData
  const unifiedInputData: UnifiedInputData = {
    toChainId: prefill?.toChainId,
    token: prefill?.token,
    amount: prefill?.amount,
  };

  // Transform UnifiedInputData back to BridgeAndExecuteConfig
  const handleUpdate = (data: UnifiedInputData) => {
    // Only include defined values to avoid overwriting existing data
    const transformedData: any = {};
    if (data.toChainId !== undefined) transformedData.toChainId = data.toChainId;
    if (data.token !== undefined) transformedData.token = data.token;
    if (data.amount !== undefined) transformedData.amount = data.amount;

    onUpdate(transformedData);
  };

  return (
    <UnifiedTransactionForm
      type="bridgeAndExecute"
      inputData={unifiedInputData}
      onUpdate={handleUpdate}
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
    config: { network?: NexusNetwork; debug?: boolean },
    inputData: Partial<BridgeAndExecuteParams>,
    _simulationResult?: ActiveTransaction['simulationResult'],
  ): Promise<BridgeAndExecuteResult> {
    let params: BridgeAndExecuteParams = inputData as BridgeAndExecuteParams;

    if (!params.execute) {
      const execute = this.buildExecute(inputData as any);
      params = { ...inputData, execute } as BridgeAndExecuteParams;
    }
    // const intentData = {
    //   intentType: 'bridgeAndExecute',
    //   ...params,
    // };
    // trackIntentCreated(
    //   { network: config?.network ?? 'mainnet', debug: config?.debug ?? false },
    //   intentData as any,
    // );
    const result = await sdk.bridgeAndExecute(params);
    return result;
  }
}
