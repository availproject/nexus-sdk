import type { Hex } from 'viem';
import type { Chain } from '../domain';
import { Errors, NexusError } from '../domain/errors';
import {
  INTENT_PROVIDERS,
  type IntentChain,
  type IntentChainMetadata,
  type IntentDestinationTokenPage,
  type IntentProvider,
  type IntentSource,
  type IntentSourceTokenPage,
  type IntentToken,
  type IntentTokenPage,
  type IntentTokenQuery,
  type TokenRef,
} from './types';

export const intentNetworkEnabled = (network: string): boolean =>
  network === 'mainnet' || network === 'canary';

const sameAddress = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
const tokenKey = (chainId: number, address: Hex) => `${chainId}:${address.toLowerCase()}`;

const remember = <T>(cache: Map<string, T>, key: string, value: T, limit: number) => {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > limit) cache.delete(cache.keys().next().value as string);
  return value;
};

export const createIntentCatalog = (
  entries: Array<IntentChainMetadata & { tokens?: IntentToken[] }>,
  fetchTokens: (query: IntentTokenQuery) => Promise<IntentTokenPage>
) => {
  const chains = entries.map(({ tokens: _tokens, ...chain }) => chain);
  const chainsById = new Map(chains.map((chain) => [chain.id, chain]));
  const pages = new Map<string, Promise<IntentTokenPage>>();
  const tokens = new Map<string, IntentToken>();
  const getChain = (chainId: number): IntentChainMetadata => {
    const chain = chainsById.get(chainId);
    if (!chain) throw Errors.chainNotFound(chainId);
    return chain;
  };

  const getTokens = (query: IntentTokenQuery = {}): Promise<IntentTokenPage> => {
    if (query.chainId !== undefined) getChain(query.chainId);
    const normalized = {
      chainId: query.chainId,
      providers: query.providers?.length ? [...new Set(query.providers)].sort() : undefined,
      name: query.name?.toLowerCase(),
      symbol: query.symbol?.toLowerCase(),
      contract: query.contract?.toLowerCase(),
      offset: query.offset ?? 0,
      limit: query.limit ?? 50,
    };
    const key = JSON.stringify(normalized);
    const cached = pages.get(key);
    if (cached) return cached;
    const pending = fetchTokens(normalized)
      .then((page) => {
        for (const token of page.tokens) {
          if (
            !chainsById.has(token.chainId) ||
            (query.chainId !== undefined && token.chainId !== query.chainId)
          ) {
            throw Errors.backend('Token response contains an unexpected chain', {
              service: 'middleware',
            });
          }
          // Provider-filtered responses omit support needed by unrestricted route checks.
          if (!normalized.providers)
            remember(tokens, tokenKey(token.chainId, token.address), token, 1000);
        }
        return page;
      })
      .catch((error: unknown) => {
        if (pages.get(key) === pending) pages.delete(key);
        throw error;
      });
    return remember(pages, key, pending, 100);
  };

  const getToken = async (chainId: number, address: Hex): Promise<IntentToken> => {
    getChain(chainId);
    const cached = tokens.get(tokenKey(chainId, address));
    if (cached) return cached;
    const page = await getTokens({ chainId, contract: address, limit: 1 });
    const token = page.tokens.find(
      (entry) => entry.chainId === chainId && sameAddress(entry.address, address)
    );
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

  const resolveTokens = (refs: TokenRef[]) =>
    Promise.all(refs.map(({ chainId, tokenAddress }) => getToken(chainId, tokenAddress)));

  const candidatePage = async (
    providers: IntentProvider[],
    query: IntentTokenQuery
  ): Promise<IntentTokenPage> => {
    const enabled = providers.filter(
      (id) => !query.providers?.length || query.providers.includes(id)
    );
    if (!enabled.length)
      return { tokens: [], total: 0, offset: query.offset ?? 0, limit: query.limit ?? 50 };
    return getTokens({ ...query, providers: enabled });
  };

  const matchingChains = (
    page: IntentTokenPage,
    role: 'asSource' | 'asDestination',
    providers: IntentProvider[]
  ): IntentChain[] => {
    const grouped = new Map<number, IntentChain>();
    for (const token of page.tokens) {
      if (!tokenProviders(token, role).some((id) => providers.includes(id))) continue;
      let chain = grouped.get(token.chainId);
      if (!chain) {
        chain = { ...getChain(token.chainId), tokens: [] };
        grouped.set(chain.id, chain);
      }
      chain.tokens.push(token);
    }
    return [...grouped.values()];
  };

  const getAvailableSourceTokens = async (
    destination: TokenRef,
    selectedSources: TokenRef[] = [],
    query: IntentTokenQuery = {}
  ): Promise<IntentSourceTokenPage> => {
    const [target, selected] = await Promise.all([
      getToken(destination.chainId, destination.tokenAddress),
      resolveTokens(selectedSources),
    ]);
    const supported = commonSourceProviders(selected, tokenProviders(target, 'asDestination'));
    const page = await candidatePage(supported, query);
    const { tokens: _tokens, ...pagination } = page;
    return {
      ...pagination,
      groups: supported.flatMap((provider) => {
        const candidates = matchingChains(page, 'asSource', [provider]);
        return candidates.length ? [{ provider, chains: candidates }] : [];
      }),
    };
  };

  const getAvailableDestinationTokens = async (
    sources: TokenRef[],
    query: IntentTokenQuery = {}
  ): Promise<IntentDestinationTokenPage> => {
    const supported = commonSourceProviders(await resolveTokens(sources), INTENT_PROVIDERS);
    const page = await candidatePage(supported, query);
    const { tokens: _tokens, ...pagination } = page;
    return { ...pagination, chains: matchingChains(page, 'asDestination', supported) };
  };

  const confirmRouteExists = async (
    sources: TokenRef[],
    destination: TokenRef
  ): Promise<boolean> => {
    if (!sources.length) return false;
    try {
      const [target, selected] = await Promise.all([
        getToken(destination.chainId, destination.tokenAddress),
        resolveTokens(sources),
      ]);
      return commonSourceProviders(selected, tokenProviders(target, 'asDestination')).length > 0;
    } catch (error) {
      if (
        error instanceof NexusError &&
        (error.code === 'validation/chain_not_found' ||
          error.code === 'validation/token_not_supported')
      )
        return false;
      throw error;
    }
  };

  const validateExactInput = (sources: IntentToken[], destination: IntentToken) => {
    if (!commonSourceProviders(sources, tokenProviders(destination, 'asDestination')).length) {
      throw Errors.invalidInput(
        'No common provider supports all selected sources and the destination. Choose different sources or a destination.',
        { reasonBucket: 'unsupported_route' }
      );
    }
  };

  const getExactOutputSources = async (destination: IntentToken, selected?: IntentSource[]) => {
    const supported = tokenProviders(destination, 'asDestination');
    if (!supported.length) {
      throw Errors.invalidInput('No provider supports the destination.', {
        reasonBucket: 'unsupported_route',
      });
    }
    if (!selected?.length) return undefined;
    const grouped = new Map<number, { chainId: number; tokens?: Hex[] }>();
    const candidates = await Promise.all(
      selected.map(async (source) => {
        const chain = getChain(source.chainId);
        const providers = source.tokenAddress
          ? tokenProviders(await getToken(source.chainId, source.tokenAddress), 'asSource')
          : (chain.asSource ?? chain.providers);
        return { source, chain, providers };
      })
    );
    for (const { source, chain, providers } of candidates) {
      if (!providers.some((id) => supported.includes(id))) continue;
      const previous = grouped.get(chain.id);
      if (!source.tokenAddress) grouped.set(chain.id, { chainId: chain.id });
      else if (!previous)
        grouped.set(chain.id, { chainId: chain.id, tokens: [source.tokenAddress] });
      else if (
        previous.tokens &&
        !previous.tokens.some((address) => sameAddress(address, source.tokenAddress as Hex))
      )
        previous.tokens.push(source.tokenAddress);
    }
    if (!grouped.size) {
      throw Errors.invalidInput(
        'No source assets share a provider with the destination. Choose different sources or a destination.',
        { reasonBucket: 'unsupported_route' }
      );
    }
    return [...grouped.values()];
  };

  return {
    chains,
    getChain,
    getTokens,
    getToken,
    getAvailableSourceTokens,
    getAvailableDestinationTokens,
    confirmRouteExists,
    validateExactInput,
    getExactOutputSources,
  };
};

export type IntentCatalog = ReturnType<typeof createIntentCatalog>;

export const mergeSupportedChains = (
  intentChains: IntentChainMetadata[],
  executeChains: Chain[]
): IntentChainMetadata[] => {
  const merged = new Map(intentChains.map((chain) => [chain.id, chain]));
  for (const chain of executeChains) {
    const intent = merged.get(chain.id);
    merged.set(
      chain.id,
      intent
        ? { ...intent, capabilities: { intent: true, execute: true } }
        : {
            id: chain.id,
            name: chain.name,
            logo: chain.custom.icon,
            explorerUrl: chain.blockExplorers?.default?.url,
            rpcUrl: chain.rpcUrls.default.http[0],
            nativeCurrency: chain.nativeCurrency,
            providers: [],
            asSource: [],
            asDestination: [],
            capabilities: { intent: false, execute: true },
          }
    );
  }
  return [...merged.values()].sort((left, right) => left.id - right.id);
};
