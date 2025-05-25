import { ChainMetadata, TokenMetadata } from '../types';

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

export const TOKEN_METADATA: Record<string, TokenMetadata> = {
  ETH: {
    symbol: 'ETH',
    name: 'Ethereum',
    decimals: 18,
    icon: 'https://coin-images.coingecko.com/coins/images/279/large/ethereum.png?1696501628',
    coingeckoId: 'ethereum',
    isNative: true,
  },
  USDT: {
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
    icon: 'https://coin-images.coingecko.com/coins/images/35023/large/USDT.png',
    coingeckoId: 'tether',
  },
  USDC: {
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    icon: 'https://coin-images.coingecko.com/coins/images/6319/large/usdc.png?1696506694',
    coingeckoId: 'usd-coin',
  },
} as const;

export const CHAIN_METADATA: Record<number, ChainMetadata> = {
  [SUPPORTED_CHAINS.ETHEREUM]: {
    id: 1,
    name: 'Ethereum',
    shortName: 'eth',
    logo: chainIcons[SUPPORTED_CHAINS.ETHEREUM],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://eth.merkle.io'],
    blockExplorerUrls: ['https://etherscan.io'],
  },
  [SUPPORTED_CHAINS.BASE]: {
    id: 8453,
    name: 'Base',
    shortName: 'base',
    logo: chainIcons[SUPPORTED_CHAINS.BASE],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://mainnet.base.org'],
    blockExplorerUrls: ['https://basescan.org'],
  },
  [SUPPORTED_CHAINS.ARBITRUM]: {
    id: 42161,
    name: 'Arbitrum One',
    shortName: 'arb1',
    logo: chainIcons[SUPPORTED_CHAINS.ARBITRUM],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://arb1.arbitrum.io/rpc'],
    blockExplorerUrls: ['https://arbiscan.io'],
  },
  [SUPPORTED_CHAINS.OPTIMISM]: {
    id: 10,
    name: 'Optimism',
    shortName: 'oeth',
    logo: chainIcons[SUPPORTED_CHAINS.OPTIMISM],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://mainnet.optimism.io'],
    blockExplorerUrls: ['https://optimistic.etherscan.io'],
  },
  [SUPPORTED_CHAINS.POLYGON]: {
    id: 137,
    name: 'Polygon',
    shortName: 'matic',
    logo: chainIcons[SUPPORTED_CHAINS.POLYGON],
    nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
    rpcUrls: ['https://polygon-rpc.com'],
    blockExplorerUrls: ['https://polygonscan.com'],
  },
  [SUPPORTED_CHAINS.AVALANCHE]: {
    id: 43114,
    name: 'Avalanche',
    shortName: 'avax',
    logo: chainIcons[SUPPORTED_CHAINS.AVALANCHE],
    nativeCurrency: { name: 'Avalanche', symbol: 'AVAX', decimals: 18 },
    rpcUrls: ['https://api.avax.network/ext/bc/C/rpc'],
    blockExplorerUrls: ['https://snowtrace.io'],
  },
  [SUPPORTED_CHAINS.LINEA]: {
    id: 59144,
    name: 'Linea',
    shortName: 'linea',
    logo: chainIcons[SUPPORTED_CHAINS.LINEA],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://rpc.linea.build'],
    blockExplorerUrls: ['https://lineascan.build'],
  },
  [SUPPORTED_CHAINS.SCROLL]: {
    id: 534351,
    name: 'Scroll',
    shortName: 'scroll',
    logo: chainIcons[SUPPORTED_CHAINS.SCROLL],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://rpc.scroll.io'],
    blockExplorerUrls: ['https://scrollscan.com'],
  },
} as const;

// Event name constants to prevent typos
export const NEXUS_EVENTS = {
  EXPECTED_STEPS: 'expected_steps',
  STEP_COMPLETE: 'step_complete',
  ACCOUNTS_CHANGED: 'accountsChanged',
  CHAIN_CHANGED: 'chainChanged',
} as const;

// Legacy AVAILABLE_TOKENS for backward compatibility
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
