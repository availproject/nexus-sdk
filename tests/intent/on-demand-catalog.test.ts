import { describe, expect, it, vi } from 'vitest';
import { createIntentCatalog } from '../../src/intent/catalog';
import { testChains } from '../fixtures/chains';
import { makeTokenFetcher } from '../helpers/catalog';

describe('on-demand catalog', () => {
  it('resolves a token with a chain and contract lookup and shares concurrent requests', async () => {
    const token = testChains[0].tokens[1];
    const fetch = vi.fn().mockResolvedValue({ tokens: [token], offset: 0, limit: 1, total: 1 });
    const catalog = createIntentCatalog(testChains, fetch);
    const results = await Promise.all([
      catalog.getToken(token.chainId, token.address),
      catalog.getToken(token.chainId, token.address),
    ]);
    expect(results).toEqual([token, token]);
    expect(fetch).toHaveBeenCalledExactlyOnceWith({
      chainId: token.chainId, contract: token.address, offset: 0, limit: 1,
    });
  });

  it('returns one page without draining the catalog', async () => {
    const page = { tokens: [testChains[0].tokens[1]], offset: 0, limit: 50, total: 5000 };
    const fetch = vi.fn().mockResolvedValue(page);
    const catalog = createIntentCatalog(testChains, fetch);
    await expect(catalog.getTokens({ chainId: 1 })).resolves.toEqual(page);
    await expect(catalog.getTokens({ chainId: 1, offset: 0, limit: 50 })).resolves.toEqual(page);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries failed queries instead of caching their rejection', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ tokens: [], offset: 0, limit: 50, total: 0 });
    const catalog = createIntentCatalog(testChains, fetch);
    await expect(catalog.getTokens()).rejects.toThrow('offline');
    await expect(catalog.getTokens()).resolves.toMatchObject({ total: 0 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not use provider-filtered metadata for an unrestricted token lookup', async () => {
    const token = testChains[0].tokens[0];
    const fetch = vi.fn()
      .mockResolvedValueOnce({ tokens: [{ ...token, providers: [{ id: 'mayan' }] }], offset: 0, limit: 50, total: 1 })
      .mockResolvedValueOnce({ tokens: [token], offset: 0, limit: 1, total: 1 });
    const catalog = createIntentCatalog(testChains, fetch);
    await catalog.getTokens({ providers: ['mayan'] });
    await expect(catalog.getToken(token.chainId, token.address)).resolves.toEqual(token);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('treats token metadata for an unknown chain as a backend failure', async () => {
    const token = { ...testChains[0].tokens[1], chainId: 999999 };
    const catalog = createIntentCatalog(testChains, vi.fn().mockResolvedValue({
      tokens: [token], offset: 0, limit: 50, total: 1,
    }));
    await expect(catalog.getTokens()).rejects.toMatchObject({ code: 'backend/error' });
  });

  it('preserves candidate offsets when directional filtering empties a page', async () => {
    const chains = structuredClone(testChains);
    chains[0].tokens[0].asDestination = [];
    const fetch = vi.fn(makeTokenFetcher(chains));
    const catalog = createIntentCatalog(chains, fetch);
    const first = await catalog.getAvailableDestinationTokens([], { chainId: 1, limit: 1 });
    expect(first).toEqual({ chains: [], offset: 0, limit: 1, total: 2 });
    expect(fetch).toHaveBeenCalledOnce();
    const second = await catalog.getAvailableDestinationTokens([], {
      chainId: 1, offset: first.offset + first.limit, limit: 1,
    });
    expect(second.chains[0].tokens[0].address).toBe(chains[0].tokens[1].address);
    expect(second).toMatchObject({ offset: 1, limit: 1, total: 2 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

});
