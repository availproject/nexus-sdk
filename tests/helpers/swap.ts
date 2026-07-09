import { vi } from 'vitest';
import type { Hex } from 'viem';
import type { ChainListType, TokenInfo } from '../../src/domain';
import type { QuoteResponse as BridgeQuoteResponse } from '../../src/transport';
import { Universe } from '../../src/domain/chain-abstraction';
import type { Aggregator } from '../../src/swap/aggregators/types';
import type { SwapPreflight } from '../../src/swap/preflight';
import { CurrencyID } from '../../src/swap/cot';
import type { OraclePriceResponse, PublicClientList, WalletPath } from '../../src/swap/types';

export const ARB_CHAIN = 42161;
export const BASE_CHAIN = 8453;
export const OP_CHAIN = 10;

export const USDC_ARB = '0xaf88d065e77c8cc2239327c5edb3a432268e5831' as Hex;
export const USDC_BASE = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' as Hex;
export const USDC_OP = '0x0b2c639c533813f4aa9d7837caf62653d097ff85' as Hex;
export const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' as Hex;
export const DAI = '0xDAI000000000000000000000000000000000000' as Hex;
// USDT — a non-COT bridgeable mesh token (currencyId=USDT) across chains, for same-token bridge tests.
export const USDT_ARB = '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9' as Hex;
export const USDT_OP = '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58' as Hex;
export const USDT_BASE = '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2' as Hex;
export const EPHEMERAL_EXECUTOR = '0xbbbb000000000000000000000000000000000002' as Hex;

const TOKENS_BY_CHAIN = new Map<number, TokenInfo>([
  [
    ARB_CHAIN,
    {
      contractAddress: USDC_ARB,
      decimals: 6,
      logo: '',
      name: 'USD Coin',
      symbol: 'USDC',
      currencyId: CurrencyID.USDC,
      permitVariant: 2,
      permitVersion: 1,
    },
  ],
  [
    BASE_CHAIN,
    {
      contractAddress: USDC_BASE,
      decimals: 6,
      logo: '',
      name: 'USD Coin',
      symbol: 'USDC',
      currencyId: CurrencyID.USDC,
      permitVariant: 2,
      permitVersion: 1,
    },
  ],
  [
    OP_CHAIN,
    {
      contractAddress: USDC_OP,
      decimals: 6,
      logo: '',
      name: 'USD Coin',
      symbol: 'USDC',
      currencyId: CurrencyID.USDC,
      permitVariant: 2,
      permitVersion: 1,
    },
  ],
]);

const TOKENS_BY_ADDRESS = new Map<string, TokenInfo>([
  [USDC_ARB.toLowerCase(), TOKENS_BY_CHAIN.get(ARB_CHAIN)!],
  [USDC_BASE.toLowerCase(), TOKENS_BY_CHAIN.get(BASE_CHAIN)!],
  [USDC_OP.toLowerCase(), TOKENS_BY_CHAIN.get(OP_CHAIN)!],
  [
    WETH.toLowerCase(),
    {
      contractAddress: WETH,
      decimals: 18,
      logo: '',
      name: 'Wrapped Ether',
      symbol: 'WETH',
    },
  ],
  [
    DAI.toLowerCase(),
    {
      contractAddress: DAI,
      decimals: 18,
      logo: '',
      name: 'Dai Stablecoin',
      symbol: 'DAI',
      permitVariant: 2,
      permitVersion: 1,
    },
  ],
  ...([
    [USDT_ARB, ARB_CHAIN],
    [USDT_OP, OP_CHAIN],
    [USDT_BASE, BASE_CHAIN],
  ] as const).map(
    ([address]) =>
      [
        address.toLowerCase(),
        {
          contractAddress: address,
          decimals: 6,
          logo: '',
          name: 'Tether USD',
          symbol: 'USDT',
          currencyId: CurrencyID.USDT,
          permitVariant: 2,
          permitVersion: 1,
        },
      ] as const
  ),
]);

const makeChain = (id: number) => ({
  id,
  name: `Chain ${id}`,
  multicallAddress: '0x00000000000000000000000000000000000000aa',
  rpcUrls: { default: { http: [`https://rpc-${id}.example.com`], webSocket: [] } },
  nativeCurrency: { decimals: 18, symbol: 'ETH', name: 'Ether', logo: '', currencyId: CurrencyID.ETH },
  custom: { icon: '', knownTokens: [] },
  supports7702: true,
  blockExplorers: { default: { name: 'explorer', url: 'https://example.com' } },
  universe: Universe.ETHEREUM,
  mayanEnabled: true,
});

export const makeSwapChainList = (): ChainListType => {
  const getChainByID = vi.fn().mockImplementation((chainId: number) => makeChain(chainId));
  const getTokenByCurrencyId = vi.fn().mockImplementation((chainId: number, currencyId: number) => {
    const token = TOKENS_BY_CHAIN.get(chainId);
    if (!token || token.currencyId !== currencyId) {
      throw new Error(`Token not found for currencyId=${currencyId} chainId=${chainId}`);
    }
    return { ...token, mayanEnabled: true };
  });
  const getTokenByAddress = vi
    .fn()
    .mockImplementation((chainId: number, tokenAddress: Hex) => {
      const token = TOKENS_BY_CHAIN.get(chainId);
      if (token && token.contractAddress.toLowerCase() === tokenAddress.toLowerCase()) {
        return { ...token, mayanEnabled: true };
      }
      const byAddress = TOKENS_BY_ADDRESS.get(tokenAddress.toLowerCase());
      return byAddress ? { ...byAddress, mayanEnabled: true } : byAddress;
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
    chains: [makeChain(ARB_CHAIN), makeChain(BASE_CHAIN), makeChain(OP_CHAIN)] as ChainListType['chains'],
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

// The default chainList only resolves USDC via getTokenByCurrencyId (so USDT/ETH don't resolve as a
// COT — keeping the B2 negative case honest). The same-token / dynamic-COT fast paths need the USDT
// mesh family to resolve as a COT on the dst chain, so this variant resolves USDT too.
export const makeSwapChainListWithUsdtCot = (): ChainListType => {
  const chainList = makeSwapChainList();
  const usdtByChain: Record<number, Hex> = {
    [ARB_CHAIN]: USDT_ARB,
    [OP_CHAIN]: USDT_OP,
    [BASE_CHAIN]: USDT_BASE,
  };
  const usdcByChain: Record<number, Hex> = {
    [ARB_CHAIN]: USDC_ARB,
    [OP_CHAIN]: USDC_OP,
    [BASE_CHAIN]: USDC_BASE,
  };
  chainList.getTokenByCurrencyId = vi
    .fn()
    .mockImplementation((chainId: number, currencyId: number) => {
      if (currencyId === CurrencyID.USDT && usdtByChain[chainId]) {
        return { contractAddress: usdtByChain[chainId], decimals: 6, symbol: 'USDT', name: 'Tether USD', logo: '', currencyId: CurrencyID.USDT, permitVariant: 2, permitVersion: 1 };
      }
      if (currencyId === CurrencyID.USDC && usdcByChain[chainId]) {
        return { contractAddress: usdcByChain[chainId], decimals: 6, symbol: 'USDC', name: 'USD Coin', logo: '', currencyId: CurrencyID.USDC, permitVariant: 2, permitVersion: 1 };
      }
      throw new Error(`No token for currencyId=${currencyId} chainId=${chainId}`);
    });
  return chainList;
};

export const makeDstTokenInfo = (overrides?: Partial<TokenInfo>): TokenInfo => ({
  contractAddress: WETH,
  decimals: 18,
  symbol: 'WETH',
  name: 'Wrapped Ether',
  logo: '',
  ...overrides,
});

export const makePublicClientList = (): PublicClientList =>
  ({
    get: vi.fn().mockReturnValue({
      getCode: vi.fn().mockResolvedValue(undefined),
      multicall: vi.fn().mockResolvedValue([]),
      readContract: vi.fn(),
    }),
  }) as unknown as PublicClientList;

export const makeSwapPreflight = (
  overrides?: Partial<SwapPreflight> & { walletPathHints?: Map<number, WalletPath> }
): SwapPreflight => ({
  aggregators: ([] as Aggregator[]),
  balances: [],
  bridgeQuoteResponse: null as BridgeQuoteResponse | null,
  dstTokenInfo: makeDstTokenInfo(),
  oraclePrices: [] as OraclePriceResponse,
  publicClientList: makePublicClientList(),
  walletPathHints:
    overrides?.walletPathHints ??
    new Map<number, WalletPath>([
      [ARB_CHAIN, 'ephemeral'],
      [BASE_CHAIN, 'ephemeral'],
      [OP_CHAIN, 'ephemeral'],
    ]),
  ...overrides,
});
