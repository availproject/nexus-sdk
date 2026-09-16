import type { Hex } from 'viem';
import type { Chain } from '../domain';
import { ZERO_ADDRESS } from '../domain';
import { Errors } from '../domain/errors';
import type { IntentChain, IntentProvider, IntentSource, IntentToken } from './types';

export const intentNetworkEnabled = (network: string): boolean =>
  network === 'mainnet' || network === 'canary';

const sameAddress = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

export const filterIntentChains = (
  chains: IntentChain[],
  providers?: IntentProvider[]
): IntentChain[] => {
  if (!providers) return chains;
  const enabled = (id: IntentProvider) => providers.includes(id);
  return chains
    .filter((chain) => chain.providers.some(enabled))
    .map((chain) => ({
      ...chain,
      providers: chain.providers.filter(enabled),
      asSource: (chain.asSource ?? chain.providers).filter(enabled),
      asDestination: (chain.asDestination ?? chain.providers).filter(enabled),
      tokens: chain.tokens
        .filter((token) => token.providers.some(({ id }) => enabled(id)))
        .map((token) => ({
          ...token,
          providers: token.providers.filter(({ id }) => enabled(id)),
          asSource: (token.asSource ?? token.providers).filter(({ id }) => enabled(id)),
          asDestination: (token.asDestination ?? token.providers).filter(({ id }) => enabled(id)),
        })),
    }));
};

export type IntentCatalog = {
  chains: IntentChain[];
  getChain: (chainId: number) => IntentChain;
  getToken: (chainId: number, address: Hex) => IntentToken;
  validateExactInput: (
    sources: IntentToken[],
    destination: IntentToken,
    providers?: IntentProvider[]
  ) => void;
  getExactOutputSources: (
    destination: IntentToken,
    selected?: IntentSource[],
    providers?: IntentProvider[]
  ) => Array<{ chainId: number; tokens: Hex[] }>;
};

export const createIntentCatalog = (chains: IntentChain[]): IntentCatalog => {
  const chainsById = new Map(chains.map((chain) => [chain.id, chain]));
  const getChain = (chainId: number): IntentChain => {
    const chain = chainsById.get(chainId);
    if (!chain) throw Errors.chainNotFound(chainId);
    return chain;
  };

  const getToken = (chainId: number, address: Hex): IntentToken => {
    const token = getChain(chainId).tokens.find((entry) => sameAddress(entry.address, address));
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

  const destinationProviders = (destination: IntentToken, providers?: IntentProvider[]) =>
    tokenProviders(destination, 'asDestination').filter(
      (id) => !providers || providers.includes(id)
    );

  const validateExactInput: IntentCatalog['validateExactInput'] = (
    sources,
    destination,
    providers
  ) => {
    const common = sources.reduce(
      (common, source) => common.filter((id) => tokenProviders(source, 'asSource').includes(id)),
      destinationProviders(destination, providers)
    );
    if (common.length === 0) {
      throw Errors.invalidInput(
        'No common provider supports all selected sources and the destination. Choose different sources or a destination.'
      );
    }
  };

  const getExactOutputSources: IntentCatalog['getExactOutputSources'] = (
    destination,
    selected,
    providers
  ) => {
    const supported = destinationProviders(destination, providers);
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
        'No source assets share a provider with the destination. Choose different sources or a destination.'
      );
    }
    return sources;
  };

  return { chains, getChain, getToken, validateExactInput, getExactOutputSources };
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
