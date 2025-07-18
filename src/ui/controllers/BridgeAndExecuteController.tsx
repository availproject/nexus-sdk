import React from 'react';
import type { ITransactionController, ActiveTransaction } from '../types';
import { NexusSDK } from '../../core/sdk';
import {
  BridgeAndExecuteParams,
  BridgeAndExecuteResult,
  BridgeAndExecuteSimulationResult,
} from '../../types';
import { UnifiedTransactionForm } from '../components/shared/unified-transaction-form';
import { validateExecuteConfig, findAbiFragment } from '../utils/utils';
import { logger } from '../../core/utils';
import type { DynamicParamBuilder } from '../types';
import type { ExecuteParams, SUPPORTED_TOKENS, SUPPORTED_CHAINS_IDS } from '../../types';
import { Abi } from 'viem';

export interface BridgeAndExecuteConfig extends Partial<BridgeAndExecuteParams> {}

const BridgeAndExecuteInputForm: React.FC<{
  prefill: Partial<BridgeAndExecuteConfig>;
  onUpdate: (data: Partial<BridgeAndExecuteConfig>) => void;
  isBusy: boolean;
  tokenBalance?: string;
  prefillFields?: {
    toChainId?: boolean;
    token?: boolean;
    amount?: boolean;
  };
}> = ({ prefill, onUpdate, isBusy, tokenBalance, prefillFields = {} }) => {
  return (
    <UnifiedTransactionForm
      type="bridgeAndExecute"
      inputData={prefill}
      onUpdate={onUpdate}
      disabled={isBusy}
      tokenBalance={tokenBalance}
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

  private async buildExecute(
    sdk: NexusSDK,
    inputData: {
      token: SUPPORTED_TOKENS;
      amount: string | number;
      toChainId: SUPPORTED_CHAINS_IDS;
      contractAddress: `0x${string}`;
      contractAbi: Abi;
      functionName: string;
      buildFunctionParams: DynamicParamBuilder;
    },
  ): Promise<Omit<ExecuteParams, 'toChainId'>> {
    const provider = sdk.getEVMProviderWithCA();

    let userAddress: `0x${string}` | undefined;
    try {
      const accounts = (await provider.request({ method: 'eth_accounts' })) as string[];
      userAddress = (accounts && accounts[0]) as `0x${string}` | undefined;
    } catch (error) {
      logger.error('User address not found', error as Error);
      userAddress = undefined;
    }

    if (!userAddress) {
      throw new Error('Unable to determine active wallet address');
    }

    const amountStrRaw = inputData.amount.toString();

    const { functionParams: rawParams, value } = inputData.buildFunctionParams(
      inputData.token,
      amountStrRaw,
      inputData.toChainId,
      userAddress,
    );

    let functionParams: readonly unknown[] = rawParams;

    try {
      const fragment = findAbiFragment(
        inputData.contractAbi,
        inputData.functionName,
        rawParams.length,
      );

      if (fragment && Array.isArray(fragment.inputs)) {
        const tokenMeta = sdk.utils.getTokenMetadata(inputData.token);
        const decimals = tokenMeta?.decimals ?? 18;

        functionParams = rawParams.map((param, idx) => {
          const input = fragment.inputs[idx];
          if (!input || typeof input.type !== 'string') return param;

          const expected = input.type.toLowerCase();

          if (
            (expected.startsWith('uint') || expected.startsWith('int')) &&
            typeof param === 'string' &&
            param.includes('.')
          ) {
            try {
              const parsed = sdk.utils.parseUnits(param, decimals);
              return parsed;
            } catch (_) {
              return param;
            }
          }

          return param;
        });
      }
    } catch (err) {
      functionParams = rawParams;
    }

    let tokenApprovalAmount = amountStrRaw;
    if (amountStrRaw.includes('.')) {
      try {
        const tokenMeta = sdk.utils.getTokenMetadata(inputData.token);
        const decimals = tokenMeta?.decimals ?? 18;
        tokenApprovalAmount = sdk.utils.parseUnits(amountStrRaw, decimals).toString();
      } catch (_) {}
    }

    const execute: {
      contractAddress: `0x${string}`;
      contractAbi: Abi;
      functionName: string;
      functionParams: readonly unknown[];
      value?: string;
      tokenApproval?: {
        token: SUPPORTED_TOKENS;
        amount: string;
      };
    } = {
      contractAddress: inputData.contractAddress,
      contractAbi: inputData.contractAbi,
      functionName: inputData.functionName,
      functionParams,
      value: value ?? '0',
    };

    if (inputData.token !== 'ETH') {
      execute.tokenApproval = {
        token: inputData.token,
        amount: tokenApprovalAmount,
      };
    }

    validateExecuteConfig(execute as Omit<ExecuteParams, 'toChainId'>, inputData.contractAbi);

    if (execute.value === undefined || execute.value === null) {
      execute.value = '0x0';
    } else if (typeof execute.value === 'number' || typeof execute.value === 'bigint') {
      const bn = BigInt(execute.value);
      execute.value = '0x' + bn.toString(16);
    } else if (typeof execute.value === 'string') {
      if (execute.value === '0') {
        execute.value = '0x0';
      } else if (!execute.value.startsWith('0x')) {
        try {
          const bn = BigInt(execute.value);
          execute.value = '0x' + bn.toString(16);
        } catch (_) {}
      }
    }

    return execute as Omit<ExecuteParams, 'toChainId'>;
  }

  async runReview(
    sdk: NexusSDK,
    inputData: Partial<BridgeAndExecuteParams>,
  ): Promise<ActiveTransaction['simulationResult']> {
    let params: BridgeAndExecuteParams = inputData as BridgeAndExecuteParams;
    if (!params.execute) {
      const execute = await this.buildExecute(sdk, inputData as any);
      params = { ...inputData, execute } as BridgeAndExecuteParams;
    }
    const simulationResult = await sdk.simulateBridgeAndExecute(params);
    logger.info('bridgeAndExecute simulationResult', simulationResult);

    const needsApproval = !!simulationResult?.metadata?.approvalRequired;

    return {
      ...simulationResult,
      allowance: {
        needsApproval,
      },
    } as BridgeAndExecuteSimulationResult & {
      allowance: { needsApproval: boolean };
    };
  }

  async confirmAndProceed(
    sdk: NexusSDK,
    inputData: Partial<BridgeAndExecuteParams>,
    _simulationResult?: ActiveTransaction['simulationResult'],
  ): Promise<BridgeAndExecuteResult> {
    let params: BridgeAndExecuteParams = inputData as BridgeAndExecuteParams;

    if (!params.execute) {
      const execute = await this.buildExecute(sdk, inputData as any);
      params = { ...inputData, execute } as BridgeAndExecuteParams;
    }

    const result = await sdk.bridgeAndExecute(params);
    return result;
  }
}
