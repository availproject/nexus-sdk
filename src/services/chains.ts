import type { ChainListType, SupportedChainsAndTokensResult } from '../domain';
import { ZERO_ADDRESS } from '../domain';

export const getSupportedChainsFromChainList = (
  chainList: ChainListType
): SupportedChainsAndTokensResult => {
  return chainList.chains.map((chain) => {
    return {
      id: chain.id,
      logo: chain.custom.icon,
      name: chain.name,
      // `swapSupported === false` is the only disqualifier (mirrors route.ts / balances.ts);
      // an absent flag means the chain is swap-capable.
      swapSupported: chain.swapSupported !== false,
      tokens: [
        ...chain.custom.knownTokens,
        {
          contractAddress: ZERO_ADDRESS,
          decimals: chain.nativeCurrency.decimals,
          logo: chain.nativeCurrency.logo,
          name: chain.nativeCurrency.name,
          symbol: chain.nativeCurrency.symbol,
        },
      ],
    };
  });
};
