import type { Hex } from 'viem';
import { Errors } from '../../sdk/ca-base/errors';
import type { ChainListType } from '.';

const SWAP_START = {
  completed: true,
  type: 'SWAP_START',
  typeID: 'SWAP_START',
} as const;

const DETERMINING_SWAP = (completed = false) =>
  ({
    completed,
    type: 'DETERMINING_SWAP',
    typeID: DETERMINING_SWAP,
  }) as const;

const CREATE_PERMIT_EOA_TO_EPHEMERAL = (
  completed: boolean,
  symbol: string,
  chain: { id: number; name?: string }
) =>
  ({
    chain: {
      id: chain.id,
      name: chain.name,
    },
    completed,
    symbol,
    type: 'CREATE_PERMIT_EOA_TO_EPHEMERAL',
    typeID: `CREATE_PERMIT_EOA_TO_EPHEMERAL_${chain.id}_${symbol}`,
  }) as const;

const CREATE_PERMIT_FOR_SOURCE_SWAP = (
  completed: boolean,
  symbol: string,
  chain: { id: number; name?: string }
) =>
  ({
    chain: {
      id: chain.id,
      name: chain.name,
    },
    completed,
    symbol,
    type: 'CREATE_PERMIT_FOR_SOURCE_SWAP',
    typeID: `CREATE_PERMIT_FOR_SOURCE_SWAP_${chain.id}_${symbol}`,
  }) as const;

const SOURCE_SWAP_BATCH_TX = (completed: boolean) =>
  ({
    completed,
    type: 'SOURCE_SWAP_BATCH_TX',
    typeID: 'SOURCE_SWAP_BATCH_TX',
  }) as const;

const BRIDGE_DEPOSIT = (data: {
  chain: { id: number; name: string };
  hash: Hex;
  explorerURL: string;
}) =>
  ({
    type: 'BRIDGE_DEPOSIT',
    typeID: `BRIDGE_DEPOSIT_${data.chain.id}`,
    data,
  }) as const;

const SOURCE_SWAP_HASH = (ops: [bigint, Hex], chainList: ChainListType) => {
  const chainID = ops[0];
  const chain = chainList.getChainByID(Number(ops[0]));
  if (!chain) {
    throw Errors.chainNotFound(chainID);
  }

  return {
    chain: {
      id: chain.id,
      name: chain.name,
    },
    completed: true,
    explorerURL: new URL(`/tx/${ops[1]}`, chain.blockExplorers.default.url).toString(),
    type: 'SOURCE_SWAP_HASH',
    typeID: `SOURCE_SWAP_HASH_${chainID}`,
  } as const;
};

const RFF_ID = (id: number) =>
  ({
    completed: true,
    data: id,
    type: 'RFF_ID',
    typeID: 'RFF_ID',
  }) as const;

const DESTINATION_SWAP_BATCH_TX = (completed: boolean) =>
  ({
    completed,
    type: 'DESTINATION_SWAP_BATCH_TX',
    typeID: 'DESTINATION_SWAP_BATCH_TX',
  }) as const;

const SWAP_COMPLETE = {
  completed: true,
  type: 'SWAP_COMPLETE',
  typeID: 'SWAP_COMPLETE',
} as const;

/**
 * Event emitted when a swap is skipped in swapAndExecute because the user
 * already has sufficient balance on the destination chain.
 *
 * @param data - The swap skip event data
 * @param data.destination - Information about what the user will receive
 * @param data.destination.amount - The output amount (in atomic units as string)
 * @param data.destination.chain - The destination chain info (id and name)
 * @param data.destination.token - The destination token info (address, decimals, symbol)
 * @param data.input - Information about the requested input
 * @param data.input.amount - The input amount requested (in atomic units as string)
 * @param data.input.token - The input token info (address, decimals, symbol)
 * @param data.gas - Gas estimation details for the execute transaction
 * @param data.gas.required - Total gas units required (approval + execution)
 * @param data.gas.price - Gas price used for estimation (in wei as string)
 * @param data.gas.estimatedFee - Total estimated gas fee (gas * price, in wei as string)
 *
 * @example
 * ```typescript
 * sdk.swapAndExecute(params, {
 *   onEvent: (event) => {
 *     if (event.name === NEXUS_EVENTS.SWAP_STEP_COMPLETE) {
 *       if (event.args.type === 'SWAP_SKIPPED') {
 *         console.log('Swap skipped - user has sufficient balance');
 *         console.log('Output amount:', event.args.data.destination.amount);
 *         console.log('Gas fee:', event.args.data.gas.estimatedFee);
 *       }
 *     }
 *   },
 * });
 * ```
 */
const SWAP_SKIPPED = (data: {
  destination: {
    amount: string;
    chain: { id: number; name: string };
    token: { contractAddress: Hex; decimals: number; symbol: string };
  };
  input: {
    amount: string;
    token: { contractAddress: Hex; decimals: number; symbol: string };
  };
  gas: {
    required: string;
    price: string;
    estimatedFee: string;
  };
}) =>
  ({
    completed: true,
    type: 'SWAP_SKIPPED',
    typeID: 'SWAP_SKIPPED',
    data,
  }) as const;

const DESTINATION_SWAP_HASH = (op: [bigint, Hex], chainList: ChainListType) => {
  const chainID = Number(op[0]);
  const chain = chainList.getChainByID(chainID);
  if (!chain) {
    throw Errors.chainNotFound(chainID);
  }

  return {
    chain: {
      id: chain.id,
      name: chain.name,
    },
    completed: true,
    explorerURL: new URL(`/tx/${op[1]}`, chain.blockExplorers.default.url).toString(),
    type: 'DESTINATION_SWAP_HASH',
    typeID: `DESTINATION_SWAP_HASH_${chain.id}`,
  } as const;
};

export const SWAP_STEPS = {
  SWAP_START,
  CREATE_PERMIT_EOA_TO_EPHEMERAL,
  CREATE_PERMIT_FOR_SOURCE_SWAP,
  DESTINATION_SWAP_BATCH_TX,
  DESTINATION_SWAP_HASH,
  DETERMINING_SWAP,
  RFF_ID,
  SOURCE_SWAP_BATCH_TX,
  SOURCE_SWAP_HASH,
  SWAP_COMPLETE,
  SWAP_SKIPPED,
  BRIDGE_DEPOSIT,
};

export type SwapStepType =
  | ReturnType<typeof SWAP_STEPS.CREATE_PERMIT_EOA_TO_EPHEMERAL>
  | ReturnType<typeof SWAP_STEPS.CREATE_PERMIT_FOR_SOURCE_SWAP>
  | ReturnType<typeof SWAP_STEPS.DESTINATION_SWAP_BATCH_TX>
  | ReturnType<typeof SWAP_STEPS.DESTINATION_SWAP_HASH>
  | ReturnType<typeof SWAP_STEPS.DETERMINING_SWAP>
  | ReturnType<typeof SWAP_STEPS.RFF_ID>
  | ReturnType<typeof SWAP_STEPS.SOURCE_SWAP_BATCH_TX>
  | ReturnType<typeof SWAP_STEPS.SOURCE_SWAP_HASH>
  | ReturnType<typeof SWAP_STEPS.BRIDGE_DEPOSIT>
  | ReturnType<typeof SWAP_STEPS.SWAP_SKIPPED>
  | typeof SWAP_STEPS.SWAP_COMPLETE
  | typeof SWAP_STEPS.SWAP_START;
