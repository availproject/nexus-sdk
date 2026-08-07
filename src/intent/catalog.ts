import type { Hex } from 'viem';
import type { Chain } from '../domain';
import { ZERO_ADDRESS } from '../domain';
import { Errors } from '../domain/errors';
import type {
  IntentChain,
  IntentQuoteRequest,
  IntentToken,
  IntentTokenCatalogEntry,
} from './types';

export const intentNetworkEnabled = (network: string): boolean =>
  network === 'mainnet' || network === 'canary';

const sameAddress = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

export type IntentCatalog = {
  chains: IntentChain[];
  tokens: IntentTokenCatalogEntry[];
  getChain: (chainId: number) => IntentChain;
  getToken: (chainId: number, address: Hex) => IntentToken;
  getTokenBySymbol: (chainId: number, symbol: string) => IntentToken;
  bridgeSources: (
    destinationChainId: number,
    destinationToken: Hex,
    sourceChainIds?: number[]
  ) => NonNullable<IntentQuoteRequest['sources']>;
};

export const createIntentCatalog = (
  chains: IntentChain[],
  tokens: IntentTokenCatalogEntry[]
): IntentCatalog => {
  const getChain = (chainId: number): IntentChain => {
    const chain = chains.find((entry) => entry.id === chainId);
    if (!chain) throw Errors.chainNotFound(chainId);
    return chain;
  };

  const getToken = (chainId: number, address: Hex): IntentToken => {
    const token = getChain(chainId).tokens.find((entry) => sameAddress(entry.address, address));
    if (!token) throw Errors.tokenNotSupported(address, chainId);
    return token;
  };

  const getTokenBySymbol = (chainId: number, symbol: string): IntentToken => {
    const token = getChain(chainId).tokens.find(
      (entry) => entry.symbol.toLowerCase() === symbol.toLowerCase()
    );
    if (!token) throw Errors.tokenNotFound(symbol, chainId);
    return token;
  };

  const bridgeSources = (
    destinationChainId: number,
    destinationToken: Hex,
    sourceChainIds?: number[]
  ): NonNullable<IntentQuoteRequest['sources']> => {
    const asset = tokens.find((entry) =>
      entry.chains.some(
        (deployment) =>
          deployment.chainId === destinationChainId &&
          sameAddress(deployment.address, destinationToken)
      )
    );
    if (!asset) throw Errors.tokenNotSupported(destinationToken, destinationChainId);

    const selected = sourceChainIds ?? asset.chains.map((entry) => entry.chainId);
    return selected
      .filter((chainId) => chainId !== destinationChainId)
      .map((chainId) => {
        const deployment = asset.chains.find((entry) => entry.chainId === chainId);
        if (!deployment) {
          throw Errors.invalidInput(`${asset.symbol} is not available on source chain ${chainId}`);
        }
        return { chainId: `EVM_${chainId}`, tokens: [deployment.address] };
      });
  };

  return { chains, tokens, getChain, getToken, getTokenBySymbol, bridgeSources };
};

const executeIntentChain = (chain: Chain): IntentChain => ({
  id: chain.id,
  name: chain.name,
  logo: chain.custom.icon,
  explorerUrl: chain.blockExplorers?.default?.url,
  rpcUrl: chain.rpcUrls.default.http[0],
  nativeCurrency: chain.nativeCurrency,
  providers: [],
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
