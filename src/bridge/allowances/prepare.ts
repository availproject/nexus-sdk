import type { Hex, WalletClient } from 'viem';
import type { AllowanceHookSource, Chain, ChainListType } from '../../domain';
import type { AllowanceExecutionProgressUpdate } from '../../services/allowances';
import { executeAllowances, resolveAllowanceInputs } from '../../services/allowances';
import type { MiddlewareApprovalCreatorClient } from '../../transport';

export const prepareBridgeExecution = async (options: {
  allowanceSelections: Array<'max' | 'min' | bigint | string>;
  insufficientAllowanceSources: AllowanceHookSource[];
  bridge: {
    evm: {
      address: Hex;
      walletClient: WalletClient;
    };
    chainList: ChainListType;
    middlewareClient: MiddlewareApprovalCreatorClient;
  };
  dstChain: Chain;
  onProgress?: (update: AllowanceExecutionProgressUpdate) => void;
}): Promise<void> => {
  const { allowanceSelections, insufficientAllowanceSources } = options;

  if (insufficientAllowanceSources.length === 0) {
    return;
  }

  const val = resolveAllowanceInputs({
    sources: insufficientAllowanceSources,
    allowances: allowanceSelections,
  });

  await executeAllowances({
    sources: val,
    options: {
      evm: {
        address: options.bridge.evm.address,
        client: options.bridge.evm.walletClient,
      },
      chainList: options.bridge.chainList,
      middlewareClient: options.bridge.middlewareClient,
    },
    dstChain: options.dstChain,
    onProgress: options.onProgress,
  });
};
