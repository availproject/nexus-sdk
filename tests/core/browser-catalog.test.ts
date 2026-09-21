import { expect, it, vi } from 'vitest';
import { getSwapTokenOptions } from '../../example/browser/src/lib/destinationTokens';
import { testChains } from '../fixtures/chains';

it('loads one destination page using server search and pagination', async () => {
  const getAvailableDestinationTokens = vi.fn().mockResolvedValue({
    chains: [testChains[0]], offset: 50, limit: 50, total: 5000,
  });
  const client = { getAvailableDestinationTokens, getSupportedChains: () => [] } as unknown as Parameters<typeof getSwapTokenOptions>[0];
  const query = { chainId: 1, symbol: 'usdc', offset: 50, limit: 50 };
  const page = await getSwapTokenOptions(client, query);
  expect(getAvailableDestinationTokens).toHaveBeenCalledExactlyOnceWith([], query);
  expect(page).toMatchObject({ offset: 50, limit: 50, total: 5000 });
  expect(page.options[1]).toMatchObject({ tokenAddress: testChains[0].tokens[1].address, decimals: 6 });
});
