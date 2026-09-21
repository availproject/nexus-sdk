import type { Hex } from 'viem';
import type { Chain } from '../domain';
import { ZERO_ADDRESS } from '../domain';
import { Errors } from '../domain/errors';
import {
  INTENT_PROVIDERS,
  type IntentChain,
  type IntentProvider,
  type IntentSource,
  type IntentToken,
  type ProviderTokenGroup,
  type TokenRef,
} from './types';

export const intentNetworkEnabled = (network: string): boolean =>
  network === 'mainnet' || network === 'canary';

const sameAddress = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

export type IntentCatalog = {
  chains: IntentChain[];
  getChain: (chainId: number) => IntentChain;
  getToken: (chainId: number, address: Hex) => IntentToken;
  getAvailableSourceTokens: (
    destination: TokenRef,
    selectedSources?: TokenRef[]
  ) => ProviderTokenGroup[];
  getAvailableDestinationTokens: (sources: TokenRef[]) => IntentChain[];
  confirmRouteExists: (sources: TokenRef[], destination: TokenRef) => boolean;
  validateExactInput: (sources: IntentToken[], destination: IntentToken) => void;
  getExactOutputSources: (
    destination: IntentToken,
    selected?: IntentSource[]
  ) => Array<{ chainId: number; tokens: Hex[] }>;
};

export const createIntentCatalog = (chains: IntentChain[]): IntentCatalog => {
  const chainsById = new Map(chains.map((chain) => [chain.id, chain]));
  const getChain = (chainId: number): IntentChain => {
    const chain = chainsById.get(chainId);
    if (!chain) throw Errors.chainNotFound(chainId);
    return chain;
  };

  const findToken = (chainId: number, address: Hex) =>
    chainsById.get(chainId)?.tokens.find((entry) => sameAddress(entry.address, address));

  const getToken = (chainId: number, address: Hex): IntentToken => {
    getChain(chainId);
    const token = findToken(chainId, address);
    if (!token) throw Errors.tokenNotSupported(address, chainId);
    return token;
  };

  const tokenProviders = (token: IntentToken, role: 'asSource' | 'asDestination') => {
    const chain = getChain(token.chainId);
    const supported = chain[role] ?? chain.providers;
    return (token[role] ?? token.providers)
      .map(({ id }) => id)
      .filter((id) => supported.includes(id));
  };

  const commonSourceProviders = (sources: IntentToken[], providers: readonly IntentProvider[]) =>
    sources.reduce(
      (common, source) => common.filter((id) => tokenProviders(source, 'asSource').includes(id)),
      [...providers]
    );

  const matchingChains = (role: 'asSource' | 'asDestination', providers: IntentProvider[]) =>
    chains.flatMap((chain) => {
      const tokens = chain.tokens.filter((token) =>
        tokenProviders(token, role).some((id) => providers.includes(id))
      );
      return tokens.length ? [{ ...chain, tokens }] : [];
    });

  const getAvailableSourceTokens: IntentCatalog['getAvailableSourceTokens'] = (
    destination,
    selectedSources
  ) => {
    const supported = commonSourceProviders(
      (selectedSources ?? []).map(({ chainId, tokenAddress }) => getToken(chainId, tokenAddress)),
      tokenProviders(getToken(destination.chainId, destination.tokenAddress), 'asDestination')
    );
    return supported.flatMap((provider) => {
      const candidates = matchingChains('asSource', [provider]);
      return candidates.length ? [{ provider, chains: candidates }] : [];
    });
  };

  const getAvailableDestinationTokens: IntentCatalog['getAvailableDestinationTokens'] = (sources) =>
    matchingChains(
      'asDestination',
      commonSourceProviders(
        sources.map(({ chainId, tokenAddress }) => getToken(chainId, tokenAddress)),
        INTENT_PROVIDERS
      )
    );

  const confirmRouteExists: IntentCatalog['confirmRouteExists'] = (sources, destination) => {
    if (!sources.length) return false;
    const target = findToken(destination.chainId, destination.tokenAddress);
    const selected = sources.map(({ chainId, tokenAddress }) => findToken(chainId, tokenAddress));
    if (!target || !selected.every((token) => token !== undefined)) return false;
    return commonSourceProviders(selected, tokenProviders(target, 'asDestination')).length > 0;
  };

  const validateExactInput: IntentCatalog['validateExactInput'] = (sources, destination) => {
    const common = commonSourceProviders(sources, tokenProviders(destination, 'asDestination'));
    if (common.length === 0) {
      throw Errors.invalidInput(
        'No common provider supports all selected sources and the destination. Choose different sources or a destination.',
        { reasonBucket: 'unsupported_route' }
      );
    }
  };

  const getExactOutputSources: IntentCatalog['getExactOutputSources'] = (destination, selected) => {
    const supported = tokenProviders(destination, 'asDestination');
    const sources = chains.flatMap((chain) => {
      const tokens = chain.tokens.filter(
        (token) =>
          (!selected?.length ||
            selected.some(
              (source) =>
                source.chainId === chain.id &&
                (!source.tokenAddress || sameAddress(source.tokenAddress, token.address))
            )) &&
          tokenProviders(token, 'asSource').some((id) => supported.includes(id))
      );
      return tokens.length
        ? [{ chainId: chain.id, tokens: [...new Set(tokens.map((token) => token.address))] }]
        : [];
    });
    if (sources.length === 0) {
      throw Errors.invalidInput(
        'No source assets share a provider with the destination. Choose different sources or a destination.',
        { reasonBucket: 'unsupported_route' }
      );
    }
    return sources;
  };

  return {
    chains,
    getChain,
    getToken,
    getAvailableSourceTokens,
    getAvailableDestinationTokens,
    confirmRouteExists,
    validateExactInput,
    getExactOutputSources,
  };
};

const executeIntentChain = (chain: Chain): IntentChain => ({
  id: chain.id,
  name: chain.name,
  logo: chain.custom.icon,
  explorerUrl: chain.blockExplorers?.default?.url,
  rpcUrl: chain.rpcUrls.default.http[0],
  nativeCurrency: chain.nativeCurrency,
  providers: [],
  asSource: [],
  asDestination: [],
  tokens: [
    {
      chainId: chain.id,
      address: ZERO_ADDRESS,
      symbol: chain.nativeCurrency.symbol,
      name: chain.nativeCurrency.name,
      decimals: chain.nativeCurrency.decimals,
      isNative: true,
      logo: chain.nativeCurrency.logo,
      providers: [],
      asSource: [],
      asDestination: [],
    },
    ...chain.custom.knownTokens.map((token) => ({
      chainId: chain.id,
      address: token.contractAddress,
      symbol: token.symbol,
      name: token.name,
      decimals: token.decimals,
      isNative: false,
      logo: token.logo,
      providers: [],
      asSource: [],
      asDestination: [],
    })),
  ],
  capabilities: { intent: false, execute: true },
});

export const mergeSupportedChains = (
  intentChains: IntentChain[],
  executeChains: Chain[]
): IntentChain[] => {
  const merged = new Map(intentChains.map((chain) => [chain.id, chain]));
  for (const executeChain of executeChains) {
    const intentChain = merged.get(executeChain.id);
    if (intentChain) {
      merged.set(executeChain.id, {
        ...intentChain,
        capabilities: { intent: true, execute: true },
      });
    } else {
      merged.set(executeChain.id, executeIntentChain(executeChain));
    }
  }
  return [...merged.values()].sort((left, right) => left.id - right.id);
};
