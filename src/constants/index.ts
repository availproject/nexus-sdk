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
  SOPHON: 50104,
  KAIA: 8217,

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
  [SUPPORTED_CHAINS.SOPHON]:
    'https://assets.coingecko.com/coins/images/38680/large/sophon_logo_200.png',
  [SUPPORTED_CHAINS.KAIA]:
    'https://assets.coingecko.com/asset_platforms/images/9672/large/kaia.png',

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
  [SUPPORTED_CHAINS.SOPHON]: {
    id: 50104,
    name: 'Sophon',
    shortName: 'sophon',
    logo: chainIcons[SUPPORTED_CHAINS.SOPHON],
    nativeCurrency: { name: 'Sophon', symbol: 'SOPH', decimals: 18 },
    rpcUrls: ['https://rpc.sophon.xyz'],
    blockExplorerUrls: ['https://explorer.sophon.xyz'],
  },
  [SUPPORTED_CHAINS.KAIA]: {
    id: 8217,
    name: 'Kaia Mainnet',
    shortName: 'kaia',
    logo: chainIcons[SUPPORTED_CHAINS.KAIA],
    nativeCurrency: { name: 'Kaia', symbol: 'KAIA', decimals: 18 },
    rpcUrls: ['https://public-en.node.kaia.io'],
    blockExplorerUrls: ['https://kaiascan.io'],
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
  SUPPORTED_CHAINS.SOPHON,
  SUPPORTED_CHAINS.KAIA,
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
    [SUPPORTED_CHAINS.ETHEREUM]: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    [SUPPORTED_CHAINS.BASE]: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    [SUPPORTED_CHAINS.POLYGON]: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
    [SUPPORTED_CHAINS.ARBITRUM]: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
    [SUPPORTED_CHAINS.SOPHON]: '0x9aa0f72392b5784ad86c6f3e899bcc053d00db4f',
    [SUPPORTED_CHAINS.OPTIMISM]: '0x0b2c639c533813f4aa9d7837caf62653d097ff85',
    [SUPPORTED_CHAINS.SCROLL]: '0x06efdbff2a14a7c8e15944d1f4a48f9f95f663a4',
    [SUPPORTED_CHAINS.AVALANCHE]: '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e',
  },
  USDT: {
    [SUPPORTED_CHAINS.ETHEREUM]: '0xdac17f958d2ee523a2206206994597c13d831ec7',
    [SUPPORTED_CHAINS.POLYGON]: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f',
    [SUPPORTED_CHAINS.ARBITRUM]: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9',
    [SUPPORTED_CHAINS.SOPHON]: '0x6386da73545ae4e2b2e0393688fa8b65bb9a7169',
    [SUPPORTED_CHAINS.KAIA]: '0xd077a400968890eacc75cdc901f0356c943e4fdb',
    [SUPPORTED_CHAINS.OPTIMISM]: '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58',
    [SUPPORTED_CHAINS.SCROLL]: '0xf55bec9cafdbe8730f096aa55dad6d22d44099df',
    [SUPPORTED_CHAINS.AVALANCHE]: '0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7',
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
