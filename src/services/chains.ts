import type { IntentChainMetadata, IntentProvider } from '../intent/types';

export type SupportedChainsResult = Array<{
  id: number;
  logo: string;
  name: string;
  swapSupported: boolean;
  asSource: IntentProvider[];
  asDestination: IntentProvider[];
}>;

export const getSupportedChainsFromCatalog = (
  catalog: IntentChainMetadata[]
): SupportedChainsResult =>
  catalog.map((chain) => ({
    id: chain.id,
    logo: chain.logo ?? '',
    name: chain.name,
    swapSupported: chain.swapSupported !== false,
    asSource: chain.asSource ?? chain.providers,
    asDestination: chain.asDestination ?? chain.providers,
  }));
