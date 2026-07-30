import Decimal from 'decimal.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CurrencyID } from '../../../src/swap/cot';
import { SwapMode } from '../../../src/swap/types';

vi.mock('../../../src/swap/execution/source-swaps', () => ({
  executeSourceSwaps: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../src/swap/execution/bridge', () => ({
  executeSwapBridge: vi.fn(),
}));

vi.mock('../../../src/swap/execution/direct-destination', () => ({
  executeDirectDestinationExactOut: vi.fn(),
}));

vi.mock('../../../src/swap/execution/destination-swap', () => ({
  executeDestinationSwap: vi.fn(),
}));

vi.mock('../../../src/swap/execution/failure-cleanup', () => ({
  resolveFailureSweepCurrencyId: vi.fn().mockReturnValue(CurrencyID.USDC),
  cleanupStrandedCot: vi.fn().mockResolvedValue(undefined),
}));

import { executeSwapBridge } from '../../../src/swap/execution/bridge';
import { executeDestinationSwap } from '../../../src/swap/execution/destination-swap';
import { cleanupStrandedCot } from '../../../src/swap/execution/failure-cleanup';
import { executeSourceSwaps } from '../../../src/swap/execution/source-swaps';
import { executeSwapRoute } from '../../../src/swap/execution/orchestrator';

const makeRoute = () => ({
    type: SwapMode.EXACT_IN,
    directDestination: false,
    sameTokenBridge: false,
    settlementCurrencyId: CurrencyID.USDC,
    source: { swaps: [], creationTime: Date.now(), srcBuffer: null },
    bridge: null,
    destination: {
      chainId: 8453,
      swap: { tokenSwap: {}, gasSwap: null },
    },
    dstTokenInfo: {},
  });

describe('executeSwapRoute contracts', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps an executed source asset that was not present in the route-time bridge estimate', async () => {
    const executedOnly = {
      chainID: 10,
      contractAddress: '0x1111111111111111111111111111111111111111',
      decimals: 6,
      eoaBalance: new Decimal(0),
      ephemeralBalance: new Decimal('5'),
    };
    vi.mocked(executeSourceSwaps).mockResolvedValue([executedOnly] as never);
    const route = {
      ...makeRoute(),
      bridge: {
        assets: [],
      },
    };

    await executeSwapRoute(route as never, {} as never);

    expect(executeSwapBridge).toHaveBeenCalledWith(
      route.bridge,
      [executedOnly],
      expect.anything(),
      expect.anything()
    );
  });

  it('runs destination-chain cleanup when mandatory Exact In balance reads are exhausted', async () => {
    vi.mocked(executeDestinationSwap).mockRejectedValue(
      new Error('destination balance read failed')
    );
    const context = { destinationChainId: 8453 } as never;

    await expect(executeSwapRoute(makeRoute() as never, context)).rejects.toThrow(
      'destination balance read failed'
    );

    expect(cleanupStrandedCot).toHaveBeenCalledWith({
      currencyId: CurrencyID.USDC,
      chainIds: [8453],
      scope: 'destination',
      ctx: context,
    });
  });

  it('classifies a pre-bridge source failure as source-scoped when no bridge exists', async () => {
    vi.mocked(executeSourceSwaps).mockRejectedValue(new Error('source dispatch failed'));
    const context = { destinationChainId: 8453 } as never;

    await expect(executeSwapRoute(makeRoute() as never, context)).rejects.toThrow(
      'source dispatch failed'
    );

    expect(cleanupStrandedCot).toHaveBeenCalledWith({
      currencyId: CurrencyID.USDC,
      chainIds: [],
      scope: 'source',
      ctx: context,
    });
  });
});
