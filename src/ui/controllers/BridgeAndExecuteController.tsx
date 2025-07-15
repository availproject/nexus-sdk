import React from 'react';
import type { ITransactionController, ActiveTransaction } from '../types';
import { NexusSDK } from '../..';
import {
  BridgeAndExecuteParams,
  BridgeAndExecuteResult,
  BridgeAndExecuteSimulationResult,
} from '../../types';
import { FormField } from '../components/shared/form-field';
import { AmountInput } from '../components/shared/amount-input';
import { ChainSelect } from '../components/shared/chain-select';
import { TokenSelect } from '../components/shared/token-select';
import { useInternalNexus } from '../providers/InternalNexusProvider';
import { cn, validateExecuteConfig, findAbiFragment } from '../utils/utils';
import { logger } from '../../core/utils';
import type { DynamicParamBuilder } from '../types';
import type { ExecuteParams, SUPPORTED_TOKENS, SUPPORTED_CHAINS_IDS } from '../../types';
import { Abi } from 'viem';

/**
 * Configuration interface for Bridge & Execute transactions.
 * Only bridge inputs are collected from user; execute parameters are supplied via button props.
 */
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
  const { config, isSdkInitialized, isSimulating } = useInternalNexus();
  const isInputDisabled = isBusy || isSimulating;

  const handleUpdate = (field: keyof BridgeAndExecuteConfig, value: string | number) => {
    onUpdate({ [field]: value });
  };

  return (
    <div className={cn('px-6 flex flex-col gap-y-4 w-full')}>
      <div className="flex gap-x-4 w-full">
        <FormField label="Destination Network" className="flex-1">
          <ChainSelect
            value={prefill.toChainId?.toString() || ''}
            onValueChange={(chainId) => {
              if (isInputDisabled || prefillFields.toChainId) return;
              const id = parseInt(chainId, 10);
              handleUpdate('toChainId', id as number);
            }}
            disabled={isInputDisabled || prefillFields.toChainId}
            network={config.network}
          />
        </FormField>

        <FormField label="Token to be deposited" className="flex-1">
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

      <FormField
        label="Amount"
        helperText={
          isSdkInitialized ? `Balance: ${tokenBalance ?? ''} ${prefill.token ?? ''}` : undefined
        }
        className="nexus-font-primary"
      >
        <AmountInput
          value={prefill?.amount ? prefill.amount?.toString() : ''}
          suffix={prefill.token || ''}
          disabled={isInputDisabled || prefillFields.amount}
          className="nexus-font-primary"
          onChange={
            isInputDisabled || prefillFields.amount
              ? undefined
              : (value) => handleUpdate('amount', value)
          }
        />
      </FormField>
    </div>
  );
};

/**
 * Controller for Bridge & Execute transactions.
 * Handles validation of bridge inputs combined with execute configuration,
 * orchestrates simulation and execution via the NexusSDK.
 */
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

  /**
   * Build the Execute object from current input.
   * Fetches the active wallet address via the CA-enhanced provider (eth_accounts).
   */
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

    // Normalize numeric parameters (e.g., amount) to integer strings / BigInt where required
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

          // If the parameter expects uint/int and the provided value is a string with a decimal,
          // convert it to smallest unit using parseUnits
          if (
            (expected.startsWith('uint') || expected.startsWith('int')) &&
            typeof param === 'string' &&
            param.includes('.')
          ) {
            try {
              const parsed = sdk.utils.parseUnits(param, decimals);
              return parsed;
            } catch (_) {
              return param; // fallback to original if parsing fails
            }
          }

          return param;
        });
      }
    } catch (err) {
      // If any issues during normalization, fallback to raw parameters
      functionParams = rawParams;
    }

    // If tokenApproval is needed, ensure amount is integer string (no decimals)
    let tokenApprovalAmount = amountStrRaw;
    if (amountStrRaw.includes('.')) {
      try {
        const tokenMeta = sdk.utils.getTokenMetadata(inputData.token);
        const decimals = tokenMeta?.decimals ?? 18;
        tokenApprovalAmount = sdk.utils.parseUnits(amountStrRaw, decimals).toString();
      } catch (_) {
        // keep original if parse fails
      }
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

    // Validate input vs ABI
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
          // Convert decimal string to hex Wei string
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
