import type { AllowanceHookSource, BridgeIntentDraft, ChainListType } from '../../domain';
import { getAllowances } from '../../services/allowance-utils';
import { findInsufficientAllowanceSources } from '../intent/builder';

export type BridgeHookState = {
  intent: BridgeIntentDraft;
  insufficientAllowanceSources: AllowanceHookSource[];
};

export const buildHookStateFromIntent = async (
  intent: BridgeIntentDraft,
  options: { chainList: ChainListType }
): Promise<BridgeHookState> => {
  const allowances = await getAllowances(
    intent.availableSources.map((source) => ({
      chainID: source.chain.id,
      tokenContract: source.token.contractAddress,
      holderAddress: source.holderAddress,
    })),
    options.chainList
  );
  const insufficientAllowanceSources = findInsufficientAllowanceSources({
    intent,
    allowances,
    chainList: options.chainList,
  });

  return { intent, insufficientAllowanceSources };
};
