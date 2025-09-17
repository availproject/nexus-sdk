import { isNativeAddress } from './constants';
import { ChainListType, Intent, onAllowanceHookSource, Step } from '@nexus/commons';

const INTENT_ACCEPTED = {
  type: 'INTENT_ACCEPTED',
  typeID: 'IA',
} as const;

const INTENT_HASH_SIGNED = {
  type: 'INTENT_HASH_SIGNED',
  typeID: 'IHS',
} as const;

const INTENT_SUBMITTED = {
  type: 'INTENT_SUBMITTED',
  typeID: 'IS',
} as const;

const INTENT_INIT_STEPS = [
  INTENT_HASH_SIGNED,
  {
    ...INTENT_SUBMITTED,
    data: {
      explorerURL: '',
      intentID: 0,
    },
  },
];

const INTENT_FULFILLED = {
  type: 'INTENT_FULFILLED',
  typeID: 'IF',
};
const ALLOWANCE_APPROVAL_REQ = (chainID: number) =>
  ({
    type: 'ALLOWANCE_USER_APPROVAL',
    typeID: `AUA_${chainID}`,
  }) as const;

const ALLOWANCE_APPROVAL_MINED = (chainID: number) => ({
  type: 'ALLOWANCE_APPROVAL_MINED',
  typeID: `AAM_${chainID}`,
});
const ALLOWANCE_COMPLETE = {
  type: 'ALLOWANCE_ALL_DONE',
  typeID: 'AAD',
};

const INTENT_DEPOSIT_REQ = (id: number) => ({
  type: 'INTENT_DEPOSIT',
  typeID: `ID_${id}`,
});

const INTENT_DEPOSITS_CONFIRMED = {
  type: 'INTENT_DEPOSITS_CONFIRMED',
  typeID: 'UIDC',
};

const INTENT_COLLECTION_COMPLETE = {
  type: 'INTENT_COLLECTION_COMPLETE',
  typeID: 'ICC',
};
const INTENT_COLLECTION = (id: number) => ({
  type: 'INTENT_COLLECTION',
  typeID: `IC_${id}`,
});

const INTENT_FINISH_STEPS = [INTENT_FULFILLED];

const createSteps = (
  intent: Intent,
  chainList: ChainListType,
  unallowedSources?: onAllowanceHookSource[],
) => {
  const steps: Step[] = [];

  steps.push(INTENT_ACCEPTED);
  if (unallowedSources && unallowedSources?.length > 0) {
    for (const source of unallowedSources) {
      steps.push(
        {
          ...ALLOWANCE_APPROVAL_REQ(source.chain.id),
          data: {
            chainID: source.chain.id,
            chainName: source.chain.name,
          },
        },
        {
          ...ALLOWANCE_APPROVAL_MINED(source.chain.id),
          data: {
            chainID: source.chain.id,
            chainName: source.chain.name,
          },
        },
      );
    }
    steps.push(ALLOWANCE_COMPLETE);
  }

  steps.push(...INTENT_INIT_STEPS);

  const sources = intent.sources.filter((s) => s.chainID !== intent.destination.chainID);

  let collections = 0,
    deposits = 0;
  for (const [i, s] of sources.entries()) {
    const isNative = isNativeAddress(s.universe, s.tokenContract);
    if (isNative) {
      deposits++;
      const chain = chainList.getChainByID(s.chainID);
      if (!chain) {
        throw new Error(`Unknown chain ID ${s.chainID} while building steps`);
      }

      steps.push({
        ...INTENT_DEPOSIT_REQ(i + 1),
        data: {
          amount: s.amount.toString(),
          chainID: chain.id,
          chainName: chain.name,
          symbol: chain.nativeCurrency.symbol,
        },
      });
    } else {
      collections++;
      steps.push({
        ...INTENT_COLLECTION(i + 1),
        data: {
          confirmed: i + 1,
          total: sources.length,
        },
      });
    }
  }

  if (collections > 0) {
    steps.push(INTENT_COLLECTION_COMPLETE);
  }

  if (deposits > 0) {
    steps.push(INTENT_DEPOSITS_CONFIRMED);
  }

  steps.push(...INTENT_FINISH_STEPS);
  return steps;
};

export {
  ALLOWANCE_APPROVAL_MINED,
  ALLOWANCE_APPROVAL_REQ,
  ALLOWANCE_COMPLETE,
  createSteps,
  INTENT_ACCEPTED,
  INTENT_COLLECTION,
  INTENT_COLLECTION_COMPLETE,
  INTENT_DEPOSIT_REQ,
  INTENT_DEPOSITS_CONFIRMED,
  INTENT_FULFILLED,
  INTENT_HASH_SIGNED,
  INTENT_SUBMITTED,
};
