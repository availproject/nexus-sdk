import type { Hex } from 'viem';
import type { Chain } from '../domain';
import { ZERO_ADDRESS } from '../domain';
import { Errors } from '../domain/errors';
import type { IntentChain, IntentToken } from './types';

export const intentNetworkEnabled = (network: string): boolean =>
  network === 'mainnet' || network === 'canary';

const sameAddress = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

export type IntentCatalog = {
  chains: IntentChain[];
  getChain: (chainId: number) => IntentChain;
  getToken: (chainId: number, address: Hex) => IntentToken;
};

export const createIntentCatalog = (chains: IntentChain[]): IntentCatalog => {
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

  return { chains, getChain, getToken };
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
