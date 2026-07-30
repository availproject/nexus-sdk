import { vi } from 'vitest';
import type { Hex } from 'viem';
import type { PublicClientList } from '../../src/swap/types';

type ReadContractRequest = {
  address?: Hex;
  args?: readonly unknown[];
  functionName: string;
};

type WatchContractEventRequest = {
  eventName?: string;
  onLogs: (logs: Array<{ transactionHash?: Hex }>) => void | Promise<void>;
};

export type DeterministicPublicClientOptions = {
  readContract?: (request: ReadContractRequest) => unknown | Promise<unknown>;
  watchContractEvent?: (
    request: WatchContractEventRequest,
    unwatch: ReturnType<typeof vi.fn>
  ) => void;
};

export const makeDeterministicPublicClient = (
  options: DeterministicPublicClientOptions = {}
) => {
  const readContract = vi.fn(async (request: ReadContractRequest) =>
    options.readContract ? options.readContract(request) : 0n
  );
  const watchContractEvent = vi.fn((request: WatchContractEventRequest) => {
    const unwatch = vi.fn();
    options.watchContractEvent?.(request, unwatch);
    return unwatch;
  });

  return {
    estimateFeesPerGas: vi.fn().mockResolvedValue({
      maxFeePerGas: 1n,
      maxPriorityFeePerGas: 1n,
    }),
    estimateGas: vi.fn().mockResolvedValue(1n),
    getCode: vi.fn().mockResolvedValue(undefined),
    getFeeHistory: vi.fn().mockResolvedValue({
      baseFeePerGas: [1n],
      gasUsedRatio: [0],
      oldestBlock: 1n,
      reward: [[1n, 1n, 1n]],
    }),
    getTransactionReceipt: vi.fn().mockResolvedValue({ status: 'success' }),
    multicall: vi.fn().mockResolvedValue([]),
    readContract,
    simulateContract: vi.fn().mockResolvedValue({ request: {} }),
    waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: 'success' }),
    watchContractEvent,
  };
};

export const makePublicClientList = (): PublicClientList =>
  ({
    get: vi.fn().mockReturnValue({
      getCode: vi.fn().mockResolvedValue(undefined),
      multicall: vi.fn().mockResolvedValue([]),
      readContract: vi.fn(),
    }),
  }) as unknown as PublicClientList;
