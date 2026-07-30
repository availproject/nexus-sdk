import type { Hex } from 'viem';
import type { TokenInfo } from '../../src/domain';
import { CurrencyID } from '../../src/swap/cot';

export const USDC_ARB = '0xaf88d065e77c8cc2239327c5edb3a432268e5831' as Hex;
export const USDC_BASE = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' as Hex;
export const USDC_OP = '0x0b2c639c533813f4aa9d7837caf62653d097ff85' as Hex;
export const USDT_ARB = '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9' as Hex;
export const USDT_BASE = '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2' as Hex;
export const USDT_OP = '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58' as Hex;
export const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' as Hex;
export const DAI = '0xDAI000000000000000000000000000000000000' as Hex;
export const DAI_ARB = '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1' as Hex;
export const EPHEMERAL_EXECUTOR = '0xbbbb000000000000000000000000000000000002' as Hex;

const makeUsdcToken = (contractAddress: Hex): TokenInfo => ({
  contractAddress,
  decimals: 6,
  logo: '',
  name: 'USD Coin',
  symbol: 'USDC',
  currencyId: CurrencyID.USDC,
  permitVariant: 2,
  permitVersion: 1,
});

const makeUsdtToken = (contractAddress: Hex): TokenInfo => ({
  contractAddress,
  decimals: 6,
  logo: '',
  name: 'Tether USD',
  symbol: 'USDT',
  currencyId: CurrencyID.USDT,
  permitVariant: 2,
  permitVersion: 1,
});

const USDC_BY_CHAIN = new Map<number, TokenInfo>([
  [42161, makeUsdcToken(USDC_ARB)],
  [8453, makeUsdcToken(USDC_BASE)],
  [10, makeUsdcToken(USDC_OP)],
]);

const USDT_BY_CHAIN = new Map<number, TokenInfo>([
  [42161, makeUsdtToken(USDT_ARB)],
  [8453, makeUsdtToken(USDT_BASE)],
  [10, makeUsdtToken(USDT_OP)],
]);

const TOKENS_BY_ADDRESS = new Map<string, TokenInfo>([
  ...[...USDC_BY_CHAIN.values()].map((token) => [
    token.contractAddress.toLowerCase(),
    token,
  ] as const),
  ...[...USDT_BY_CHAIN.values()].map((token) => [
    token.contractAddress.toLowerCase(),
    token,
  ] as const),
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
]);

export const getUsdcToken = (chainId: number): TokenInfo | undefined => {
  const token = USDC_BY_CHAIN.get(chainId);
  return token ? { ...token } : undefined;
};

export const getUsdtToken = (chainId: number): TokenInfo | undefined => {
  const token = USDT_BY_CHAIN.get(chainId);
  return token ? { ...token } : undefined;
};

export const getTestTokenByAddress = (
  chainId: number,
  tokenAddress: Hex
): TokenInfo | undefined => {
  const usdc = USDC_BY_CHAIN.get(chainId);
  if (usdc?.contractAddress.toLowerCase() === tokenAddress.toLowerCase()) {
    return { ...usdc };
  }

  const token = TOKENS_BY_ADDRESS.get(tokenAddress.toLowerCase());
  return token ? { ...token } : undefined;
};

export const makeDstTokenInfo = (overrides?: Partial<TokenInfo>): TokenInfo => ({
  contractAddress: WETH,
  decimals: 18,
  symbol: 'WETH',
  name: 'Wrapped Ether',
  logo: '',
  ...overrides,
});
