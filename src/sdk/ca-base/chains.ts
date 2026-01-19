import {
  type ChainIDKeyedMap,
  Environment,
  getVaultContractMap,
  OmniversalChainID,
  Universe,
} from '@avail-project/ca-common';
import type { Hex } from 'viem';
import {
  type Chain,
  SUPPORTED_CHAINS,
  TOKEN_CONTRACT_ADDRESSES,
  type TokenInfo,
} from '../../commons';
import { getLogoFromSymbol, ZERO_ADDRESS } from './constants';
import { Errors } from './errors';
import { convertToHexAddressByUniverse, equalFold } from './utils';

class ChainList {
  public chains: Chain[];
  private readonly vcm: ChainIDKeyedMap<Buffer<ArrayBufferLike>>;

  constructor(env: Environment) {
    switch (env) {
      case Environment.JADE:
      case Environment.CORAL:
      case Environment.CERISE:
        this.chains = MAINNET_CHAINS;
        break;
      case Environment.FOLLY:
        this.chains = TESTNET_CHAINS;
        break;
      default:
        throw Errors.environmentNotKnown();
    }
    this.vcm = getVaultContractMap(env);
  }

  public getChainByID(id: number) {
    return this.chains.find((c) => c.id === id);
  }

  public getNativeToken(chainID: number): TokenInfo {
    const chain = this.getChainByID(chainID);
    if (!chain) {
      throw Errors.chainNotFound(chainID);
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
    const result = this.getChainAndTokenByAddress(chainID, address);
    if (result) {
      return result.token;
    }
    return undefined;
  }

  public getChainAndTokenByAddress(chainID: number, address: Hex) {
    const chain = this.getChainByID(chainID);
    if (!chain) {
      return undefined;
    }
    const token = chain.custom.knownTokens.find((t) => equalFold(t.contractAddress, address));

    if (!token) {
      if (equalFold(address, ZERO_ADDRESS)) {
        return { chain, token: this.getNativeToken(chainID) };
      }
    }
    return { chain, token };
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

  public getChainAndTokenFromSymbol(
    chainID: number,
    tokenSymbol: string
  ): { chain: Chain; token: (TokenInfo & { isNative: boolean }) | undefined } {
    const chain = this.getChainByID(chainID);
    if (!chain) {
      throw Errors.chainNotFound(chainID);
    }

    const token = chain.custom.knownTokens.find((t) => equalFold(t.symbol, tokenSymbol));
    if (!token) {
      if (equalFold(chain.nativeCurrency.symbol, tokenSymbol)) {
        return {
          token: {
            contractAddress: ZERO_ADDRESS,
            decimals: chain.nativeCurrency.decimals,
            logo: chain.custom.icon,
            name: chain.nativeCurrency.name,
            symbol: chain.nativeCurrency.symbol,
            isNative: true,
          },
          chain,
        };
      }
    }
    return { chain, token: token ? { ...token, isNative: false } : undefined };
  }

  public getVaultContractAddress(chainID: number) {
    const chain = this.getChainByID(chainID);
    if (!chain) {
      throw Errors.chainNotFound(chainID);
    }

    const omniversalChainID = new OmniversalChainID(chain.universe, chainID);

    const vc = this.vcm.get(omniversalChainID);
    if (!vc) {
      throw Errors.vaultContractNotFound(chainID);
    }

    return convertToHexAddressByUniverse(vc, chain.universe);
  }

  getAnkrNameList() {
    return this.chains.map((c) => c.ankrName).filter((n) => n !== '');
  }
}

const TESTNET_CHAINS: Chain[] = [
  // {
  //   blockExplorers: {
  //     default: {
  //       name: 'TronScan',
  //       url: 'https://shasta.tronscan.org',
  //     },
  //   },
  //   custom: {
  //     icon: 'https://assets.coingecko.com/asset_platforms/images/1094/large/TRON_LOGO.png',
  //     knownTokens: [
  //       {
  //         contractAddress: TOKEN_CONTRACT_ADDRESSES['USDT'][SUPPORTED_CHAINS.TRON_SHASTA],
  //         decimals: 6,
  //         logo: getLogoFromSymbol('USDT'),
  //         name: 'Tether USD',
  //         symbol: 'USDT',
  //       },
  //     ],
  //   },
  //   id: SUPPORTED_CHAINS.TRON_SHASTA,
  //   ankrName: '',
  //   name: 'Tron Shasta',
  //   nativeCurrency: {
  //     decimals: 6,
  //     name: 'TRX',
  //     symbol: 'TRX',
  //   },
  //   rpcUrls: {
  //     default: {
  //       http: ['https://api.shasta.trongrid.io/jsonrpc'],
  //       grpc: ['https://api.shasta.trongrid.io'],
  //       publicHttp: ['https://api.shasta.trongrid.io/jsonrpc'],
  //       webSocket: [],
  //     },
  //   },
  //   universe: Universe.TRON,
  // },
  {
    blockExplorers: {
      default: {
        name: 'Arbitrum Sepolia Explorer',
        url: 'https://sepolia.arbiscan.io/',
      },
    },
    custom: {
      icon: 'https://assets.coingecko.com/coins/images/16547/large/arb.jpg',
      knownTokens: [
        {
          contractAddress: TOKEN_CONTRACT_ADDRESSES.USDC[SUPPORTED_CHAINS.ARBITRUM_SEPOLIA],
          decimals: 6,
          logo: getLogoFromSymbol('USDC'),
          name: 'USD Coin',
          symbol: 'USDC',
        },
        {
          contractAddress: TOKEN_CONTRACT_ADDRESSES.USDT[SUPPORTED_CHAINS.ARBITRUM_SEPOLIA],
          decimals: 18,
          logo: getLogoFromSymbol('USDT'),
          name: 'Testing USD',
          symbol: 'USDT',
        },
      ],
    },
    id: SUPPORTED_CHAINS.ARBITRUM_SEPOLIA,
    name: 'Arbitrum Sepolia',
    ankrName: '',
    nativeCurrency: {
      decimals: 18,
      name: 'Ether',
      symbol: 'ETH',
    },
    rpcUrls: {
      default: {
        http: ['https://rpcs.avail.so/arbitrumsepolia'],
        publicHttp: [
          'https://public.stackup.sh/api/v1/node/arbitrum-sepolia',
          'https://arbitrum-sepolia.gateway.tenderly.co',
        ],
        webSocket: ['wss://rpcs.avail.so/arbitrumsepolia'],
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
      icon: 'https://assets.coingecko.com/coins/images/25244/large/Optimism.png',
      knownTokens: [
        {
          contractAddress: TOKEN_CONTRACT_ADDRESSES.USDC[SUPPORTED_CHAINS.OPTIMISM_SEPOLIA],
          decimals: 6,
          logo: getLogoFromSymbol('USDC'),
          name: 'USD Coin',
          symbol: 'USDC',
        },
        {
          contractAddress: TOKEN_CONTRACT_ADDRESSES.USDT[SUPPORTED_CHAINS.OPTIMISM_SEPOLIA],
          decimals: 18,
          logo: getLogoFromSymbol('USDT'),
          name: 'Testing USD',
          symbol: 'USDT',
        },
      ],
    },
    id: SUPPORTED_CHAINS.OPTIMISM_SEPOLIA,
    name: 'OP Sepolia',
    ankrName: '',
    nativeCurrency: {
      decimals: 18,
      name: 'Ether',
      symbol: 'ETH',
    },
    rpcUrls: {
      default: {
        http: ['https://rpcs.avail.so/optimismsepolia'],
        publicHttp: [
          'https://endpoints.omniatech.io/v1/op/sepolia/public',
          'https://optimism-sepolia.gateway.tenderly.co',
        ],
        webSocket: ['wss://rpcs.avail.so/optimismsepolia'],
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
      icon: 'https://assets.coingecko.com/asset_platforms/images/15/large/polygon_pos.png',
      knownTokens: [
        {
          contractAddress: TOKEN_CONTRACT_ADDRESSES.USDC[SUPPORTED_CHAINS.POLYGON_AMOY],
          decimals: 6,
          logo: getLogoFromSymbol('USDC'),
          name: 'USD Coin',
          symbol: 'USDC',
        },
      ],
    },
    id: SUPPORTED_CHAINS.POLYGON_AMOY,
    name: 'Amoy',
    ankrName: '',
    nativeCurrency: {
      decimals: 18,
      name: 'POL',
      symbol: 'POL',
    },
    rpcUrls: {
      default: {
        http: ['https://rpcs.avail.so/polygonamoy'],
        publicHttp: [
          'https://polygon-amoy-bor-rpc.publicnode.com',
          'https://rpc-amoy.polygon.technology',
        ],
        webSocket: ['wss://rpcs.avail.so/polygonamoy'],
      },
    },
    universe: Universe.ETHEREUM,
  },
  {
    blockExplorers: {
      default: {
        name: 'Base Sepolia Scan',
        url: 'https://sepolia.basescan.org/',
      },
    },
    custom: {
      icon: 'https://assets.coingecko.com/asset_platforms/images/131/large/base-network.png',
      knownTokens: [
        {
          contractAddress: TOKEN_CONTRACT_ADDRESSES.USDC[SUPPORTED_CHAINS.BASE_SEPOLIA],
          decimals: 6,
          logo: getLogoFromSymbol('USDC'),
          name: 'USD Coin',
          symbol: 'USDC',
        },
      ],
    },
    id: SUPPORTED_CHAINS.BASE_SEPOLIA,
    name: 'Base Sepolia',
    ankrName: '',
    nativeCurrency: {
      decimals: 18,
      name: 'Ether',
      symbol: 'ETH',
    },
    rpcUrls: {
      default: {
        http: ['https://rpcs.avail.so/basesepolia'],
        publicHttp: [
          'https://rpc.notadegen.com/base/sepolia',
          'https://public.stackup.sh/api/v1/node/base-sepolia',
        ],
        webSocket: ['wss://rpcs.avail.so/basesepolia'],
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
      icon: 'https://assets.coingecko.com/coins/images/38927/standard/monad.jpg',
      knownTokens: [
        {
          contractAddress: TOKEN_CONTRACT_ADDRESSES.USDC[SUPPORTED_CHAINS.MONAD_TESTNET],
          decimals: 6,
          logo: getLogoFromSymbol('USDC'),
          name: 'USD Coin',
          symbol: 'USDC',
        },
        {
          contractAddress: TOKEN_CONTRACT_ADDRESSES.USDT[SUPPORTED_CHAINS.MONAD_TESTNET],
          decimals: 18,
          logo: getLogoFromSymbol('USDT'),
          name: 'Testing USDT',
          symbol: 'USDT',
        },
      ],
    },
    id: SUPPORTED_CHAINS.MONAD_TESTNET,
    name: 'Monad Testnet',
    ankrName: '',
    nativeCurrency: {
      decimals: 18,
      name: 'Monad',
      symbol: 'MON',
    },
    rpcUrls: {
      default: {
        http: ['https://rpcs.avail.so/monadtestnet'],
        publicHttp: ['https://monad-testnet.drpc.org', 'https://rpc.ankr.com/monad_testnet'],
        webSocket: ['wss://rpcs.avail.so/monadtestnet'],
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
      icon: 'https://assets.coingecko.com/asset_platforms/images/279/large/ethereum.png',
      knownTokens: [
        {
          contractAddress: TOKEN_CONTRACT_ADDRESSES.USDC[SUPPORTED_CHAINS.SEPOLIA],
          decimals: 6,
          logo: getLogoFromSymbol('USDC'),
          name: 'USD Coin',
          symbol: 'USDC',
        },
      ],
    },
    id: SUPPORTED_CHAINS.SEPOLIA,
    name: 'Ethereum Sepolia',
    ankrName: '',
    nativeCurrency: {
      decimals: 18,
      name: 'Ether',
      symbol: 'ETH',
    },
    rpcUrls: {
      default: {
        http: ['https://rpcs.avail.so/sepolia'],
        publicHttp: [
          'https://api.zan.top/eth-sepolia',
          'https://ethereum-sepolia-public.nodies.app',
        ],
        webSocket: ['wss://rpcs.avail.so/sepolia'],
      },
    },
    universe: Universe.ETHEREUM,
  },
  // {
  //   blockExplorers: {
  //     default: {
  //       name: 'Validium Testnet Explorer',
  //       url: 'https://testnet.explorer.validium.network',
  //     },
  //   },
  //   custom: {
  //     icon: 'https://assets.coingecko.com/asset_platforms/images/279/large/ethereum.png',
  //     knownTokens: [
  //       {
  //         contractAddress: TOKEN_CONTRACT_ADDRESSES['USDC'][SUPPORTED_CHAINS.VALIDIUM_TESTNET],
  //         decimals: 6,
  //         logo: getLogoFromSymbol('USDC'),
  //         name: 'USD Coin',
  //         symbol: 'USDC',
  //       },
  //     ],
  //   },
  //   id: SUPPORTED_CHAINS.VALIDIUM_TESTNET,
  //   name: 'Validium Testnet',
  //   ankrName: '',
  //   nativeCurrency: {
  //     decimals: 18,
  //     name: 'VLDM',
  //     symbol: 'VLDM',
  //   },
  //   rpcUrls: {
  //     default: {
  //       http: ['https://testnet.l2.rpc.validium.network'],
  //       publicHttp: ['https://testnet.l2.rpc.validium.network'],
  //       webSocket: ['wss://testnet.l2.rpc.validium.network/ws'],
  //     },
  //   },
  //   universe: Universe.ETHEREUM,
  // },
];

const MAINNET_CHAINS: Chain[] = [
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
          contractAddress: TOKEN_CONTRACT_ADDRESSES.USDT[SUPPORTED_CHAINS.SOPHON],
          decimals: 6,
          logo: getLogoFromSymbol('USDT'),
          name: 'Tether USD',
          symbol: 'USDT',
        },
        {
          contractAddress: TOKEN_CONTRACT_ADDRESSES.USDC[SUPPORTED_CHAINS.SOPHON],
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
    id: SUPPORTED_CHAINS.SOPHON,
    name: 'Sophon',
    ankrName: '',
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
          contractAddress: TOKEN_CONTRACT_ADDRESSES.USDT[SUPPORTED_CHAINS.KAIA],
          decimals: 6,
          logo: getLogoFromSymbol('USDT'),
          name: 'Tether USD',
          symbol: 'USDT',
        },
      ],
    },
    id: SUPPORTED_CHAINS.KAIA,
    name: 'Kaia Mainnet',
    ankrName: '',
    nativeCurrency: {
      decimals: 18,
      name: 'Kaia',
      symbol: 'KAIA',
    },
    rpcUrls: {
      default: {
        http: ['https://rpcs.avail.so/kaia'],
        publicHttp: ['https://go.getblock.io/d7094dbd80ab474ba7042603fe912332'],
        webSocket: ['wss://rpcs.avail.so/kaia'],
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
      icon: 'https://assets.coingecko.com/asset_platforms/images/279/large/ethereum.png',
      knownTokens: [
        {
          contractAddress: TOKEN_CONTRACT_ADDRESSES.USDT[SUPPORTED_CHAINS.ETHEREUM],
          decimals: 6,
          logo: getLogoFromSymbol('USDT'),
          name: 'Tether USD',
          symbol: 'USDT',
        },
        {
          contractAddress: TOKEN_CONTRACT_ADDRESSES.USDC[SUPPORTED_CHAINS.ETHEREUM],
          decimals: 6,
          logo: getLogoFromSymbol('USDC'),
          name: 'USD Coin',
          symbol: 'USDC',
        },
      ],
    },
    id: SUPPORTED_CHAINS.ETHEREUM,
    name: 'Ethereum Mainnet',
    ankrName: '',
    nativeCurrency: {
      decimals: 18,
      name: 'Ether',
      symbol: 'ETH',
    },
    rpcUrls: {
      default: {
        http: ['https://rpcs.avail.so/eth'],
        publicHttp: ['https://cloudflare-eth.com', 'https://1rpc.io/eth'],
        webSocket: ['wss://rpcs.avail.so/eth'],
      },
    },
    universe: Universe.ETHEREUM,
  },
  {
    blockExplorers: {
      default: {
        name: 'MegaETH Blockscout',
        url: 'https://megaeth.blockscout.com/',
      },
    },
    custom: {
      icon: 'https://assets.coingecko.com/coins/images/69995/large/ICON.png',
      knownTokens: [
        {
          contractAddress: TOKEN_CONTRACT_ADDRESSES.USDM[SUPPORTED_CHAINS.MEGAETH],
          decimals: 6,
          logo: getLogoFromSymbol('USDM'),
          name: 'Mountain Protocol USD',
          symbol: 'USDM',
        },
      ],
    },
    id: SUPPORTED_CHAINS.MEGAETH,
    name: 'MegaETH',
    ankrName: '',
    nativeCurrency: {
      decimals: 18,
      name: 'Ether',
      symbol: 'ETH',
    },
    rpcUrls: {
      default: {
        http: ['https://rpcs.avail.so/megaeth'],
        publicHttp: [],
        webSocket: ['wss://rpcs.avail.so/megaeth'],
      },
    },
    universe: Universe.ETHEREUM,
  },
  {
    blockExplorers: {
      default: {
        name: 'Monad Vision',
        url: 'https://monadvision.com',
      },
    },
    custom: {
      icon: 'https://assets.coingecko.com/coins/images/38927/large/monad.jpg',
      knownTokens: [
        {
          contractAddress: TOKEN_CONTRACT_ADDRESSES.USDC[SUPPORTED_CHAINS.MONAD],
          decimals: 6,
          logo: getLogoFromSymbol('USDC'),
          name: 'USD Coin',
          symbol: 'USDC',
        },
      ],
    },
    id: SUPPORTED_CHAINS.MONAD,
    name: 'Monad',
    ankrName: '',
    nativeCurrency: {
      decimals: 18,
      name: 'Monad',
      symbol: 'MON',
    },
    rpcUrls: {
      default: {
        http: ['https://rpcs.avail.so/monad'],
        publicHttp: [],
        webSocket: ['wss://rpcs.avail.so/monad'],
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
      icon: 'https://assets.coingecko.com/coins/images/25244/large/Optimism.png',
      knownTokens: [
        {
          contractAddress: TOKEN_CONTRACT_ADDRESSES.USDT[SUPPORTED_CHAINS.OPTIMISM],
          decimals: 6,
          logo: getLogoFromSymbol('USDT'),
          name: 'Tether USD',
          symbol: 'USDT',
        },
        {
          contractAddress: TOKEN_CONTRACT_ADDRESSES.USDC[SUPPORTED_CHAINS.OPTIMISM],
          decimals: 6,
          logo: getLogoFromSymbol('USDC'),
          name: 'USD Coin',
          symbol: 'USDC',
        },
      ],
    },
    id: SUPPORTED_CHAINS.OPTIMISM,
    name: 'OP Mainnet',
    ankrName: 'optimism',
    nativeCurrency: {
      decimals: 18,
      name: 'Ether',
      symbol: 'ETH',
    },
    rpcUrls: {
      default: {
        http: ['https://rpcs.avail.so/optimism'],
        publicHttp: ['https://mainnet.optimism.io', 'https://1rpc.io/op'],
        webSocket: ['wss://rpcs.avail.so/optimism'],
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
      icon: 'https://assets.coingecko.com/asset_platforms/images/15/large/polygon_pos.png',
      knownTokens: [
        {
          contractAddress: TOKEN_CONTRACT_ADDRESSES.USDT[SUPPORTED_CHAINS.POLYGON],
          decimals: 6,
          logo: getLogoFromSymbol('USDT'),
          name: 'Tether USD',
          symbol: 'USDT',
        },
        {
          contractAddress: TOKEN_CONTRACT_ADDRESSES.USDC[SUPPORTED_CHAINS.POLYGON],
          decimals: 6,
          logo: getLogoFromSymbol('USDC'),
          name: 'USD Coin',
          symbol: 'USDC',
        },
      ],
    },
    id: SUPPORTED_CHAINS.POLYGON,
    name: 'Polygon PoS',
    ankrName: 'polygon',
    nativeCurrency: {
      decimals: 18,
      name: 'POL',
      symbol: 'POL',
    },
    rpcUrls: {
      default: {
        http: ['https://rpcs.avail.so/polygon'],
        publicHttp: ['https://polygon-rpc.com', 'https://1rpc.io/matic'],
        webSocket: ['wss://rpcs.avail.so/polygon'],
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
      icon: 'https://assets.coingecko.com/asset_platforms/images/131/large/base-network.png',
      knownTokens: [
        {
          contractAddress: TOKEN_CONTRACT_ADDRESSES.USDC[SUPPORTED_CHAINS.BASE],
          decimals: 6,
          logo: getLogoFromSymbol('USDC'),
          name: 'USD Coin',
          symbol: 'USDC',
        },
      ],
    },
    id: SUPPORTED_CHAINS.BASE,
    name: 'Base',
    ankrName: 'base',
    nativeCurrency: {
      decimals: 18,
      name: 'Ether',
      symbol: 'ETH',
    },
    rpcUrls: {
      default: {
        http: ['https://rpcs.avail.so/base'],
        publicHttp: ['https://mainnet.base.org', 'https://1rpc.io/base'],
        webSocket: ['wss://rpcs.avail.so/base'],
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
      icon: 'https://assets.coingecko.com/coins/images/16547/large/arb.jpg',
      knownTokens: [
        {
          contractAddress: TOKEN_CONTRACT_ADDRESSES.USDT[SUPPORTED_CHAINS.ARBITRUM],
          decimals: 6,
          logo: getLogoFromSymbol('USDT'),
          name: 'Tether USD',
          symbol: 'USDT',
        },
        {
          contractAddress: TOKEN_CONTRACT_ADDRESSES.USDC[SUPPORTED_CHAINS.ARBITRUM],
          decimals: 6,
          logo: getLogoFromSymbol('USDC'),
          name: 'USD Coin',
          symbol: 'USDC',
        },
      ],
    },
    id: SUPPORTED_CHAINS.ARBITRUM,
    name: 'Arbitrum One',
    ankrName: 'arbitrum',
    nativeCurrency: {
      decimals: 18,
      name: 'ETH',
      symbol: 'ETH',
    },
    rpcUrls: {
      default: {
        http: ['https://rpcs.avail.so/arbitrum'],
        publicHttp: ['https://arb1.arbitrum.io/rpc', 'https://1rpc.io/arb'],
        webSocket: ['wss://rpcs.avail.so/arbitrum'],
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
      icon: 'https://assets.coingecko.com/asset_platforms/images/153/large/scroll.jpeg',
      knownTokens: [
        {
          contractAddress: TOKEN_CONTRACT_ADDRESSES.USDT[SUPPORTED_CHAINS.SCROLL],
          decimals: 6,
          logo: getLogoFromSymbol('USDT'),
          name: 'Tether USD',
          symbol: 'USDT',
        },
        {
          contractAddress: TOKEN_CONTRACT_ADDRESSES.USDC[SUPPORTED_CHAINS.SCROLL],
          decimals: 6,
          logo: getLogoFromSymbol('USDC'),
          name: 'USD Coin',
          symbol: 'USDC',
        },
      ],
    },
    id: SUPPORTED_CHAINS.SCROLL,
    name: 'Scroll',
    ankrName: 'scroll',
    nativeCurrency: {
      decimals: 18,
      name: 'Ether',
      symbol: 'ETH',
    },
    rpcUrls: {
      default: {
        http: ['https://rpcs.avail.so/scroll'],
        publicHttp: ['https://rpc.scroll.io', 'https://1rpc.io/scroll'],
        webSocket: ['wss://rpcs.avail.so/scroll'],
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
          contractAddress: TOKEN_CONTRACT_ADDRESSES.USDC[SUPPORTED_CHAINS.AVALANCHE],
          decimals: 6,
          logo: getLogoFromSymbol('USDC'),
          name: 'USD Coin',
          symbol: 'USDC',
        },
        {
          contractAddress: TOKEN_CONTRACT_ADDRESSES.USDT[SUPPORTED_CHAINS.AVALANCHE],
          decimals: 6,
          logo: getLogoFromSymbol('USDT'),
          name: 'Tether USD',
          symbol: 'USDT',
        },
      ],
    },
    id: SUPPORTED_CHAINS.AVALANCHE,
    ankrName: 'avalanche',
    name: 'Avalanche C-Chain',
    nativeCurrency: {
      decimals: 18,
      name: 'AVAX',
      symbol: 'AVAX',
    },
    rpcUrls: {
      default: {
        http: ['https://rpcs.avail.so/avalanche'],
        publicHttp: ['https://1rpc.io/avax/c', 'https://avalanche-c-chain-rpc.publicnode.com'],
        webSocket: ['wss://rpcs.avail.so/avalanche'],
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
          contractAddress: TOKEN_CONTRACT_ADDRESSES.USDC[SUPPORTED_CHAINS.BNB],
          decimals: 18,
          logo: getLogoFromSymbol('USDC'),
          name: 'USD Coin',
          symbol: 'USDC',
        },
        {
          contractAddress: TOKEN_CONTRACT_ADDRESSES.USDT[SUPPORTED_CHAINS.BNB],
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
    id: SUPPORTED_CHAINS.BNB,
    name: 'BNB Smart Chain',
    ankrName: 'bsc',
    nativeCurrency: {
      decimals: 18,
      name: 'BNB',
      symbol: 'BNB',
    },
    rpcUrls: {
      default: {
        http: ['https://rpcs.avail.so/bsc'],
        publicHttp: ['https://1rpc.io/bnb', 'https://bsc-rpc.publicnode.com'],
        webSocket: ['wss://rpcs.avail.so/bsc'],
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
          contractAddress: TOKEN_CONTRACT_ADDRESSES.USDT[SUPPORTED_CHAINS.HYPEREVM],
          decimals: 6,
          logo: getLogoFromSymbol('USDT'),
          name: 'Tether USD',
          symbol: 'USDT',
        },
        {
          contractAddress: TOKEN_CONTRACT_ADDRESSES.USDC[SUPPORTED_CHAINS.HYPEREVM],
          decimals: 6,
          logo: getLogoFromSymbol('USDC'),
          name: 'USD Coin',
          symbol: 'USDC',
        },
      ],
    },
    id: SUPPORTED_CHAINS.HYPEREVM,
    ankrName: '',
    name: 'HyperEVM',
    nativeCurrency: {
      decimals: 18,
      name: 'HYPE',
      symbol: 'HYPE',
    },
    rpcUrls: {
      default: {
        http: ['https://rpcs.avail.so/hyperevm'],
        publicHttp: ['https://hyperliquid-json-rpc.stakely.io', 'https://rpc.hyperlend.finance'],
        webSocket: ['wss://rpcs.avail.so/hyperevm'],
      },
    },
    universe: Universe.ETHEREUM,
  },
  // {
  //   blockExplorers: {
  //     default: {
  //       name: 'TronScan',
  //       url: 'https://tronscan.org',
  //     },
  //   },
  //   custom: {
  //     icon: 'https://assets.coingecko.com/asset_platforms/images/1094/large/TRON_LOGO.png',
  //     knownTokens: [
  //       {
  //         contractAddress: TOKEN_CONTRACT_ADDRESSES['USDT'][SUPPORTED_CHAINS.TRON],
  //         decimals: 6,
  //         logo: getLogoFromSymbol('USDT'),
  //         name: 'Tether USD',
  //         symbol: 'USDT',
  //       },
  //     ],
  //   },
  //   id: SUPPORTED_CHAINS.TRON,
  //   ankrName: '',
  //   name: 'Tron mainnet',
  //   nativeCurrency: {
  //     decimals: 6,
  //     name: 'TRX',
  //     symbol: 'TRX',
  //   },
  //   rpcUrls: {
  //     default: {
  //       http: ['https://api.trongrid.io/jsonrpc'],
  //       grpc: ['https://api.trongrid.io'],
  //       publicHttp: ['https://api.trongrid.io/jsonrpc', 'https://tron.therpc.io/jsonrpc'],
  //       webSocket: ['wss://tron.drpc.org'],
  //     },
  //   },
  //   universe: Universe.TRON,
  // },
];

export { ChainList };
