import { CurrencyID } from '@avail-project/ca-common';
import Decimal from 'decimal.js';
import type { Hex } from 'viem';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const determineSwapRouteMock = vi.hoisted(() => vi.fn());
const sourceProcessMock = vi.hoisted(() => vi.fn());
const dstProcessMock = vi.hoisted(() => vi.fn());
const dstCreatePermitMock = vi.hoisted(() => vi.fn());
const bridgeProcessMock = vi.hoisted(() => vi.fn());
const combinedProcessMock = vi.hoisted(() => vi.fn());
const cacheProcessMock = vi.hoisted(() => vi.fn());

vi.mock('../../src/swap/route', async () => {
  const actual =
    await vi.importActual<typeof import('../../src/swap/route')>('../../src/swap/route');
  return {
    ...actual,
    determineSwapRoute: determineSwapRouteMock,
  };
});

vi.mock('../../src/swap/ob', async () => {
  const actual = await vi.importActual<typeof import('../../src/swap/ob')>('../../src/swap/ob');
  return {
    ...actual,
    SourceSwapsHandler: class {
      process = sourceProcessMock.mockResolvedValue([]);
      getPlannedSafeChains = () => new Set<number>();
    },
    DestinationSwapHandler: class {
      createPermit = dstCreatePermitMock.mockResolvedValue(undefined);
      process = dstProcessMock.mockResolvedValue(undefined);
    },
    BridgeHandler: class {
      process = bridgeProcessMock.mockResolvedValue(undefined);
      getPlannedSafeDepositChains = () => new Set<number>();
    },
    CombinedSwapHandler: class {
      process = combinedProcessMock.mockResolvedValue(undefined);
    },
  };
});

vi.mock('../../src/swap/utils', async () => {
  const actual =
    await vi.importActual<typeof import('../../src/swap/utils')>('../../src/swap/utils');
  return {
    ...actual,
    Cache: class {
      process = cacheProcessMock.mockResolvedValue(undefined);
      addAllowanceQuery = vi.fn();
      addPermitQuery = vi.fn();
      addSetCodeQuery = vi.fn();
    },
    convertMetadataToSwapResult: vi.fn().mockReturnValue({ swapRoute: null }),
    PublicClientList: class {
      get = vi.fn();
    },
    validateDestinationChainForSwap: vi.fn(),
  };
});

vi.mock('../../src/swap/intent', () => ({
  createSwapIntent: vi.fn().mockReturnValue({}),
}));

import { swap } from '../../src/flows/swap';

const DST_CHAIN = 999;
const EOA: Hex = '0x1111111111111111111111111111111111111111';
const EPHEMERAL: Hex = '0x2222222222222222222222222222222222222222';
const EXEC_ADDR: Hex = '0x3333333333333333333333333333333333333333';

const makeRoute = (combined: boolean) => ({
  type: 'EXACT_IN' as const,
  source: {
    swaps: [],
    creationTime: Date.now(),
    executions: {
      [DST_CHAIN]: { address: EXEC_ADDR, entryPoint: null, mode: '7702' as const },
    },
  },
  bridge: null,
  destination: {
    chainId: DST_CHAIN,
    eoaToDestinationAccount: null,
    execution: { address: EXEC_ADDR, entryPoint: null, mode: '7702' as const },
    inputAmount: { min: new Decimal(0), max: new Decimal(0) },
    swap: { creationTime: Date.now(), gasSwap: null, tokenSwap: null },
    getDstSwap: vi.fn().mockResolvedValue(null),
  },
  combined,
  buffer: { amount: '0' },
  dstTokenInfo: { contractAddress: EOA, decimals: 6, symbol: 'TST' },
  extras: { aggregators: [], oraclePrices: [], balances: [], assetsUsed: [] },
});

const baseInput = () => ({
  data: {
    from: [],
    toChainId: DST_CHAIN,
    toTokenAddress: EOA,
  },
  mode: 0 as const,
});

const stubChain = {
  id: DST_CHAIN,
  name: 'Stub',
  blockExplorers: { default: { url: 'https://example.test' } },
};

const baseOptions = () => ({
  address: { cosmos: '', eoa: EOA, ephemeral: EPHEMERAL },
  chainList: {
    getChainByID: () => stubChain,
  } as never,
  cosmosQueryClient: {} as never,
  intentExplorerUrl: '',
  onSwapIntent: ({ allow }: { allow: () => void }) => allow(),
  vscClient: {
    vscEnsureSafeAccount: vi.fn().mockResolvedValue({ exists: true, deployTxHash: null }),
  } as never,
  wallet: {
    cosmos: {} as never,
    eoa: {} as never,
    ephemeral: {
      sign: vi.fn().mockResolvedValue('0xsig' as Hex),
      address: EPHEMERAL,
    } as never,
  },
});

describe('swap() orchestrator dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes through CombinedSwapHandler when route.combined === true', async () => {
    determineSwapRouteMock.mockResolvedValue(makeRoute(true));

    await swap(baseInput() as never, baseOptions() as never, CurrencyID.USDC);

    expect(combinedProcessMock).toHaveBeenCalledTimes(1);
    expect(sourceProcessMock).not.toHaveBeenCalled();
    expect(bridgeProcessMock).not.toHaveBeenCalled();
    expect(dstProcessMock).not.toHaveBeenCalled();
  });

  it('routes through Source/Bridge/Destination handlers when route.combined === false', async () => {
    determineSwapRouteMock.mockResolvedValue(makeRoute(false));

    await swap(baseInput() as never, baseOptions() as never, CurrencyID.USDC);

    expect(combinedProcessMock).not.toHaveBeenCalled();
    expect(sourceProcessMock).toHaveBeenCalledTimes(1);
    expect(bridgeProcessMock).toHaveBeenCalledTimes(1);
    expect(dstProcessMock).toHaveBeenCalledTimes(1);
  });
});
