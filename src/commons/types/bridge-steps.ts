import type Decimal from 'decimal.js';
import type { Hex } from 'viem';

const INTENT_ACCEPTED = {
  type: 'INTENT_ACCEPTED',
  typeID: 'IA',
} as const;

const INTENT_HASH_SIGNED = {
  type: 'INTENT_HASH_SIGNED',
  typeID: 'IHS',
} as const;

const INTENT_SUBMITTED = (explorerURL = 'unknown', intentID = 'unknown') =>
  ({
    type: 'INTENT_SUBMITTED',
    typeID: 'IS',
    data: {
      explorerURL,
      intentID,
    },
  }) as const;

const INTENT_FULFILLED = {
  type: 'INTENT_FULFILLED',
  typeID: 'IF',
} as const;

const ALLOWANCE_APPROVAL_REQUEST = (chain: { id: number; name?: string }) =>
  ({
    type: 'ALLOWANCE_USER_APPROVAL',
    typeID: `AUA_${chain.id}`,
    data: {
      chainID: chain.id,
      chainName: chain.name,
    },
  }) as const;

const ALLOWANCE_APPROVAL_MINED = (chain: { id: number; name?: string }) =>
  ({
    type: 'ALLOWANCE_APPROVAL_MINED',
    typeID: `AAM_${chain.id}`,
    data: {
      chainID: chain.id,
      chainName: chain.name,
    },
  }) as const;

const ALLOWANCE_COMPLETE = {
  type: 'ALLOWANCE_ALL_DONE',
  typeID: 'AAD',
} as const;

const INTENT_DEPOSIT_REQUEST = (
  id: number,
  amount: Decimal,
  chain: { id: number; name?: string }
) =>
  ({
    type: 'INTENT_DEPOSIT',
    typeID: `ID_${id}`,
    data: {
      amount: amount.toFixed(),
      chainID: chain.id,
      chainName: chain.name,
    },
  }) as const;

const INTENT_DEPOSITS_CONFIRMED = {
  type: 'INTENT_DEPOSITS_CONFIRMED',
  typeID: 'UIDC',
} as const;

const INTENT_COLLECTION_COMPLETE = {
  type: 'INTENT_COLLECTION_COMPLETE',
  typeID: 'ICC',
} as const;

const INTENT_COLLECTION = (id: number, total: number, txHash?: Hex, explorerUrl?: string) =>
  ({
    type: 'INTENT_COLLECTION',
    typeID: `IC_${id}`,
    data: {
      confirmed: id,
      total,
      txHash,
      explorerUrl,
    },
  }) as const;

const EXECUTE_APPROVAL_STEP = {
  type: 'APPROVAL',
  typeID: 'AP',
} as const;

const EXECUTE_TRANSACTION_SENT = {
  type: 'TRANSACTION_SENT',
  typeID: 'TS',
} as const;

const EXECUTE_TRANSACTION_CONFIRMED = {
  type: 'TRANSACTION_CONFIRMED',
  typeID: 'CN',
} as const;

const BRIDGE_STEPS = {
  INTENT_ACCEPTED,
  ALLOWANCE_APPROVAL_REQUEST,
  ALLOWANCE_APPROVAL_MINED,
  ALLOWANCE_COMPLETE,
  INTENT_COLLECTION,
  INTENT_HASH_SIGNED,
  INTENT_COLLECTION_COMPLETE,
  INTENT_DEPOSITS_CONFIRMED,
  INTENT_DEPOSIT_REQUEST,
  INTENT_FULFILLED,
  INTENT_SUBMITTED,
  EXECUTE_APPROVAL_STEP,
  EXECUTE_TRANSACTION_CONFIRMED,
  EXECUTE_TRANSACTION_SENT,
};

type BridgeStepType =
  | ReturnType<typeof ALLOWANCE_APPROVAL_REQUEST>
  | ReturnType<typeof ALLOWANCE_APPROVAL_MINED>
  | ReturnType<typeof INTENT_DEPOSIT_REQUEST>
  | ReturnType<typeof INTENT_SUBMITTED>
  | ReturnType<typeof INTENT_COLLECTION>
  | typeof INTENT_ACCEPTED
  | typeof INTENT_HASH_SIGNED
  | typeof INTENT_DEPOSITS_CONFIRMED
  | typeof INTENT_COLLECTION_COMPLETE
  | typeof INTENT_FULFILLED
  | typeof ALLOWANCE_COMPLETE
  | typeof EXECUTE_APPROVAL_STEP
  | typeof EXECUTE_TRANSACTION_CONFIRMED
  | typeof EXECUTE_TRANSACTION_SENT;

export { type BridgeStepType, BRIDGE_STEPS };
