import { ChainMetadata, TokenMetadata } from '../types';

export const SUPPORTED_CHAINS = {
  // Mainnet chains
  ETHEREUM: 1,
  BASE: 8453,
  ARBITRUM: 42161,
  OPTIMISM: 10,
  POLYGON: 137,
  AVALANCHE: 43114,
  SCROLL: 534352,

  // Testnet chains
  BASE_SEPOLIA: 84532,
  ARBITRUM_SEPOLIA: 421614,
  OPTIMISM_SEPOLIA: 11155420,
  POLYGON_AMOY: 80002,
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
  [SUPPORTED_CHAINS.SCROLL]:
    'https://assets.coingecko.com/coins/images/50571/standard/scroll.jpg?1728376125',

  // Testnet chain icons (reuse mainnet icons)

  [SUPPORTED_CHAINS.BASE_SEPOLIA]:
    'https://raw.githubusercontent.com/base/brand-kit/main/logo/symbol/Base_Symbol_Blue.svg',
  [SUPPORTED_CHAINS.ARBITRUM_SEPOLIA]:
    'https://assets.coingecko.com/coins/images/16547/small/photo_2023-03-29_21.47.00.jpeg',
  [SUPPORTED_CHAINS.OPTIMISM_SEPOLIA]:
    'https://assets.coingecko.com/coins/images/25244/small/Optimism.png',
  [SUPPORTED_CHAINS.POLYGON_AMOY]:
    'https://assets.coingecko.com/coins/images/4713/small/polygon.png',
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
  [SUPPORTED_CHAINS.SCROLL]: {
    id: 534352,
    name: 'Scroll',
    shortName: 'scroll',
    logo: chainIcons[SUPPORTED_CHAINS.SCROLL],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://rpc.scroll.io'],
    blockExplorerUrls: ['https://scrollscan.com'],
  },

  // Testnet chains
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
} as const;

// Event name constants to prevent typos
export const NEXUS_EVENTS = {
  STEP_COMPLETE: 'step_complete',
  EXPECTED_STEPS: 'expected_steps',
  ACCOUNTS_CHANGED: 'accountsChanged',
  CHAIN_CHANGED: 'chainChanged',
  // Modular event names
  BRIDGE_EXECUTE_EXPECTED_STEPS: 'bridge_execute_expected_steps',
  BRIDGE_EXECUTE_COMPLETED_STEPS: 'bridge_execute_completed_steps',
} as const;

// Helper constants for mainnet and testnet chain categorization
export const MAINNET_CHAINS = [
  SUPPORTED_CHAINS.ETHEREUM,
  SUPPORTED_CHAINS.BASE,
  SUPPORTED_CHAINS.ARBITRUM,
  SUPPORTED_CHAINS.OPTIMISM,
  SUPPORTED_CHAINS.POLYGON,
  SUPPORTED_CHAINS.AVALANCHE,
  SUPPORTED_CHAINS.SCROLL,
] as const;

export const TESTNET_CHAINS = [
  SUPPORTED_CHAINS.BASE_SEPOLIA,
  SUPPORTED_CHAINS.ARBITRUM_SEPOLIA,
  SUPPORTED_CHAINS.OPTIMISM_SEPOLIA,
  SUPPORTED_CHAINS.POLYGON_AMOY,
] as const;

/**
 * Token contract addresses per chain
 * This registry contains the contract addresses for supported tokens across different chains
 */
export const TOKEN_CONTRACT_ADDRESSES: Record<string, Record<number, string>> = {
  USDC: {
    [SUPPORTED_CHAINS.ETHEREUM]: '0xA0b86a33E6441B4c8B0e91BE5C55F49F4D55c76F',
    [SUPPORTED_CHAINS.BASE]: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    [SUPPORTED_CHAINS.POLYGON]: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    [SUPPORTED_CHAINS.ARBITRUM]: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    [SUPPORTED_CHAINS.OPTIMISM]: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
  },
  USDT: {
    [SUPPORTED_CHAINS.ETHEREUM]: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    [SUPPORTED_CHAINS.POLYGON]: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    [SUPPORTED_CHAINS.ARBITRUM]: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
  },
  // ETH is native on all supported chains, no contract address needed
} as const;

/**
 * Testnet token contract addresses per chain
 * Note: Most testnets use different contract addresses than mainnet
 */
export const TESTNET_TOKEN_CONTRACT_ADDRESSES: Record<string, Record<number, string>> = {
  USDC: {
    [SUPPORTED_CHAINS.BASE_SEPOLIA]: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    [SUPPORTED_CHAINS.ARBITRUM_SEPOLIA]: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
    [SUPPORTED_CHAINS.OPTIMISM_SEPOLIA]: '0x5fd84259d66Cd46123540766Be93DFE6D43130D7',
    [SUPPORTED_CHAINS.POLYGON_AMOY]: '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582',
  },
  USDT: {
    [SUPPORTED_CHAINS.BASE_SEPOLIA]: '0xf7e53b20f39a5f8c35005fEf37eef03A7b0d0B5a',
    [SUPPORTED_CHAINS.ARBITRUM_SEPOLIA]: '0xb9a4873d8d2C22e56b8574e8605644d08E047434',
    [SUPPORTED_CHAINS.OPTIMISM_SEPOLIA]: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607',
    [SUPPORTED_CHAINS.POLYGON_AMOY]: '0x2c852e740B62308c46DD29B982FBb650D063Bd07',
  },
  // ETH is native on all supported chains, no contract address needed
} as const;
