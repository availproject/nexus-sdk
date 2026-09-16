import type { TokenInfo } from '../domain';
import { ZERO_ADDRESS } from '../domain';
import type { IntentChain, IntentProvider, IntentProviderSupport } from '../intent/types';
import { isNativeAddress } from './addresses';
import { createChainList } from './chain-list';
import { equalFold } from './strings';

export type SupportedChainsAndTokensResult = Array<{
  id: number;
  logo: string;
  name: string;
  swapSupported: boolean;
  asSource: IntentProvider[];
  asDestination: IntentProvider[];
  tokens: Array<
    TokenInfo & {
      asSource: IntentProviderSupport[];
      asDestination: IntentProviderSupport[];
    }
  >;
}>;

export const getSupportedChainsFromCatalog = (
  catalog: IntentChain[]
): SupportedChainsAndTokensResult => {
  const chainList = createChainList(catalog);
  const catalogById = new Map(catalog.map((chain) => [chain.id, chain]));
  return chainList.chains.map((chain) => {
    const metadata = catalogById.get(chain.id);
    return {
      id: chain.id,
      logo: chain.custom.icon,
      name: chain.name,
      // `swapSupported === false` is the only disqualifier (mirrors route.ts / balances.ts);
      // an absent flag means the chain is swap-capable.
      swapSupported: chain.swapSupported !== false,
      asSource: metadata?.asSource ?? metadata?.providers ?? [],
      asDestination: metadata?.asDestination ?? metadata?.providers ?? [],
      tokens: [
        ...chain.custom.knownTokens,
        {
          contractAddress: ZERO_ADDRESS,
          decimals: chain.nativeCurrency.decimals,
          logo: chain.nativeCurrency.logo,
          name: chain.nativeCurrency.name,
          symbol: chain.nativeCurrency.symbol,
        },
      ].map((token) => {
        const tokenMetadata = metadata?.tokens.find((entry) =>
          isNativeAddress(token.contractAddress)
            ? entry.isNative
            : equalFold(entry.address, token.contractAddress)
        );
        return {
          ...token,
          asSource: tokenMetadata?.asSource ?? tokenMetadata?.providers ?? [],
          asDestination: tokenMetadata?.asDestination ?? tokenMetadata?.providers ?? [],
        };
      }),
    };
  });
};
