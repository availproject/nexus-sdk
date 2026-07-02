import type { Hex } from 'viem';
import {
  type Chain,
  type ChainListType,
  type DeploymentResponse,
  type TokenInfo,
  ZERO_ADDRESS,
} from '../domain';
import { Universe } from '../domain/chain-abstraction';
import { Errors } from '../domain/errors';
import { isNativeAddress } from './addresses';
import { equalFold } from './strings';

const universeFromV2 = (universe: DeploymentResponse['chains'][number]['universe']): Universe => {
  switch (universe) {
    case 'EVM':
      return Universe.ETHEREUM;
    case 'TRON':
      return Universe.TRON;
    case 'FUEL':
      return Universe.FUEL;
    case 'SVM':
      return Universe.SOLANA;
  }
};

const createChainList = (deployment: DeploymentResponse): ChainListType => {
  const vaultByChainId = new Map<number, Hex>();

  const chains: Chain[] = deployment.chains.map((chain) => {
    vaultByChainId.set(chain.chainId, chain.vaultAddress);

    const blockExplorers = {
      default: {
        name: `${chain.name} Explorer`,
        url: chain.explorerUrl,
      },
    };

    const knownTokens: TokenInfo[] = chain.tokens.map((token) => ({
      balanceSlot: token.balanceSlot,
      contractAddress: token.address,
      decimals: token.decimals,
      logo: token.logo,
      name: token.name,
      symbol: token.symbol,
      permitVariant: token.permitVariant,
      permitVersion: token.permitVersion,
      currencyId: token.currencyId,
      mayanEnabled: token.mayanEnabled,
    }));

    return {
      blockExplorers,
      custom: {
        icon: chain.logo,
        knownTokens,
      },
      id: chain.chainId,
      mayanEnabled: chain.mayanEnabled,
      multicallAddress: chain.multicallAddress,
      name: chain.name,
      nativeCurrency: chain.nativeCurrency,
      rpcUrls: {
        default: {
          http: [chain.rpcUrl],
          webSocket: [],
        },
      },
      supports7702: chain.supports7702,
      swapSupported: chain.swapSupported,
      universe: universeFromV2(chain.universe),
    };
  });

  const getChainByID = (id: number) => {
    const chain = chains.find((c) => c.id === id);
    if (!chain) {
      throw Errors.chainNotFound(id);
    }
    return chain;
  };

  const getNativeToken = (chainID: number): TokenInfo => {
    const chain = getChainByID(chainID);

    return {
      contractAddress: ZERO_ADDRESS,
      decimals: chain.nativeCurrency.decimals,
      logo: chain.nativeCurrency.logo,
      name: chain.nativeCurrency.name,
      symbol: chain.nativeCurrency.symbol,
      mayanEnabled: chain.nativeCurrency.mayanEnabled,
    };
  };

  const getChainAndTokenByAddress = (chainID: number, address: Hex) => {
    const chain = getChainByID(chainID);
    let token = chain.custom.knownTokens.find((t) => equalFold(t.contractAddress, address));
    let isNativeToken = false;

    if (!token) {
      if (isNativeAddress(address)) {
        isNativeToken = true;
        token = {
          contractAddress: ZERO_ADDRESS,
          decimals: chain.nativeCurrency.decimals,
          logo: chain.nativeCurrency.logo,
          name: chain.nativeCurrency.name,
          symbol: chain.nativeCurrency.symbol,
          mayanEnabled: chain.nativeCurrency.mayanEnabled,
        };
      } else {
        throw Errors.tokenNotSupported(address, chainID);
      }
    }
    return { chain, token, isNativeToken };
  };

  const getTokenByAddress = (chainID: number, address: `0x${string}`) => {
    return getChainAndTokenByAddress(chainID, address).token;
  };

  const getChainAndTokenFromSymbol = (chainID: number, tokenSymbol: string) => {
    const chain = getChainByID(chainID);
    let isNativeToken = false;
    let token = chain.custom.knownTokens.find((t) => equalFold(t.symbol, tokenSymbol));
    if (!token) {
      if (equalFold(chain.nativeCurrency.symbol, tokenSymbol)) {
        isNativeToken = true;
        token = {
          contractAddress: ZERO_ADDRESS,
          decimals: chain.nativeCurrency.decimals,
          logo: chain.nativeCurrency.logo,
          name: chain.nativeCurrency.name,
          symbol: chain.nativeCurrency.symbol,
          mayanEnabled: chain.nativeCurrency.mayanEnabled,
        };
      } else {
        throw Errors.tokenNotFound(tokenSymbol, chainID);
      }
    }
    return { chain, token, isNativeToken };
  };

  const getTokenInfoBySymbol = (chainID: number, symbol: string) => {
    return getChainAndTokenFromSymbol(chainID, symbol).token;
  };

  const getVaultContractAddress = (chainID: number) => {
    const vc = vaultByChainId.get(chainID);
    if (!vc) {
      throw Errors.vaultContractNotFound(chainID);
    }

    return vc;
  };

  const getTokenByCurrencyId = (chainID: number, currencyId: number): TokenInfo => {
    const chain = getChainByID(chainID);
    if (chain.nativeCurrency.currencyId === currencyId) {
      return getNativeToken(chainID);
    }
    const token = chain.custom.knownTokens.find((t) => t.currencyId === currencyId);
    if (!token) {
      throw new Error(`token with currency id ${currencyId} not found`);
    }

    return token;
  };

  return {
    chains,
    getChainByID,
    getNativeToken,
    getTokenByAddress,
    getChainAndTokenByAddress,
    getTokenInfoBySymbol,
    getChainAndTokenFromSymbol,
    getVaultContractAddress,
    getTokenByCurrencyId,
  };
};

export { createChainList };
