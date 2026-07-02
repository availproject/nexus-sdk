import type { Chain, ChainListType, TokenInfo } from '../../src/domain';
import { Universe } from '../../src/domain/chain-abstraction';

export const makeChain = (id: number, name: string): Chain => ({
  id,
  name,
  universe: Universe.ETHEREUM,
  mayanEnabled: true,
  multicallAddress: '0x00000000000000000000000000000000000000aa',
  nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH', logo: '' },
  custom: { icon: '', knownTokens: [] },
  blockExplorers: { default: { name: 'explorer', url: 'https://example.com' } },
  rpcUrls: { default: { http: ['https://rpc.example.com'], webSocket: ['wss://rpc.example.com'] } },
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
    isNativeToken: false
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
