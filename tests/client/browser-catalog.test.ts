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

it('browses source tokens without balances and respects source support at both levels', async () => {
  const chain = { ...testChains[0], asSource: ['relay'] };
  const tokens = [
    { ...chain.tokens[1], chainId: chain.id, asSource: [{ id: 'relay' }] },
    { ...chain.tokens[0], chainId: chain.id, asSource: [] },
    { ...chain.tokens[1], chainId: chain.id, asSource: [{ id: 'mayan' }] },
  ];
  const getTokens = vi.fn().mockResolvedValue({ tokens, offset: 50, limit: 50, total: 5000 });
  const client = {
    getTokens, getSupportedChains: () => [chain],
    getAvailableDestinationTokens: vi.fn().mockResolvedValue({ chains: [], offset: 50, limit: 50, total: 5000 }),
  } as unknown as Parameters<typeof getSwapTokenOptions>[0];
  const query = { symbol: 'usdc', offset: 50, limit: 50 };
  const page = await getSwapTokenOptions(client, query, 'source');
  expect(getTokens).toHaveBeenCalledExactlyOnceWith(query);
  expect(page).toMatchObject({ offset: 50, limit: 50, total: 5000 });
  expect(page.options).toHaveLength(1);
  expect(page.options[0]).toMatchObject({
    tokenAddress: chain.tokens[1].address, decimals: chain.tokens[1].decimals,
  });
});
