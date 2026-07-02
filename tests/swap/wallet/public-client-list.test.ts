import { describe, expect, it, vi } from 'vitest';
import type { ChainListType } from '../../../src/domain';
import { createPublicClientList } from '../../../src/swap/wallet/public-client-list';

const makeChainList = (): ChainListType => ({
  getChainByID: vi.fn().mockImplementation((chainId: number) => ({
    id: chainId,
    name: `Chain ${chainId}`,
    rpcUrls: {
      default: { http: [`https://rpc.chain-${chainId}.example.com`] },
    },
  })),
} as unknown as ChainListType);

describe('createPublicClientList', () => {
  it('returns a PublicClient for a given chainId', () => {
    const chainList = makeChainList();
    const list = createPublicClientList(chainList);

    const client = list.get(42161);
    expect(client).toBeDefined();
    // viem PublicClient has standard methods
    expect(typeof client.getBlockNumber).toBe('function');
  });

  it('caches clients — same chainId returns same instance', () => {
    const chainList = makeChainList();
    const list = createPublicClientList(chainList);

    const a = list.get(42161);
    const b = list.get(42161);
    expect(a).toBe(b); // exact same reference

    // Only called chainList once for that chainId
    expect(chainList.getChainByID).toHaveBeenCalledTimes(1);
  });

  it('creates different clients for different chainIds', () => {
    const chainList = makeChainList();
    const list = createPublicClientList(chainList);

    const arb = list.get(42161);
    const base = list.get(8453);
    expect(arb).not.toBe(base);
    expect(chainList.getChainByID).toHaveBeenCalledTimes(2);
  });
});
