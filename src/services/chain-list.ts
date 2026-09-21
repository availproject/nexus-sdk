import type { Hex } from 'viem';
import {
  type Chain,
  type ChainListType,
  PermitVariant,
  type TokenInfo,
  ZERO_ADDRESS,
} from '../domain';
import { Universe } from '../domain/chain-abstraction';
import { Errors } from '../domain/errors';
import type { IntentChainMetadata, IntentToken } from '../intent/types';
import { isNativeAddress } from './addresses';
import { equalFold } from './strings';

const nexusCurrencyId = (token?: IntentToken): number | undefined => {
  const id = token?.providers.find((provider) => provider.id === 'nexus-v2')?.currencyId;
  return typeof id === 'number' ? id : undefined;
};

const createChainList = (
  catalog: Array<IntentChainMetadata & { tokens?: IntentToken[] }>
): ChainListType => {
  const vaultByChainId = new Map<number, Hex>();

  const chains: Chain[] = catalog.flatMap((chain): Chain[] => {
    if (!chain.rpcUrl || !chain.multicallAddress) return [];
    if (chain.vaultAddress) vaultByChainId.set(chain.id, chain.vaultAddress);

    const blockExplorers = chain.explorerUrl
      ? {
          default: {
            name: `${chain.name} Explorer`,
            url: chain.explorerUrl,
          },
        }
      : undefined;

    const knownTokens: TokenInfo[] = (chain.tokens ?? [])
      .filter((token) => !token.isNative)
      .map((token) => ({
        contractAddress: token.address,
        decimals: token.decimals,
        logo: token.logo ?? '',
        name: token.name,
        symbol: token.symbol,
        permitVariant: token.permit
          ? token.permit.variant === 'emt'
            ? PermitVariant.PolygonEMT
            : PermitVariant.EIP2612Canonical
          : undefined,
        permitVersion:
          token.permit?.version &&
          /^\d+$/.test(token.permit.version) &&
          Number.isSafeInteger(Number(token.permit.version))
            ? Number(token.permit.version)
            : undefined,
        currencyId: nexusCurrencyId(token),
        mayanEnabled: token.providers.some((provider) => provider.id === 'mayan'),
      }));
    const nativeToken = chain.tokens?.find((token) => token.isNative);

    return [
      {
        blockExplorers,
        custom: {
          icon: chain.logo ?? '',
          knownTokens,
        },
        id: chain.id,
        mayanEnabled: chain.providers.includes('mayan'),
        multicallAddress: chain.multicallAddress,
        name: chain.name,
        nativeCurrency: {
          ...chain.nativeCurrency,
          logo: chain.nativeCurrency.logo ?? '',
          currencyId: nexusCurrencyId(nativeToken),
          mayanEnabled: nativeToken?.providers.some((provider) => provider.id === 'mayan'),
        },
        rpcUrls: {
          default: {
            http: [chain.rpcUrl],
            webSocket: [],
          },
        },
        supports7702: chain.eip7702Enabled,
        swapSupported: chain.swapSupported,
        universe: Universe.ETHEREUM,
      },
    ];
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
