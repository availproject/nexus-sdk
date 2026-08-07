import { vi } from 'vitest';
import type { Hex } from 'viem';
import type { Chain, ChainListType, TokenInfo } from '../../src/domain';
import { Universe } from '../../src/domain/chain-abstraction';
import {
  getTestTokenByAddress,
  getUsdcToken,
  getUsdtToken,
} from './tokens';

const CurrencyID = { USDC: 1, USDT: 2, ETH: 3 } as const;

export const ARB_CHAIN = 42161;
export const BASE_CHAIN = 8453;
export const OP_CHAIN = 10;

export const makeChain = (id: number, name = `Chain ${id}`): Chain => ({
  id,
  name,
  universe: Universe.ETHEREUM,
  mayanEnabled: true,
  multicallAddress: '0x00000000000000000000000000000000000000aa',
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
    logo: '',
    currencyId: CurrencyID.ETH,
  },
  custom: { icon: '', knownTokens: [] },
  blockExplorers: { default: { name: 'explorer', url: 'https://example.com' } },
  rpcUrls: {
    default: {
      http: [`https://rpc-${id}.example.com`],
      webSocket: ['wss://rpc.example.com'],
    },
  },
});

export const makeChainList = (chains: Chain[], token: TokenInfo): ChainListType => ({
  chains,
  getVaultContractAddress: () => '0x0000000000000000000000000000000000000000',
  getTokenInfoBySymbol: () => token,
  getChainAndTokenFromSymbol: (chainID: number) => ({
    chain: chains.find((c) => c.id === chainID) ?? chains[0],
    token: { ...token, isNative: false },
    isNativeToken: false,
  }),
  getTokenByAddress: () => token,
  getChainAndTokenByAddress: (chainID: number) => ({
    chain: chains.find((c) => c.id === chainID) ?? chains[0],
    token,
    isNativeToken: false,
  }),
  getNativeToken: () => token,
  getChainByID: (id: number) => {
    const chain = chains.find((c) => c.id === id);
    if (!chain) {
      throw new Error('Chain not found');
    }
    return chain;
  },
  getTokenByCurrencyId: () => {
    throw new Error('Token not found');
  },
});

const makeSwapChain = (id: number): Chain => ({
  ...makeChain(id),
  supports7702: true,
});

export const makeSwapChainList = (): ChainListType => {
  const getChainByID = vi.fn().mockImplementation((chainId: number) => makeSwapChain(chainId));
  const getTokenByCurrencyId = vi.fn().mockImplementation((chainId: number, currencyId: number) => {
    const token = getUsdcToken(chainId);
    if (!token || token.currencyId !== currencyId) {
      throw new Error(`Token not found for currencyId=${currencyId} chainId=${chainId}`);
    }
    return { ...token, mayanEnabled: true };
  });
  const getTokenByAddress = vi
    .fn()
    .mockImplementation((chainId: number, tokenAddress: Hex) => {
      const token = getTestTokenByAddress(chainId, tokenAddress);
      return token ? { ...token, mayanEnabled: true } : token;
    });
  const getChainAndTokenByAddress = vi
    .fn()
    .mockImplementation((chainId: number, tokenAddress: Hex) => ({
      chain: getChainByID(chainId),
      token:
        getTokenByAddress(chainId, tokenAddress) ??
        ({
          contractAddress: tokenAddress,
          decimals: 18,
          logo: '',
          name: '',
          symbol: '',
        } satisfies TokenInfo),
    }));

  return {
    chains: [
      makeSwapChain(ARB_CHAIN),
      makeSwapChain(BASE_CHAIN),
      makeSwapChain(OP_CHAIN),
    ] as ChainListType['chains'],
    getVaultContractAddress: vi.fn(),
    getTokenInfoBySymbol: vi.fn(),
    getChainAndTokenFromSymbol: vi.fn() as ChainListType['getChainAndTokenFromSymbol'],
    getTokenByAddress,
    getChainAndTokenByAddress,
    getNativeToken: vi.fn(),
    getChainByID,
    getTokenByCurrencyId,
  };
};

// The default list resolves only USDC as a COT. Same-token and dynamic-COT paths use this variant
// so the USDT mesh family also resolves on destination chains.
export const makeSwapChainListWithUsdtCot = (): ChainListType => {
  const chainList = makeSwapChainList();
  chainList.getTokenByCurrencyId = vi
    .fn()
    .mockImplementation((chainId: number, currencyId: number) => {
      const token =
        currencyId === CurrencyID.USDT
          ? getUsdtToken(chainId)
          : currencyId === CurrencyID.USDC
            ? getUsdcToken(chainId)
            : undefined;
      if (!token) {
        throw new Error(`No token for currencyId=${currencyId} chainId=${chainId}`);
      }
      return token;
    });
  return chainList;
};
