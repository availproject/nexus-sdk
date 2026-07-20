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

import { executeDestinationSwap } from '../../../src/swap/execution/destination-swap';
import { cleanupStrandedCot } from '../../../src/swap/execution/failure-cleanup';
import { executeSwapRoute } from '../../../src/swap/execution/orchestrator';

describe('executeSwapRoute destination cleanup', () => {
  beforeEach(() => vi.clearAllMocks());

  it('runs destination-chain cleanup when mandatory Exact In balance reads are exhausted', async () => {
    vi.mocked(executeDestinationSwap).mockRejectedValue(new Error('destination balance read failed'));
    const route = {
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
    } as never;
    const context = { destinationChainId: 8453 } as never;

    await expect(executeSwapRoute(route, context)).rejects.toThrow(
      'destination balance read failed'
    );

    expect(cleanupStrandedCot).toHaveBeenCalledWith({
      currencyId: CurrencyID.USDC,
      chainIds: [8453],
      ctx: context,
    });
  });
});
