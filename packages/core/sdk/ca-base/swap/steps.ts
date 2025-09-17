import { Hex } from 'viem';
import { Chain } from '@nexus/commons';
import { ChainListType } from '@nexus/commons';

export type SwapStep =
  | ReturnType<typeof CREATE_PERMIT_EOA_TO_EPHEMERAL>
  | ReturnType<typeof CREATE_PERMIT_FOR_SOURCE_SWAP>
  | ReturnType<typeof DESTINATION_SWAP_BATCH_TX>
  | ReturnType<typeof DESTINATION_SWAP_HASH>
  | ReturnType<typeof DETERMINING_SWAP>
  | ReturnType<typeof RFF_ID>
  | ReturnType<typeof SOURCE_SWAP_BATCH_TX>
  | ReturnType<typeof SOURCE_SWAP_HASH>
  | typeof SWAP_COMPLETE
  | typeof SWAP_START;

export const SWAP_START = {
  completed: true,
  type: 'SWAP_START',
  typeID: 'SWAP_START',
} as const;

export const DETERMINING_SWAP = (completed: boolean = false) =>
  ({
    completed,
    type: 'DETERMINING_SWAP',
    typeID: DETERMINING_SWAP,
  }) as const;

export const CREATE_PERMIT_EOA_TO_EPHEMERAL = (completed: boolean, symbol: string, chain: Chain) =>
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

export const CREATE_PERMIT_FOR_SOURCE_SWAP = (completed: boolean, symbol: string, chain: Chain) =>
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

export const SOURCE_SWAP_BATCH_TX = (completed: boolean) =>
  ({
    completed,
    type: 'SOURCE_SWAP_BATCH_TX',
    typeID: 'SOURCE_SWAP_BATCH_TX',
  }) as const;

export const SOURCE_SWAP_HASH = (ops: [bigint, Hex], chainList: ChainListType) => {
  const chainID = ops[0];
  const chain = chainList.getChainByID(Number(ops[0]));
  if (!chain) {
    throw new Error(`Unknown chain: ${ops[0]}`);
  }

  return {
    chain: {
      id: chain.id,
      name: chain.name,
    },
    completed: true,
    explorerURL: new URL(`/tx/${ops[1]}`, chain!.blockExplorers?.default.url).toString(),
    type: 'SOURCE_SWAP_HASH',
    typeID: `SOURCE_SWAP_HASH_${chainID}`,
  } as const;
};

export const RFF_ID = (id: number) =>
  ({
    completed: true,
    data: id,
    type: 'RFF_ID',
    typeID: 'RFF_ID',
  }) as const;

export const DESTINATION_SWAP_BATCH_TX = (completed: boolean) =>
  ({
    completed,
    type: 'DESTINATION_SWAP_BATCH_TX',
    typeID: 'DESTINATION_SWAP_BATCH_TX',
  }) as const;

export const SWAP_COMPLETE = {
  completed: true,
  type: 'SWAP_COMPLETE',
  typeID: 'SWAP_COMPLETE',
} as const;

export const DESTINATION_SWAP_HASH = (op: [bigint, Hex], chainList: ChainListType) => {
  const chain = chainList.getChainByID(Number(op[0]));
  if (!chain) {
    throw new Error(`Unknown chain: ${op[0]}`);
  }
  return {
    chain: {
      id: chain.id,
      name: chain.name,
    },
    completed: true,
    explorerURL: new URL(`/tx/${op[1]}`, chain!.blockExplorers?.default.url).toString(),
    type: 'DESTINATION_SWAP_HASH',
    typeID: `DESTINATION_SWAP_HASH_${chain.id}`,
  } as const;
};
