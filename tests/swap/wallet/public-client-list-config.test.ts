import { describe, expect, it, vi } from 'vitest';
import type { ChainListType } from '../../../src/domain';

const hoisted = vi.hoisted(() => ({
  createPublicClient: vi.fn().mockReturnValue({ getBlockNumber: vi.fn() }),
  http: vi.fn().mockImplementation((url: string) => ({ url })),
}));

vi.mock('viem', () => ({
  createPublicClient: hoisted.createPublicClient,
  http: hoisted.http,
}));

import { createPublicClientList } from '../../../src/swap/wallet/public-client-list';

const makeChainList = (): ChainListType =>
  ({
    getChainByID: vi.fn().mockImplementation((chainId: number) => ({
      id: chainId,
      name: `Chain ${chainId}`,
      rpcUrls: {
        default: { http: [`https://rpc.chain-${chainId}.example.com`] },
      },
    })),
  }) as unknown as ChainListType;

describe('createPublicClientList config', () => {
  it('enables multicall batching on created public clients', () => {
    const list = createPublicClientList(makeChainList());

    list.get(42161);

    expect(hoisted.createPublicClient).toHaveBeenCalledWith(
      expect.objectContaining({
        transport: { url: 'https://rpc.chain-42161.example.com' },
        batch: { multicall: true },
      })
    );
  });
});
