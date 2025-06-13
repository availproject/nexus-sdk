import { ChainMetadata, TokenMetadata } from '../types';

export const SUPPORTED_CHAINS = {
  // Mainnet chains
  ETHEREUM: 1,
  BASE: 8453,
  ARBITRUM: 42161,
  OPTIMISM: 10,
  POLYGON: 137,
  AVALANCHE: 43114,
  LINEA: 59144,
  SCROLL: 534351,

  // Testnet chains
  ETHEREUM_SEPOLIA: 11155111,
  BASE_SEPOLIA: 84532,
  ARBITRUM_SEPOLIA: 421614,
  OPTIMISM_SEPOLIA: 11155420,
  POLYGON_AMOY: 80002,
  AVALANCHE_FUJI: 43113,
  LINEA_SEPOLIA: 59141,
  SCROLL_SEPOLIA: 534352,
} as const;

export const chainIcons: Record<number, string> = {
  // Mainnet chain icons
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

  // Testnet chain icons (reuse mainnet icons)
  [SUPPORTED_CHAINS.ETHEREUM_SEPOLIA]:
    'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
  [SUPPORTED_CHAINS.BASE_SEPOLIA]:
    'https://raw.githubusercontent.com/base/brand-kit/main/logo/symbol/Base_Symbol_Blue.svg',
  [SUPPORTED_CHAINS.ARBITRUM_SEPOLIA]:
    'https://assets.coingecko.com/coins/images/16547/small/photo_2023-03-29_21.47.00.jpeg',
  [SUPPORTED_CHAINS.OPTIMISM_SEPOLIA]:
    'https://assets.coingecko.com/coins/images/25244/small/Optimism.png',
  [SUPPORTED_CHAINS.POLYGON_AMOY]:
    'https://assets.coingecko.com/coins/images/4713/small/polygon.png',
  [SUPPORTED_CHAINS.AVALANCHE_FUJI]:
    'https://assets.coingecko.com/coins/images/12559/small/Avalanche_Circle_RedWhite_Trans.png',
  [SUPPORTED_CHAINS.LINEA_SEPOLIA]:
    'https://assets.coingecko.com/asset_platforms/images/135/small/linea.jpeg?1706606705',
  [SUPPORTED_CHAINS.SCROLL_SEPOLIA]:
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

// Testnet token metadata
export const TESTNET_TOKEN_METADATA: Record<string, TokenMetadata> = {
  ETH: {
    symbol: 'ETH',
    name: 'Test Ethereum',
    decimals: 18,
    icon: 'https://coin-images.coingecko.com/coins/images/279/large/ethereum.png?1696501628',
    coingeckoId: 'ethereum',
    isNative: true,
  },
  USDT: {
    symbol: 'USDT',
    name: 'Test Tether USD',
    decimals: 6,
    icon: 'https://coin-images.coingecko.com/coins/images/35023/large/USDT.png',
    coingeckoId: 'tether',
  },
  USDC: {
    symbol: 'USDC',
    name: 'Test USD Coin',
    decimals: 6,
    icon: 'https://coin-images.coingecko.com/coins/images/6319/large/usdc.png?1696506694',
    coingeckoId: 'usd-coin',
  },
} as const;

export const CHAIN_METADATA: Record<number, ChainMetadata> = {
  // Mainnet chains
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

  // Testnet chains
  [SUPPORTED_CHAINS.ETHEREUM_SEPOLIA]: {
    id: 11155111,
    name: 'Ethereum Sepolia',
    shortName: 'sepolia',
    logo: chainIcons[SUPPORTED_CHAINS.ETHEREUM_SEPOLIA],
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://rpc.sepolia.org', 'https://ethereum-sepolia.publicnode.com'],
    blockExplorerUrls: ['https://sepolia.etherscan.io'],
  },
  [SUPPORTED_CHAINS.BASE_SEPOLIA]: {
    id: 84532,
    name: 'Base Sepolia',
    shortName: 'base-sepolia',
    logo: chainIcons[SUPPORTED_CHAINS.BASE_SEPOLIA],
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://sepolia.base.org'],
    blockExplorerUrls: ['https://sepolia.basescan.org'],
  },
  [SUPPORTED_CHAINS.ARBITRUM_SEPOLIA]: {
    id: 421614,
    name: 'Arbitrum Sepolia',
    shortName: 'arb-sepolia',
    logo: chainIcons[SUPPORTED_CHAINS.ARBITRUM_SEPOLIA],
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://sepolia-rollup.arbitrum.io/rpc'],
    blockExplorerUrls: ['https://sepolia.arbiscan.io'],
  },
  [SUPPORTED_CHAINS.OPTIMISM_SEPOLIA]: {
    id: 11155420,
    name: 'Optimism Sepolia',
    shortName: 'op-sepolia',
    logo: chainIcons[SUPPORTED_CHAINS.OPTIMISM_SEPOLIA],
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://sepolia.optimism.io'],
    blockExplorerUrls: ['https://sepolia-optimism.etherscan.io'],
  },
  [SUPPORTED_CHAINS.POLYGON_AMOY]: {
    id: 80002,
    name: 'Polygon Amoy',
    shortName: 'amoy',
    logo: chainIcons[SUPPORTED_CHAINS.POLYGON_AMOY],
    nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
    rpcUrls: ['https://rpc-amoy.polygon.technology'],
    blockExplorerUrls: ['https://amoy.polygonscan.com'],
  },
  [SUPPORTED_CHAINS.AVALANCHE_FUJI]: {
    id: 43113,
    name: 'Avalanche Fuji',
    shortName: 'fuji',
    logo: chainIcons[SUPPORTED_CHAINS.AVALANCHE_FUJI],
    nativeCurrency: { name: 'Avalanche', symbol: 'AVAX', decimals: 18 },
    rpcUrls: ['https://api.avax-test.network/ext/bc/C/rpc'],
    blockExplorerUrls: ['https://testnet.snowtrace.io'],
  },
  [SUPPORTED_CHAINS.LINEA_SEPOLIA]: {
    id: 59141,
    name: 'Linea Sepolia',
    shortName: 'linea-sepolia',
    logo: chainIcons[SUPPORTED_CHAINS.LINEA_SEPOLIA],
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://rpc.sepolia.linea.build'],
    blockExplorerUrls: ['https://sepolia.lineascan.build'],
  },
  [SUPPORTED_CHAINS.SCROLL_SEPOLIA]: {
    id: 534352,
    name: 'Scroll Sepolia',
    shortName: 'scroll-sepolia',
    logo: chainIcons[SUPPORTED_CHAINS.SCROLL_SEPOLIA],
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://sepolia-rpc.scroll.io'],
    blockExplorerUrls: ['https://sepolia.scrollscan.com'],
  },
} as const;

// Event name constants to prevent typos
export const NEXUS_EVENTS = {
  EXPECTED_STEPS: 'expected_steps',
  STEP_COMPLETE: 'step_complete',
  ACCOUNTS_CHANGED: 'accountsChanged',
  CHAIN_CHANGED: 'chainChanged',
  // Modular event names
  BRIDGE_STARTED: 'bridge:started',
  BRIDGE_COMPLETED: 'bridge:completed',
  BRIDGE_FAILED: 'bridge:failed',
  DEPOSIT_STARTED: 'deposit:started',
  DEPOSIT_COMPLETED: 'deposit:completed',
  DEPOSIT_FAILED: 'deposit:failed',
  OPERATION_STARTED: 'operation:started',
  OPERATION_COMPLETED: 'operation:completed',
  OPERATION_FAILED: 'operation:failed',
  // Transaction confirmation events
  TRANSACTION_SENT: 'transaction:sent',
  TRANSACTION_CONFIRMED: 'transaction:confirmed',
  RECEIPT_RECEIVED: 'receipt:received',
  CONFIRMATION_UPDATE: 'confirmation:update',
} as const;

// Helper constants for mainnet and testnet chain categorization
export const MAINNET_CHAINS = [
  SUPPORTED_CHAINS.ETHEREUM,
  SUPPORTED_CHAINS.BASE,
  SUPPORTED_CHAINS.ARBITRUM,
  SUPPORTED_CHAINS.OPTIMISM,
  SUPPORTED_CHAINS.POLYGON,
  SUPPORTED_CHAINS.AVALANCHE,
  SUPPORTED_CHAINS.LINEA,
  SUPPORTED_CHAINS.SCROLL,
] as const;

export const TESTNET_CHAINS = [
  SUPPORTED_CHAINS.ETHEREUM_SEPOLIA,
  SUPPORTED_CHAINS.BASE_SEPOLIA,
  SUPPORTED_CHAINS.ARBITRUM_SEPOLIA,
  SUPPORTED_CHAINS.OPTIMISM_SEPOLIA,
  SUPPORTED_CHAINS.POLYGON_AMOY,
  SUPPORTED_CHAINS.AVALANCHE_FUJI,
  SUPPORTED_CHAINS.LINEA_SEPOLIA,
  SUPPORTED_CHAINS.SCROLL_SEPOLIA,
] as const;
