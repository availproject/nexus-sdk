import {
  ChainIDKeyedMap,
  Environment,
  getVaultContractMap,
  OmniversalChainID,
  Universe,
} from '@arcana/ca-common';
import { CHAIN_IDS } from 'fuels';

import {
  FUEL_BASE_ASSET_ID,
  FUEL_NETWORK_URL,
  getLogoFromSymbol,
  HYPEREVM_CHAIN_ID,
  KAIA_CHAIN_ID,
  MONAD_TESTNET_CHAIN_ID,
  SOPHON_CHAIN_ID,
  ZERO_ADDRESS,
} from './constants';
import { Chain, TokenInfo } from '@nexus/commons';
import { convertToHexAddressByUniverse, equalFold } from './utils';

class ChainList {
  public chains: Chain[];
  private vcm: ChainIDKeyedMap<Buffer<ArrayBufferLike>>;

  constructor(env: Environment) {
    switch (env) {
      case Environment.CERISE:
      case Environment.CORAL:
        this.chains = MAINNET_CHAINS;
        break;
      case Environment.FOLLY:
        this.chains = TESTNET_CHAINS;
        break;
      case Environment.JADE:
        throw new Error('Jade environment not supported yet');
      default:
        throw new Error('Unknown environment');
    }
    this.vcm = getVaultContractMap(env);
  }

  public getChainByID(id: number) {
    return this.chains.find((c) => c.id === id);
  }

  public getNativeToken(chainID: number): TokenInfo {
    const chain = this.getChainByID(chainID);
    if (!chain) {
      throw new Error('chain not found');
    }

    return {
      contractAddress: ZERO_ADDRESS,
      decimals: chain.nativeCurrency.decimals,
      logo: chain.custom.icon,
      name: chain.nativeCurrency.name,
      symbol: chain.nativeCurrency.symbol,
    };
  }

  public getTokenByAddress(chainID: number, address: `0x${string}`) {
    const chain = this.getChainByID(chainID);
    if (!chain) {
      return undefined;
    }
    const token = chain.custom.knownTokens.find((t) => equalFold(t.contractAddress, address));

    if (!token) {
      if (equalFold(address, ZERO_ADDRESS)) {
        return this.getNativeToken(chainID);
      }
    }
    return token;
  }

  public getTokenInfoBySymbol(chainID: number, symbol: string) {
    const chain = this.getChainByID(chainID);
    if (!chain) {
      return undefined;
    }

    const token = chain.custom.knownTokens.find((t) => equalFold(t.symbol, symbol));
    if (!token) {
      if (equalFold(chain.nativeCurrency.symbol, symbol)) {
        return {
          contractAddress: ZERO_ADDRESS,
          decimals: chain.nativeCurrency.decimals,
          logo: chain.custom.icon,
          name: chain.nativeCurrency.name,
          symbol: chain.nativeCurrency.symbol,
        };
      }
    }
    return token;
  }

  public getVaultContractAddress(chainID: number) {
    const chain = this.getChainByID(chainID);
    if (!chain) {
      throw new Error('chain not supported');
    }

    const omniversalChainID = new OmniversalChainID(chain.universe, chainID);

    const vc = this.vcm.get(omniversalChainID);
    if (!vc) {
      throw new Error('vault contract not found');
    }

    return convertToHexAddressByUniverse(vc, chain.universe);
  }
}

const TESTNET_CHAINS: Chain[] = [
  {
    blockExplorers: {
      default: {
        name: 'Arbitrum Sepolia Explorer',
        url: 'https://sepolia.arbiscan.io/',
      },
    },
    custom: {
      icon: '/images/logos/arbitrum.svg',
      knownTokens: [
        {
          contractAddress: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
          decimals: 6,
          logo: getLogoFromSymbol('USDC'),
          name: 'USD Coin',
          symbol: 'USDC',
        },
        {
          contractAddress: '0xF954d4A5859b37De88a91bdbb8Ad309056FB04B1',
          decimals: 18,
          logo: getLogoFromSymbol('USDT'),
          name: 'Testing USD',
          symbol: 'USDT',
        },
      ],
    },
    id: 421614,
    name: 'Arbitrum Sepolia',
    nativeCurrency: {
      decimals: 18,
      name: 'Ether',
      symbol: 'ETH',
    },
    rpcUrls: {
      default: {
        http: ['https://arb-sepolia.g.alchemy.com/v2/PfaswrKq0rjOrfYWHfE9uLQKhiD4JCdq'],
        publicHttp: [
          'https://public.stackup.sh/api/v1/node/arbitrum-sepolia',
          'https://endpoints.omniatech.io/v1/arbitrum/sepolia/public',
          'https://arbitrum-sepolia.gateway.tenderly.co',
          'https://api.zan.top/arb-sepolia',
        ],
        webSocket: ['wss://arb-sepolia.g.alchemy.com/v2/PfaswrKq0rjOrfYWHfE9uLQKhiD4JCdq'],
      },
    },
    universe: Universe.ETHEREUM,
  },
  {
    blockExplorers: {
      default: {
        name: 'OP Sepolia Explorer',
        url: 'https://sepolia-optimism.etherscan.io/',
      },
    },
    custom: {
      icon: '/images/logos/optimism.svg',
      knownTokens: [
        {
          contractAddress: '0x5fd84259d66Cd46123540766Be93DFE6D43130D7',
          decimals: 6,
          logo: getLogoFromSymbol('USDC'),
          name: 'USD Coin',
          symbol: 'USDC',
        },
        {
          contractAddress: '0x6462693c2F21AC0E517f12641D404895030F7426',
          decimals: 18,
          logo: getLogoFromSymbol('USDT'),
          name: 'Testing USD',
          symbol: 'USDT',
        },
      ],
    },
    id: 11155420,
    name: 'OP Sepolia',
    nativeCurrency: {
      decimals: 18,
      name: 'Ether',
      symbol: 'ETH',
    },
    rpcUrls: {
      default: {
        http: ['https://opt-sepolia.g.alchemy.com/v2/PfaswrKq0rjOrfYWHfE9uLQKhiD4JCdq'],
        publicHttp: [
          'https://api.zan.top/opt-sepolia',
          'https://endpoints.omniatech.io/v1/op/sepolia/public',
          'https://optimism-sepolia.gateway.tenderly.co',
          'https://optimism-sepolia.api.onfinality.io/public',
        ],
        webSocket: ['wss://opt-sepolia.g.alchemy.com/v2/PfaswrKq0rjOrfYWHfE9uLQKhiD4JCdq'],
      },
    },
    universe: Universe.ETHEREUM,
  },
  {
    blockExplorers: {
      default: {
        name: 'Amoy Polygon Explorer',
        url: 'https://amoy.polygonscan.com/',
      },
    },
    custom: {
      icon: '/images/logos/polygon.svg',
      knownTokens: [
        {
          contractAddress: '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582',
          decimals: 6,
          logo: getLogoFromSymbol('USDC'),
          name: 'USD Coin',
          symbol: 'USDC',
        },
      ],
    },
    id: 80002,
    name: 'Amoy',
    nativeCurrency: {
      decimals: 18,
      name: 'POL',
      symbol: 'POL',
    },
    rpcUrls: {
      default: {
        http: ['https://polygon-amoy.g.alchemy.com/v2/PfaswrKq0rjOrfYWHfE9uLQKhiD4JCdq'],
        publicHttp: [
          'https://polygon-amoy-bor-rpc.publicnode.com',
          'https://rpc-amoy.polygon.technology',
          'https://polygon-amoy.gateway.tenderly.co',
          'https://polygon-amoy.drpc.org',
        ],
        webSocket: ['wss://polygon-amoy.g.alchemy.com/v2/PfaswrKq0rjOrfYWHfE9uLQKhiD4JCdq'],
      },
    },
    universe: Universe.ETHEREUM,
  },
  {
    blockExplorers: {
      default: {
        name: 'Basescan',
        url: 'https://sepolia.basescan.org/',
      },
    },
    custom: {
      icon: '/images/logos/base.svg',
      knownTokens: [
        {
          contractAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
          decimals: 6,
          logo: getLogoFromSymbol('USDC'),
          name: 'USD Coin',
          symbol: 'USDC',
        },
      ],
    },
    id: 84532,
    name: 'Base Sepolia',
    nativeCurrency: {
      decimals: 18,
      name: 'Ether',
      symbol: 'ETH',
    },
    rpcUrls: {
      default: {
        http: ['https://base-sepolia.g.alchemy.com/v2/PfaswrKq0rjOrfYWHfE9uLQKhiD4JCdq'],
        publicHttp: [
          'https://rpc.notadegen.com/base/sepolia',
          'https://public.stackup.sh/api/v1/node/base-sepolia',
          'https://base-sepolia.gateway.tenderly.co',
          'https://base-sepolia.drpc.org',
        ],
        webSocket: ['wss://base-sepolia.g.alchemy.com/v2/PfaswrKq0rjOrfYWHfE9uLQKhiD4JCdq'],
      },
    },
    universe: Universe.ETHEREUM,
  },
  {
    blockExplorers: {
      default: {
        name: 'Monad Testnet Explorer',
        url: 'https://testnet.monadexplorer.com',
      },
    },
    custom: {
      icon: '/images/logos/base.svg',
      knownTokens: [
        {
          contractAddress: '0xf817257fed379853cDe0fa4F97AB987181B1E5Ea',
          decimals: 6,
          logo: getLogoFromSymbol('USDC'),
          name: 'USD Coin',
          symbol: 'USDC',
        },
        {
          contractAddress: '0x1c56F176D6735888fbB6f8bD9ADAd8Ad7a023a0b',
          decimals: 18,
          logo: getLogoFromSymbol('USDT'),
          name: 'Testing USDT',
          symbol: 'USDT',
        },
      ],
    },
    id: MONAD_TESTNET_CHAIN_ID,
    name: 'Monad Testnet',
    nativeCurrency: {
      decimals: 18,
      name: 'Monad',
      symbol: 'MON',
    },
    rpcUrls: {
      default: {
        http: ['https://lb.drpc.org/monad-testnet/Am5nENoJmEuovqui8_LMxzp4ChJzW7kR8JfPrqRhf0fE'],
        publicHttp: ['https://monad-testnet.drpc.org', 'https://rpc.ankr.com/monad_testnet'],
        webSocket: ['wss://lb.drpc.org/monad-testnet/Am5nENoJmEuovqui8_LMxzp4ChJzW7kR8JfPrqRhf0fE'],
      },
    },
    universe: Universe.ETHEREUM,
  },
  {
    blockExplorers: {
      default: {
        name: 'Etherscan Sepolia',
        url: 'https://sepolia.etherscan.io/',
      },
    },
    custom: {
      icon: '/images/logos/base.svg',
      knownTokens: [
        {
          contractAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
          decimals: 6,
          logo: getLogoFromSymbol('USDC'),
          name: 'USD Coin',
          symbol: 'USDC',
        },
      ],
    },
    id: 11155111,
    name: 'Ethereum Sepolia',
    nativeCurrency: {
      decimals: 18,
      name: 'Ether',
      symbol: 'ETH',
    },
    rpcUrls: {
      default: {
        http: ['https://sepolia.drpc.org'],
        publicHttp: [
          'https://api.zan.top/eth-sepolia',
          'https://ethereum-sepolia-public.nodies.app',
        ],
        webSocket: ['wss://sepolia.drpc.org'],
      },
    },
    universe: Universe.ETHEREUM,
  },
];

const MAINNET_CHAINS: Chain[] = [
  {
    blockExplorers: {
      default: {
        name: 'Fuel Network Explorer',
        url: 'https://app.fuel.network/',
      },
    },
    custom: {
      icon: 'https://avatars.githubusercontent.com/u/55993183',
      knownTokens: [
        {
          contractAddress: FUEL_BASE_ASSET_ID,
          decimals: 9,
          logo: getLogoFromSymbol('ETH'),
          name: 'Ether',
          symbol: 'ETH',
        },
        {
          contractAddress: '0x286c479da40dc953bddc3bb4c453b608bba2e0ac483b077bd475174115395e6b',
          decimals: 6,
          logo: getLogoFromSymbol('USDC'),
          name: 'USD Coin',
          symbol: 'USDC',
        },
        {
          contractAddress: '0xa0265fb5c32f6e8db3197af3c7eb05c48ae373605b8165b6f4a51c5b0ba4812e',
          decimals: 6,
          logo: getLogoFromSymbol('USDT'),
          name: 'Tether USD',
          symbol: 'USDT',
        },
      ],
    },
    id: CHAIN_IDS.fuel.mainnet,
    name: 'Fuel Network',
    nativeCurrency: {
      decimals: 9,
      name: 'Ether',
      symbol: 'ETH',
    },
    rpcUrls: {
      default: {
        http: [FUEL_NETWORK_URL],
        webSocket: [],
      },
    },
    universe: Universe.FUEL,
  },
  {
    blockExplorers: {
      default: {
        name: 'Sophscan',
        url: 'https://sophscan.xyz',
      },
    },
    custom: {
      icon: 'https://assets.coingecko.com/coins/images/38680/large/sophon_logo_200.png',
      knownTokens: [
        {
          contractAddress: '0x6386da73545ae4e2b2e0393688fa8b65bb9a7169',
          decimals: 6,
          logo: getLogoFromSymbol('USDT'),
          name: 'Tether USD',
          symbol: 'USDT',
        },
        {
          contractAddress: '0x9aa0f72392b5784ad86c6f3e899bcc053d00db4f',
          decimals: 6,
          logo: getLogoFromSymbol('USDC'),
          name: 'USD Coin',
          symbol: 'USDC',
        },
        {
          contractAddress: '0x72af9f169b619d85a47dfa8fefbcd39de55c567d',
          decimals: 18,
          logo: getLogoFromSymbol('ETH'),
          name: 'Ether',
          symbol: 'ETH',
        },
      ],
    },
    id: SOPHON_CHAIN_ID,
    name: 'Sophon',
    nativeCurrency: {
      decimals: 18,
      name: 'Sophon',
      symbol: 'SOPH',
    },
    rpcUrls: {
      default: {
        http: ['https://sophon.gateway.tenderly.co/1d4STFT7zmG0vM5QowibCw'],
        publicHttp: ['https://rpc-quicknode.sophon.xyz'],
        webSocket: ['wss://sophon.gateway.tenderly.co/1d4STFT7zmG0vM5QowibCw'],
      },
    },
    universe: Universe.ETHEREUM,
  },
  {
    blockExplorers: {
      default: {
        name: 'KaiaScan',
        url: 'https://kaiascan.io',
      },
    },
    custom: {
      icon: 'https://assets.coingecko.com/asset_platforms/images/9672/large/kaia.png',
      knownTokens: [
        {
          contractAddress: '0xd077a400968890eacc75cdc901f0356c943e4fdb',
          decimals: 6,
          logo: '/images/logos/usdt.svg',
          name: 'Tether USD',
          symbol: 'USDT',
        },
      ],
    },
    id: KAIA_CHAIN_ID,
    name: 'Kaia Mainnet',
    nativeCurrency: {
      decimals: 18,
      name: 'Kaia',
      symbol: 'KAIA',
    },
    rpcUrls: {
      default: {
        http: [
          'https://lb.drpc.org/klaytn/Am5nENoJmEuovqui8_LMxzp4ChJzW7kR8JfPrqRhf0fE',
          'https://go.getblock.io/d7094dbd80ab474ba7042603fe912332',
        ],
        publicHttp: ['https://go.getblock.io/d7094dbd80ab474ba7042603fe912332'],
        webSocket: [
          'wss://lb.drpc.org/klaytn/Am5nENoJmEuovqui8_LMxzp4ChJzW7kR8JfPrqRhf0fE',
          'wss://go.getblock.io/92d6e31d6a47427d9337753b3d48b93e',
        ],
      },
    },
    universe: Universe.ETHEREUM,
  },
  {
    blockExplorers: {
      default: {
        name: 'Etherscan',
        url: 'https://etherscan.io',
      },
    },
    custom: {
      icon: 'https://assets.coingecko.com/asset_platforms/images/279/large/ethereum.png?1706606803',
      knownTokens: [
        {
          contractAddress: '0xdac17f958d2ee523a2206206994597c13d831ec7',
          decimals: 6,
          logo: getLogoFromSymbol('USDT'),
          name: 'Tether USD',
          symbol: 'USDT',
        },
        {
          contractAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
          decimals: 6,
          logo: getLogoFromSymbol('USDC'),
          name: 'USD Coin',
          symbol: 'USDC',
        },
      ],
    },
    id: 1,
    name: 'Ethereum Mainnet',
    nativeCurrency: {
      decimals: 18,
      name: 'Ether',
      symbol: 'ETH',
    },
    rpcUrls: {
      default: {
        http: [
          'https://lb.drpc.org/ethereum/Am5nENoJmEuovqui8_LMxzp4ChJzW7kR8JfPrqRhf0fE',
          'https://ethereum.blockpi.network/v1/rpc/743f126e1720d79033ba70a92c9ea3724380d6bd',
        ],
        publicHttp: [
          'https://cloudflare-eth.com',
          'https://1rpc.io/eth',
          'https://ethereum-rpc.publicnode.com',
          'https://rpc.ankr.com/eth',
          'https://ethereum.blockpi.network/v1/rpc/public',
          'https://rpc.mevblocker.io',
          'https://rpc.mevblocker.io/fast',
        ],
        webSocket: [
          'wss://lb.drpc.org/ethereum/Am5nENoJmEuovqui8_LMxzp4ChJzW7kR8JfPrqRhf0fE',
          'wss://eth.llamarpc.com',
        ],
      },
    },
    universe: Universe.ETHEREUM,
  },
  {
    blockExplorers: {
      default: {
        name: 'Optimism Etherscan',
        url: 'https://optimistic.etherscan.io',
      },
    },
    custom: {
      icon: 'https://assets.coingecko.com/coins/images/25244/large/Optimism.png?1696524385',
      knownTokens: [
        {
          contractAddress: '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58',
          decimals: 6,
          logo: getLogoFromSymbol('USDT'),
          name: 'Tether USD',
          symbol: 'USDT',
        },
        {
          contractAddress: '0x0b2c639c533813f4aa9d7837caf62653d097ff85',
          decimals: 6,
          logo: getLogoFromSymbol('USDC'),
          name: 'USD Coin',
          symbol: 'USDC',
        },
      ],
    },
    id: 10,
    name: 'OP Mainnet',
    nativeCurrency: {
      decimals: 18,
      name: 'Ether',
      symbol: 'ETH',
    },
    rpcUrls: {
      default: {
        http: [
          'https://lb.drpc.org/optimism/Am5nENoJmEuovqui8_LMxzp4ChJzW7kR8JfPrqRhf0fE',
          'https://opt-mainnet.g.alchemy.com/v2/PfaswrKq0rjOrfYWHfE9uLQKhiD4JCdq',
        ],
        publicHttp: [
          'https://mainnet.optimism.io',
          'https://1rpc.io/op',
          'https://optimism-rpc.publicnode.com',
          'https://rpc.ankr.com/optimism',
          'https://optimism.blockpi.network/v1/rpc/public',
          'https://optimism.llamarpc.com',
        ],
        webSocket: [
          'wss://lb.drpc.org/optimism/Am5nENoJmEuovqui8_LMxzp4ChJzW7kR8JfPrqRhf0fE',
          'wss://opt-mainnet.g.alchemy.com/v2/PfaswrKq0rjOrfYWHfE9uLQKhiD4JCdq',
        ],
      },
    },
    universe: Universe.ETHEREUM,
  },
  {
    blockExplorers: {
      default: {
        name: 'Polygonscan',
        url: 'https://polygonscan.com',
      },
    },
    custom: {
      icon: 'https://assets.coingecko.com/asset_platforms/images/15/large/polygon_pos.png?1706606645',
      knownTokens: [
        {
          contractAddress: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f',
          decimals: 6,
          logo: getLogoFromSymbol('USDT'),
          name: 'Tether USD',
          symbol: 'USDT',
        },
        {
          contractAddress: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
          decimals: 6,
          logo: getLogoFromSymbol('USDC'),
          name: 'USD Coin',
          symbol: 'USDC',
        },
      ],
    },
    id: 137,
    name: 'Polygon PoS',
    nativeCurrency: {
      decimals: 18,
      name: 'POL',
      symbol: 'POL',
    },
    rpcUrls: {
      default: {
        http: [
          'https://lb.drpc.org/polygon/Am5nENoJmEuovqui8_LMxzp4ChJzW7kR8JfPrqRhf0fE',
          'https://polygon-mainnet.g.alchemy.com/v2/PfaswrKq0rjOrfYWHfE9uLQKhiD4JCdq',
          'https://polygon.blockpi.network/v1/rpc/07fef5146d885cc0fe07ae6760d486b31e45dcc7',
        ],
        publicHttp: [
          'https://polygon-rpc.com',
          'https://1rpc.io/matic',
          'https://polygon-bor-rpc.publicnode.com',
          'https://rpc.ankr.com/polygon',
          'https://polygon.blockpi.network/v1/rpc/public',
          'https://polygon.llamarpc.com',
        ],
        webSocket: [
          'wss://lb.drpc.org/polygon/Am5nENoJmEuovqui8_LMxzp4ChJzW7kR8JfPrqRhf0fE',
          'wss://polygon-mainnet.g.alchemy.com/v2/PfaswrKq0rjOrfYWHfE9uLQKhiD4JCdq',
        ],
      },
    },
    universe: Universe.ETHEREUM,
  },
  {
    blockExplorers: {
      default: {
        name: 'Basescan',
        url: 'https://basescan.org',
      },
    },
    custom: {
      icon: 'https://assets.coingecko.com/asset_platforms/images/131/large/base-network.png?1720533039',
      knownTokens: [
        {
          contractAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
          decimals: 6,
          logo: getLogoFromSymbol('USDC'),
          name: 'USD Coin',
          symbol: 'USDC',
        },
      ],
    },
    id: 8453,
    name: 'Base',
    nativeCurrency: {
      decimals: 18,
      name: 'Ether',
      symbol: 'ETH',
    },
    rpcUrls: {
      default: {
        http: [
          'https://lb.drpc.org/base/Am5nENoJmEuovqui8_LMxzp4ChJzW7kR8JfPrqRhf0fE',
          'https://base-mainnet.g.alchemy.com/v2/PfaswrKq0rjOrfYWHfE9uLQKhiD4JCdq',
          'https://base.blockpi.network/v1/rpc/dec2a84b57c7779c8b092a7ca9817e6855aa08c6',
        ],
        publicHttp: [
          'https://mainnet.base.org',
          'https://1rpc.io/base',
          'https://base-rpc.publicnode.com',
          'https://rpc.ankr.com/base',
          'https://base.blockpi.network/v1/rpc/public',
          'https://base.llamarpc.com',
        ],
        webSocket: [
          'wss://lb.drpc.org/base/Am5nENoJmEuovqui8_LMxzp4ChJzW7kR8JfPrqRhf0fE',
          'wss://base-mainnet.g.alchemy.com/v2/PfaswrKq0rjOrfYWHfE9uLQKhiD4JCdq',
        ],
      },
    },
    universe: Universe.ETHEREUM,
  },
  {
    blockExplorers: {
      default: {
        name: 'Arbiscan',
        url: 'https://arbiscan.io',
      },
    },
    custom: {
      icon: 'https://assets.coingecko.com/coins/images/16547/large/arb.jpg?1721358242',
      knownTokens: [
        {
          contractAddress: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9',
          decimals: 6,
          logo: getLogoFromSymbol('USDT'),
          name: 'Tether USD',
          symbol: 'USDT',
        },
        {
          contractAddress: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
          decimals: 6,
          logo: getLogoFromSymbol('USDC'),
          name: 'USD Coin',
          symbol: 'USDC',
        },
      ],
    },
    id: 42161,
    name: 'Arbitrum One',
    nativeCurrency: {
      decimals: 18,
      name: 'ETH',
      symbol: 'ETH',
    },
    rpcUrls: {
      default: {
        http: [
          'https://lb.drpc.org/arbitrum/Am5nENoJmEuovqui8_LMxzp4ChJzW7kR8JfPrqRhf0fE',
          'https://arb-mainnet.g.alchemy.com/v2/PfaswrKq0rjOrfYWHfE9uLQKhiD4JCdq',
          'https://arbitrum.blockpi.network/v1/rpc/a8ccd43cdc840c2b2d20c24a058514a21302376d',
        ],
        publicHttp: [
          'https://arb1.arbitrum.io/rpc',
          'https://1rpc.io/arb',
          'https://arbitrum-one-rpc.publicnode.com',
          'https://rpc.ankr.com/arbitrum',
          'https://arbitrum.blockpi.network/v1/rpc/public',
        ],
        webSocket: [
          'wss://lb.drpc.org/arbitrum/Am5nENoJmEuovqui8_LMxzp4ChJzW7kR8JfPrqRhf0fE',
          'wss://arb-mainnet.g.alchemy.com/v2/PfaswrKq0rjOrfYWHfE9uLQKhiD4JCdq',
        ],
      },
    },
    universe: Universe.ETHEREUM,
  },
  {
    blockExplorers: {
      default: {
        name: 'Scrollscan',
        url: 'https://scrollscan.com',
      },
    },
    custom: {
      icon: 'https://assets.coingecko.com/asset_platforms/images/153/large/scroll.jpeg?1706606782',
      knownTokens: [
        {
          contractAddress: '0xf55bec9cafdbe8730f096aa55dad6d22d44099df',
          decimals: 6,
          logo: getLogoFromSymbol('USDT'),
          name: 'Tether USD',
          symbol: 'USDT',
        },
        {
          contractAddress: '0x06efdbff2a14a7c8e15944d1f4a48f9f95f663a4',
          decimals: 6,
          logo: getLogoFromSymbol('USDC'),
          name: 'USD Coin',
          symbol: 'USDC',
        },
      ],
    },
    id: 534352,
    name: 'Scroll',
    nativeCurrency: {
      decimals: 18,
      name: 'Ether',
      symbol: 'ETH',
    },
    rpcUrls: {
      default: {
        http: [
          'https://lb.drpc.org/scroll/Am5nENoJmEuovqui8_LMxzp4ChJzW7kR8JfPrqRhf0fE',
          'https://scroll-mainnet.g.alchemy.com/v2/PfaswrKq0rjOrfYWHfE9uLQKhiD4JCdq',
        ],
        publicHttp: [
          'https://rpc.scroll.io',
          'https://1rpc.io/scroll',
          'https://rpc.ankr.com/scroll',
          'https://scroll-mainnet.public.blastapi.io',
          // "https://scroll.blockpi.network/v1/rpc/public",
          'https://scroll-rpc.publicnode.com',
        ],
        webSocket: [
          'wss://lb.drpc.org/scroll/Am5nENoJmEuovqui8_LMxzp4ChJzW7kR8JfPrqRhf0fE',
          'wss://scroll-mainnet.g.alchemy.com/v2/PfaswrKq0rjOrfYWHfE9uLQKhiD4JCdq',
        ],
      },
    },
    universe: Universe.ETHEREUM,
  },
  {
    blockExplorers: {
      default: {
        name: 'Snowscan',
        url: 'https://snowscan.xyz',
      },
    },
    custom: {
      icon: 'https://assets.coingecko.com/asset_platforms/images/12/large/avalanche.png',
      knownTokens: [
        {
          contractAddress: '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e',
          decimals: 6,
          logo: getLogoFromSymbol('USDC'),
          name: 'USD Coin',
          symbol: 'USDC',
        },
        {
          contractAddress: '0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7',
          decimals: 6,
          logo: getLogoFromSymbol('USDT'),
          name: 'Tether USD',
          symbol: 'USDT',
        },
      ],
    },
    id: 43114,
    name: 'Avalanche C-Chain',
    nativeCurrency: {
      decimals: 18,
      name: 'AVAX',
      symbol: 'AVAX',
    },
    rpcUrls: {
      default: {
        http: [
          'https://lb.drpc.org/avalanche/Am5nENoJmEuovqui8_LMxzp4ChJzW7kR8JfPrqRhf0fE',
          'https://avax-mainnet.g.alchemy.com/v2/PfaswrKq0rjOrfYWHfE9uLQKhiD4JCdq',
        ],
        publicHttp: [
          'https://1rpc.io/avax/c',
          'https://avalanche-c-chain-rpc.publicnode.com',
          'https://ava-mainnet.public.blastapi.io/ext/bc/C/rpc',
          'https://rpc.ankr.com/avalanche',
          'https://avalanche-mainnet.gateway.tenderly.co',
        ],
        webSocket: [
          'wss://lb.drpc.org/avalanche/Am5nENoJmEuovqui8_LMxzp4ChJzW7kR8JfPrqRhf0fE',
          'wss://avax-mainnet.g.alchemy.com/v2/PfaswrKq0rjOrfYWHfE9uLQKhiD4JCdq',
        ],
      },
    },
    universe: Universe.ETHEREUM,
  },
  {
    blockExplorers: {
      default: {
        name: 'BscScan',
        url: 'https://bscscan.com',
      },
    },
    custom: {
      icon: 'https://assets.coingecko.com/asset_platforms/images/1/large/bnb_smart_chain.png',
      knownTokens: [
        {
          contractAddress: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
          decimals: 18,
          logo: getLogoFromSymbol('USDC'),
          name: 'USD Coin',
          symbol: 'USDC',
        },
        {
          contractAddress: '0x55d398326f99059fF775485246999027B3197955',
          decimals: 18,
          logo: getLogoFromSymbol('USDT'),
          name: 'Tether USD',
          symbol: 'USDT',
        },
        {
          contractAddress: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
          decimals: 18,
          logo: getLogoFromSymbol('ETH'),
          name: 'Ether',
          symbol: 'ETH',
        },
      ],
    },
    id: 0x38,
    name: 'BNB Smart Chain',
    nativeCurrency: {
      decimals: 18,
      name: 'BNB',
      symbol: 'BNB',
    },
    rpcUrls: {
      default: {
        http: [
          'https://lb.drpc.org/bsc/Am5nENoJmEuovqui8_LMxzp4ChJzW7kR8JfPrqRhf0fE',
          'https://bnb-mainnet.g.alchemy.com/v2/PfaswrKq0rjOrfYWHfE9uLQKhiD4JCdq',
        ],
        publicHttp: [
          'https://1rpc.io/bnb',
          'https://bsc-rpc.publicnode.com',
          'https://bsc-mainnet.public.blastapi.io',
          'https://bsc.drpc.org',
          'https://bsc.blockrazor.xyz',
        ],
        webSocket: [
          'wss://lb.drpc.org/bsc/Am5nENoJmEuovqui8_LMxzp4ChJzW7kR8JfPrqRhf0fE',
          'wss://bnb-mainnet.g.alchemy.com/v2/PfaswrKq0rjOrfYWHfE9uLQKhiD4JCdq',
        ],
      },
    },
    universe: Universe.ETHEREUM,
  },
  {
    blockExplorers: {
      default: {
        name: 'Hyperscan',
        url: 'https://hyperscan.com',
      },
    },
    custom: {
      icon: 'https://assets.coingecko.com/asset_platforms/images/243/large/hyperliquid.png',
      knownTokens: [
        {
          contractAddress: '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb',
          decimals: 6,
          logo: getLogoFromSymbol('USDT'),
          name: 'Tether USD',
          symbol: 'USDT',
        },
        {
          contractAddress: '0xb88339CB7199b77E23DB6E890353E22632Ba630f',
          decimals: 6,
          logo: getLogoFromSymbol('USDC'),
          name: 'USD Coin',
          symbol: 'USDC',
        },
      ],
    },
    id: HYPEREVM_CHAIN_ID,
    name: 'HyperEVM',
    nativeCurrency: {
      decimals: 18,
      name: 'HYPE',
      symbol: 'HYPE',
    },
    rpcUrls: {
      default: {
        http: [
          // Not supported by Alchemy
          'https://hyperliquid.drpc.org',
          'https://lb.drpc.org/hyperliquid/Am5nENoJmEuovqui8_LMxzp4ChJzW7kR8JfPrqRhf0fE',
        ],
        publicHttp: [
          'https://hyperliquid-json-rpc.stakely.io',
          'https://rpc.hyperlend.finance',
          'https://rpc.hypurrscan.io',
        ],
        webSocket: ['wss://hyperliquid.drpc.org'],
      },
    },
    universe: Universe.ETHEREUM,
  },
];

export { ChainList, KAIA_CHAIN_ID, SOPHON_CHAIN_ID };
