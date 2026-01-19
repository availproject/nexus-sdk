import type { ChainMetadata, TokenMetadata } from '../types';

export const MAINNET_CHAIN_IDS = {
  ETHEREUM: 1,
  BASE: 8453,
  ARBITRUM: 42161,
  OPTIMISM: 10,
  POLYGON: 137,
  AVALANCHE: 43114,
  SCROLL: 534352,
  SOPHON: 50104,
  KAIA: 8217,
  BNB: 56,
  HYPEREVM: 999,
  // TRON: 728126428,
  MONAD: 143,
  MEGAETH: 4326,
} as const;

export const TESTNET_CHAIN_IDS = {
  SEPOLIA: 11155111,
  BASE_SEPOLIA: 84532,
  ARBITRUM_SEPOLIA: 421614,
  OPTIMISM_SEPOLIA: 11155420,
  POLYGON_AMOY: 80002,
  MONAD_TESTNET: 10143,
  // TRON_SHASTA: 2494104990,
  // VALIDIUM_TESTNET: 567,
} as const;

export const SUPPORTED_CHAINS = {
  ...MAINNET_CHAIN_IDS,
  ...TESTNET_CHAIN_IDS,
} as const;

const BASE_TOKEN_METADATA = {
  ETH: {
    symbol: 'ETH',
    name: 'Ethereum',
    decimals: 18,
    icon: 'https://coin-images.coingecko.com/coins/images/279/large/ethereum.png',
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
    icon: 'https://coin-images.coingecko.com/coins/images/6319/large/usdc.png',
    coingeckoId: 'usd-coin',
  },
} as const;

export const TOKEN_METADATA: Record<string, TokenMetadata> = BASE_TOKEN_METADATA;

export const TESTNET_TOKEN_METADATA: Record<string, TokenMetadata> = {
  ETH: { ...BASE_TOKEN_METADATA.ETH, name: 'Test Ethereum' },
  USDT: { ...BASE_TOKEN_METADATA.USDT, name: 'Test Tether USD' },
  USDC: { ...BASE_TOKEN_METADATA.USDC, name: 'Test USD Coin' },
} as const;

/**
 * Chain metadata
 * @returns Chain metadata
 */

export const CHAIN_METADATA: Record<number, ChainMetadata> = {
  // Mainnet chains
  [SUPPORTED_CHAINS.ETHEREUM]: {
    id: SUPPORTED_CHAINS.ETHEREUM,
    name: 'Ethereum',
    shortName: 'eth',
    logo: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://eth.merkle.io'],
    blockExplorerUrls: ['https://etherscan.io'],
  },
  [SUPPORTED_CHAINS.MONAD]: {
    id: SUPPORTED_CHAINS.MONAD,
    name: 'Monad',
    shortName: 'monad',
    logo: 'https://assets.coingecko.com/coins/images/38927/large/monad.jpg',
    nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
    rpcUrls: ['https://rpcs.avail.so/monad'],
    blockExplorerUrls: ['https://monadvision.com'],
  },
  [SUPPORTED_CHAINS.BASE]: {
    id: SUPPORTED_CHAINS.BASE,
    name: 'Base',
    shortName: 'base',
    logo: 'https://pbs.twimg.com/profile_images/1945608199500910592/rnk6ixxH_400x400.jpg',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://mainnet.base.org'],
    blockExplorerUrls: ['https://basescan.org'],
  },
  [SUPPORTED_CHAINS.ARBITRUM]: {
    id: SUPPORTED_CHAINS.ARBITRUM,
    name: 'Arbitrum One',
    shortName: 'arb1',
    logo: 'https://assets.coingecko.com/coins/images/16547/small/photo_2023-03-29_21.47.00.jpeg',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: [
      'https://arb-mainnet.g.alchemy.com/v2/PfaswrKq0rjOrfYWHfE9uLQKhiD4JCdq',
      'https://arbitrum.blockpi.network/v1/rpc/a8ccd43cdc840c2b2d20c24a058514a21302376d',
    ],
    blockExplorerUrls: ['https://arbiscan.io'],
  },
  [SUPPORTED_CHAINS.OPTIMISM]: {
    id: SUPPORTED_CHAINS.OPTIMISM,
    name: 'Optimism',
    shortName: 'oeth',
    logo: 'https://assets.coingecko.com/coins/images/25244/small/Optimism.png',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://mainnet.optimism.io'],
    blockExplorerUrls: ['https://optimistic.etherscan.io'],
  },
  [SUPPORTED_CHAINS.POLYGON]: {
    id: SUPPORTED_CHAINS.POLYGON,
    name: 'Polygon',
    shortName: 'matic',
    logo: 'https://assets.coingecko.com/coins/images/4713/small/polygon.png',
    nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
    rpcUrls: ['https://polygon-rpc.com'],
    blockExplorerUrls: ['https://polygonscan.com'],
  },
  [SUPPORTED_CHAINS.AVALANCHE]: {
    id: SUPPORTED_CHAINS.AVALANCHE,
    name: 'Avalanche',
    shortName: 'avax',
    logo: 'https://assets.coingecko.com/coins/images/12559/small/Avalanche_Circle_RedWhite_Trans.png',
    nativeCurrency: { name: 'Avalanche', symbol: 'AVAX', decimals: 18 },
    rpcUrls: ['https://api.avax.network/ext/bc/C/rpc'],
    blockExplorerUrls: ['https://snowtrace.io'],
  },
  [SUPPORTED_CHAINS.SCROLL]: {
    id: SUPPORTED_CHAINS.SCROLL,
    name: 'Scroll',
    shortName: 'scroll',
    logo: 'https://assets.coingecko.com/coins/images/50571/standard/scroll.jpg?1728376125',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://rpc.scroll.io'],
    blockExplorerUrls: ['https://scrollscan.com'],
  },
  [SUPPORTED_CHAINS.SOPHON]: {
    id: SUPPORTED_CHAINS.SOPHON,
    name: 'Sophon',
    shortName: 'sophon',
    logo: 'https://assets.coingecko.com/coins/images/38680/large/sophon_logo_200.png',
    nativeCurrency: { name: 'Sophon', symbol: 'SOPH', decimals: 18 },
    rpcUrls: ['https://rpc.sophon.xyz'],
    blockExplorerUrls: ['https://explorer.sophon.xyz'],
  },
  [SUPPORTED_CHAINS.KAIA]: {
    id: SUPPORTED_CHAINS.KAIA,
    name: 'Kaia Mainnet',
    shortName: 'kaia',
    logo: 'https://assets.coingecko.com/asset_platforms/images/9672/large/kaia.png',
    nativeCurrency: { name: 'Kaia', symbol: 'KAIA', decimals: 18 },
    rpcUrls: ['https://public-en.node.kaia.io'],
    blockExplorerUrls: ['https://kaiascan.io'],
  },
  [SUPPORTED_CHAINS.BNB]: {
    id: SUPPORTED_CHAINS.BNB,
    name: 'BNB Smart Chain',
    shortName: 'bnb',
    logo: 'https://assets.coingecko.com/asset_platforms/images/1/large/bnb_smart_chain.png',
    nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
    rpcUrls: ['https://bsc-pokt.nodies.app'],
    blockExplorerUrls: ['https://bscscan.com'],
  },
  [SUPPORTED_CHAINS.HYPEREVM]: {
    id: 999,
    name: 'Hyper EVM',
    shortName: 'hyperliquid',
    logo: 'https://assets.coingecko.com/asset_platforms/images/243/large/hyperliquid.png',
    nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 },
    rpcUrls: ['https://rpc.hyperliquid.xyz/evm'],
    blockExplorerUrls: ['https://hyperevmscan.io/'],
  },
  [SUPPORTED_CHAINS.MEGAETH]: {
    id: 4326,
    name: 'MegaETH',
    shortName: 'megaETH',
    logo: 'https://assets.coingecko.com/coins/images/69995/large/ICON.png',
    nativeCurrency: {
      decimals: 18,
      name: 'Ether',
      symbol: 'ETH',
    },
    rpcUrls: ['https://rpcs.avail.so/megaeth'],
    blockExplorerUrls: ['https://megaeth.blockscout.com/'],
  },

  // Testnet chains
  [SUPPORTED_CHAINS.SEPOLIA]: {
    id: SUPPORTED_CHAINS.SEPOLIA,
    name: 'Sepolia',
    shortName: 'sepolia',
    logo: 'https://assets.coingecko.com/asset_platforms/images/279/large/ethereum.png?1706606803',
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://sepolia.drpc.org'],
    blockExplorerUrls: ['https://sepolia.etherscan.io'],
  },
  [SUPPORTED_CHAINS.BASE_SEPOLIA]: {
    id: SUPPORTED_CHAINS.BASE_SEPOLIA,
    name: 'Base Sepolia',
    shortName: 'base-sepolia',
    logo: 'https://pbs.twimg.com/profile_images/1945608199500910592/rnk6ixxH_400x400.jpg',
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://sepolia.base.org'],
    blockExplorerUrls: ['https://sepolia.basescan.org'],
  },
  [SUPPORTED_CHAINS.MONAD_TESTNET]: {
    id: SUPPORTED_CHAINS.MONAD_TESTNET,
    name: 'Monad Testnet',
    shortName: 'monad-testnet',
    logo: 'https://assets.coingecko.com/coins/images/38927/standard/monad.jpg',
    nativeCurrency: { name: 'Testnet MON Token', symbol: 'MON', decimals: 18 },
    rpcUrls: ['https://testnet-rpc.monad.xyz/'],
    blockExplorerUrls: ['https://testnet.monadexplorer.com/'],
  },
  [SUPPORTED_CHAINS.ARBITRUM_SEPOLIA]: {
    id: SUPPORTED_CHAINS.ARBITRUM_SEPOLIA,
    name: 'Arbitrum Sepolia',
    shortName: 'arb-sepolia',
    logo: 'https://assets.coingecko.com/coins/images/16547/small/photo_2023-03-29_21.47.00.jpeg',
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://sepolia-rollup.arbitrum.io/rpc'],
    blockExplorerUrls: ['https://sepolia.arbiscan.io'],
  },
  [SUPPORTED_CHAINS.OPTIMISM_SEPOLIA]: {
    id: SUPPORTED_CHAINS.OPTIMISM_SEPOLIA,
    name: 'Optimism Sepolia',
    shortName: 'op-sepolia',
    logo: 'https://assets.coingecko.com/coins/images/25244/small/Optimism.png',
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://sepolia.optimism.io'],
    blockExplorerUrls: ['https://sepolia-optimism.etherscan.io'],
  },
  [SUPPORTED_CHAINS.POLYGON_AMOY]: {
    id: SUPPORTED_CHAINS.POLYGON_AMOY,
    name: 'Polygon Amoy',
    shortName: 'amoy',
    logo: 'https://assets.coingecko.com/coins/images/4713/small/polygon.png',
    nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
    rpcUrls: ['https://rpc-amoy.polygon.technology'],
    blockExplorerUrls: ['https://amoy.polygonscan.com'],
  },
} as const;

/**
 * Event name constants to prevent typos
 * @returns Event name constants
 */
export const NEXUS_EVENTS = {
  STEP_COMPLETE: 'STEP_COMPLETE',
  SWAP_STEP_COMPLETE: 'SWAP_STEP_COMPLETE',
  STEPS_LIST: 'STEPS_LIST',
} as const;

/**
 * Mainnet chains
 * @returns Mainnet chains
 */
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
  SUPPORTED_CHAINS.BNB,
  SUPPORTED_CHAINS.HYPEREVM,
  SUPPORTED_CHAINS.MEGAETH,
  // SUPPORTED_CHAINS.TRON,
] as const;

/**
 * Testnet chains
 * @returns Testnet chains
 */
export const TESTNET_CHAINS = [
  SUPPORTED_CHAINS.SEPOLIA,
  SUPPORTED_CHAINS.BASE_SEPOLIA,
  SUPPORTED_CHAINS.ARBITRUM_SEPOLIA,
  SUPPORTED_CHAINS.OPTIMISM_SEPOLIA,
  SUPPORTED_CHAINS.POLYGON_AMOY,
  SUPPORTED_CHAINS.MONAD_TESTNET,
  // SUPPORTED_CHAINS.TRON_SHASTA,
] as const;

/**
 * Token contract addresses per chain
 * This registry contains the contract addresses for supported tokens across different chains
 */
export const TOKEN_CONTRACT_ADDRESSES = {
  USDC: {
    [SUPPORTED_CHAINS.ETHEREUM]: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    [SUPPORTED_CHAINS.BASE]: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    [SUPPORTED_CHAINS.POLYGON]: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
    [SUPPORTED_CHAINS.ARBITRUM]: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
    [SUPPORTED_CHAINS.SOPHON]: '0x9aa0f72392b5784ad86c6f3e899bcc053d00db4f',
    [SUPPORTED_CHAINS.OPTIMISM]: '0x0b2c639c533813f4aa9d7837caf62653d097ff85',
    [SUPPORTED_CHAINS.SCROLL]: '0x06efdbff2a14a7c8e15944d1f4a48f9f95f663a4',
    [SUPPORTED_CHAINS.AVALANCHE]: '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e',
    [SUPPORTED_CHAINS.BNB]: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    [SUPPORTED_CHAINS.HYPEREVM]: '0xb88339CB7199b77E23DB6E890353E22632Ba630f',
    [SUPPORTED_CHAINS.MONAD]: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603',
    [SUPPORTED_CHAINS.MEGAETH]: '0x590cb8868c6DeBc12CCd42E837042659cfB91504',
    // Testnet chains
    [SUPPORTED_CHAINS.SEPOLIA]: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    // [SUPPORTED_CHAINS.VALIDIUM_TESTNET]: '0x8Cf5f629Bb26FC3F92144e72bC4A3719A7DF07F3',
    [SUPPORTED_CHAINS.BASE_SEPOLIA]: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    [SUPPORTED_CHAINS.ARBITRUM_SEPOLIA]: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
    [SUPPORTED_CHAINS.OPTIMISM_SEPOLIA]: '0x5fd84259d66Cd46123540766Be93DFE6D43130D7',
    [SUPPORTED_CHAINS.POLYGON_AMOY]: '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582',
    [SUPPORTED_CHAINS.MONAD_TESTNET]: '0xf817257fed379853cDe0fa4F97AB987181B1E5Ea',
  } as const,
  USDT: {
    [SUPPORTED_CHAINS.ETHEREUM]: '0xdac17f958d2ee523a2206206994597c13d831ec7',
    [SUPPORTED_CHAINS.POLYGON]: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f',
    [SUPPORTED_CHAINS.ARBITRUM]: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9',
    [SUPPORTED_CHAINS.SOPHON]: '0x6386da73545ae4e2b2e0393688fa8b65bb9a7169',
    [SUPPORTED_CHAINS.KAIA]: '0xd077a400968890eacc75cdc901f0356c943e4fdb',
    [SUPPORTED_CHAINS.OPTIMISM]: '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58',
    [SUPPORTED_CHAINS.SCROLL]: '0xf55bec9cafdbe8730f096aa55dad6d22d44099df',
    [SUPPORTED_CHAINS.AVALANCHE]: '0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7',
    [SUPPORTED_CHAINS.BNB]: '0x55d398326f99059fF775485246999027B3197955',
    [SUPPORTED_CHAINS.HYPEREVM]: '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb',
    // [SUPPORTED_CHAINS.TRON]: '0xa614f803B6FD780986A42c78Ec9c7f77e6DeD13C',
    // testnet chains
    // [SUPPORTED_CHAINS.TRON_SHASTA]: '0x42a1e39aefA49290F2B3F9ed688D7cecf86CD6E0',
    [SUPPORTED_CHAINS.ARBITRUM_SEPOLIA]: '0xF954d4A5859b37De88a91bdbb8Ad309056FB04B1',
    [SUPPORTED_CHAINS.OPTIMISM_SEPOLIA]: '0x6462693c2F21AC0E517f12641D404895030F7426',
    [SUPPORTED_CHAINS.MONAD_TESTNET]: '0x1c56F176D6735888fbB6f8bD9ADAd8Ad7a023a0b',
  },
} as const;

export const DESTINATION_SWAP_TOKENS = new Map<
  number,
  {
    decimals: number;
    logo: string;
    name: string;
    symbol: string;
    tokenAddress: `0x${string}`;
  }[]
>([
  [
    SUPPORTED_CHAINS.OPTIMISM,
    [
      {
        decimals: 18,
        logo: 'https://coin-images.coingecko.com/coins/images/279/large/ethereum.png?1696501628',
        name: 'Ether',
        symbol: 'ETH',
        tokenAddress: '0x0000000000000000000000000000000000000000',
      },
      {
        decimals: 6,
        logo: 'https://coin-images.coingecko.com/coins/images/6319/large/usdc.png?1696506694',
        name: 'USD Coin',
        symbol: 'USDC',
        tokenAddress: '0x0b2c639c533813f4aa9d7837caf62653d097ff85',
      },
      {
        decimals: 6,
        logo: 'https://coin-images.coingecko.com/coins/images/35023/large/USDT.png',
        name: 'USDT Coin',
        symbol: 'USDT',
        tokenAddress: '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58',
      },
      {
        decimals: 18,
        logo: 'https://coin-images.coingecko.com/coins/images/25244/large/Optimism.png?1696524385',
        name: 'Optimism',
        symbol: 'OP',
        tokenAddress: '0x4200000000000000000000000000000000000042',
      },
      {
        decimals: 18,
        logo: 'https://coin-images.coingecko.com/coins/images/12645/large/AAVE.png?1696512452',
        name: 'Aave Token',
        symbol: 'AAVE',
        tokenAddress: '0x76fb31fb4af56892a25e32cfc43de717950c9278',
      },
      {
        decimals: 18,
        logo: 'https://coin-images.coingecko.com/coins/images/12504/large/uni.jpg?1696512319',
        name: 'Uniswap',
        symbol: 'UNI',
        tokenAddress: '0x6fd9d7ad17242c41f7131d257212c54a0e816691',
      },
    ],
  ],
  [
    SUPPORTED_CHAINS.ARBITRUM,
    [
      {
        decimals: 18,
        logo: 'https://coin-images.coingecko.com/coins/images/279/large/ethereum.png?1696501628',
        name: 'Ether',
        symbol: 'ETH',
        tokenAddress: '0x0000000000000000000000000000000000000000',
      },
      {
        decimals: 6,
        logo: 'https://coin-images.coingecko.com/coins/images/6319/large/usdc.png?1696506694',
        name: 'USD Coin',
        symbol: 'USDC',
        tokenAddress: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
      },
      {
        decimals: 6,
        logo: 'https://coin-images.coingecko.com/coins/images/35023/large/USDT.png',
        name: 'USDT Coin',
        symbol: 'USDT',
        tokenAddress: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9',
      },
      {
        decimals: 18,
        logo: 'https://coin-images.coingecko.com/coins/images/29850/large/pepe-token.jpeg?1696528776',
        name: 'Pepe',
        symbol: 'PEPE',
        tokenAddress: '0x25d887ce7a35172c62febfd67a1856f20faebb00',
      },
      {
        decimals: 18,
        logo: 'https://coin-images.coingecko.com/coins/images/13573/large/Lido_DAO.png?1696513326',
        name: 'Lido DAO Token',
        symbol: 'LDO',
        tokenAddress: '0x13ad51ed4f1b7e9dc168d8a00cb3f4ddd85efa60',
      },
    ],
  ],
  [
    SUPPORTED_CHAINS.SCROLL,
    [
      {
        decimals: 18,
        logo: 'https://coin-images.coingecko.com/coins/images/279/large/ethereum.png?1696501628',
        name: 'Ether',
        symbol: 'ETH',
        tokenAddress: '0x0000000000000000000000000000000000000000',
      },
      {
        decimals: 6,
        logo: 'https://coin-images.coingecko.com/coins/images/6319/large/usdc.png?1696506694',
        name: 'USD Coin',
        symbol: 'USDC',
        tokenAddress: '0x06efdbff2a14a7c8e15944d1f4a48f9f95f663a4',
      },
      {
        decimals: 6,
        logo: 'https://coin-images.coingecko.com/coins/images/35023/large/USDT.png',
        name: 'USDT Coin',
        symbol: 'USDT',
        tokenAddress: '0xf55bec9cafdbe8730f096aa55dad6d22d44099df',
      },
    ],
  ],
  [
    SUPPORTED_CHAINS.BASE,
    [
      {
        decimals: 18,
        logo: 'https://coin-images.coingecko.com/coins/images/279/large/ethereum.png?1696501628',
        name: 'Ether',
        symbol: 'ETH',
        tokenAddress: '0x0000000000000000000000000000000000000000',
      },
      {
        decimals: 6,
        logo: 'https://coin-images.coingecko.com/coins/images/6319/large/usdc.png?1696506694',
        name: 'USD Coin',
        symbol: 'USDC',
        tokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      },
      {
        decimals: 18,
        logo: 'https://coin-images.coingecko.com/coins/images/9956/large/Badge_Dai.png?1696509996',
        name: 'Dai Stablecoin',
        symbol: 'DAI',
        tokenAddress: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
      },
      {
        decimals: 18,
        logo: 'https://coin-images.coingecko.com/coins/images/28206/large/ftxG9_TJ_400x400.jpeg?1696527208',
        name: 'LayerZero',
        symbol: 'ZRO',
        tokenAddress: '0x6985884c4392d348587b19cb9eaaf157f13271cd',
      },
      {
        decimals: 18,
        logo: 'https://assets.coingecko.com/coins/images/12151/standard/OM_Token.png?1696511991',
        name: 'MANTRA',
        symbol: 'OM',
        tokenAddress: '0x3992b27da26848c2b19cea6fd25ad5568b68ab98',
      },
      {
        decimals: 18,
        logo: 'https://assets.coingecko.com/coins/images/54411/standard/Qm4DW488_400x400.jpg',
        name: 'KAITO',
        symbol: 'KAITO',
        tokenAddress: '0x98d0baa52b2d063e780de12f615f963fe8537553',
      },
    ],
  ],
  [
    SUPPORTED_CHAINS.BNB,
    [
      {
        decimals: 18,
        logo: 'https://assets.coingecko.com/coins/images/825/large/bnb-icon2_2x.png',
        name: 'BNB',
        symbol: 'BNB',
        tokenAddress: '0x0000000000000000000000000000000000000000',
      },
    ],
  ],
]);
