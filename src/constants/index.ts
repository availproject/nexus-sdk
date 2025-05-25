export const SUPPORTED_CHAINS = {
  ETHEREUM: 1,
  BASE: 8453,
  ARBITRUM: 42161,
  OPTIMISM: 10,
  POLYGON: 137,
  AVALANCHE: 43114,
  FUEL: 122,
  LINEA: 59144,
  SCROLL: 534351,
} as const;

export const chainIcons: Record<number, string> = {
  [SUPPORTED_CHAINS.ETHEREUM]: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
  [SUPPORTED_CHAINS.BASE]:
    'https://raw.githubusercontent.com/base/brand-kit/main/logo/symbol/Base_Symbol_Blue.svg',
  [SUPPORTED_CHAINS.ARBITRUM]:
    'https://assets.coingecko.com/coins/images/16547/small/photo_2023-03-29_21.47.00.jpeg',
  [SUPPORTED_CHAINS.OPTIMISM]: 'https://assets.coingecko.com/coins/images/25244/small/Optimism.png',
  [SUPPORTED_CHAINS.POLYGON]: 'https://assets.coingecko.com/coins/images/4713/small/polygon.png',
  [SUPPORTED_CHAINS.AVALANCHE]:
    'https://assets.coingecko.com/coins/images/12559/small/Avalanche_Circle_RedWhite_Trans.png',
  [SUPPORTED_CHAINS.LINEA]:
    'https://assets.coingecko.com/asset_platforms/images/135/small/linea.jpeg?1706606705',
  [SUPPORTED_CHAINS.SCROLL]:
    'https://assets.coingecko.com/coins/images/50571/standard/scroll.jpg?1728376125',
} as const;

export const AVAILABLE_TOKENS = [
  {
    symbol: 'ETH',
    icon: 'https://coin-images.coingecko.com/coins/images/279/large/ethereum.png?1696501628',
  },
  {
    symbol: 'USDT',
    icon: 'https://coin-images.coingecko.com/coins/images/35023/large/USDT.png',
  },
  {
    symbol: 'USDC',
    icon: 'https://coin-images.coingecko.com/coins/images/6319/large/usdc.png?1696506694',
  },
];
