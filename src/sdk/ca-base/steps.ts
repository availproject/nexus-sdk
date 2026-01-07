import {
  BRIDGE_STEPS,
  type BridgeStepType,
  type ChainListType,
  type Intent,
  type onAllowanceHookSource,
} from '../../commons';
import { isNativeAddress } from './constants';
import { Errors } from './errors';

const INTENT_FINISH_STEPS = [BRIDGE_STEPS.INTENT_FULFILLED];

const createSteps = (
  intent: Intent,
  chainList: ChainListType,
  unallowedSources?: onAllowanceHookSource[]
) => {
  const steps: BridgeStepType[] = [];

  steps.push(BRIDGE_STEPS.INTENT_ACCEPTED);
  if (unallowedSources && unallowedSources?.length > 0) {
    for (const source of unallowedSources) {
      steps.push(
        BRIDGE_STEPS.ALLOWANCE_APPROVAL_REQUEST(source.chain),
        BRIDGE_STEPS.ALLOWANCE_APPROVAL_MINED(source.chain)
      );
    }
    steps.push(BRIDGE_STEPS.ALLOWANCE_COMPLETE);
  }

  steps.push(BRIDGE_STEPS.INTENT_HASH_SIGNED, BRIDGE_STEPS.INTENT_SUBMITTED());

  const sources = intent.sources.filter((s) => s.chainID !== intent.destination.chainID);

  let collections = 0,
    deposits = 0;
  for (const [i, s] of sources.entries()) {
    const isNative = isNativeAddress(s.universe, s.tokenContract);
    if (isNative) {
      deposits++;
      const chain = chainList.getChainByID(s.chainID);
      if (!chain) {
        throw Errors.chainNotFound(s.chainID);
      }

      steps.push(BRIDGE_STEPS.INTENT_DEPOSIT_REQUEST(i + 1, s.amount, chain));
    } else {
      collections++;
      steps.push(BRIDGE_STEPS.INTENT_COLLECTION(i + 1, sources.length));
    }
  }

  if (collections > 0) {
    steps.push(BRIDGE_STEPS.INTENT_COLLECTION_COMPLETE);
  }

  if (deposits > 0) {
    steps.push(BRIDGE_STEPS.INTENT_DEPOSITS_CONFIRMED);
  }

  steps.push(...INTENT_FINISH_STEPS);
  return steps;
};

export { createSteps };
