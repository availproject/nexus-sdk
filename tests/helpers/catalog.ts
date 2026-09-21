import type { IntentChain, IntentTokenQuery } from '../../src/intent/types';

export const makeTokenFetcher = (chains: IntentChain[]) => async (query: IntentTokenQuery = {}) => {
  const tokens = chains.flatMap((chain) => chain.tokens).filter((token) =>
    (query.chainId === undefined || token.chainId === query.chainId) &&
    (!query.providers?.length || token.providers.some(({ id }) => query.providers!.includes(id))) &&
    (query.name === undefined || token.name.toLowerCase().includes(query.name.toLowerCase())) &&
    (query.symbol === undefined || token.symbol.toLowerCase().includes(query.symbol.toLowerCase())) &&
    (query.contract === undefined || token.address.toLowerCase().includes(query.contract.toLowerCase()))
  );
  const offset = query.offset ?? 0;
  const limit = query.limit ?? 50;
  return { tokens: tokens.slice(offset, offset + limit), total: tokens.length, offset, limit };
};
