import { createPublicClient, http, type PublicClient } from 'viem';
import type { ChainListType } from '../../domain';
import type { PublicClientList } from '../types';

/**
 * Creates a PublicClientList that lazily creates and caches viem PublicClients
 * from chain RPC URLs resolved via the chain list.
 */
export const createPublicClientList = (chainList: ChainListType): PublicClientList => {
  const cache = new Map<number, PublicClient>();
  return {
    get(chainId: number): PublicClient {
      const cached = cache.get(chainId);
      if (cached) return cached;
      const chain = chainList.getChainByID(chainId);
      const client = createPublicClient({
        transport: http(chain.rpcUrls.default.http[0]),
        batch: { multicall: true },
      });
      cache.set(chainId, client);
      return client;
    },
  };
};
