import { Universe } from '@arcana/ca-common';

import { convertTo32BytesHex } from './utils';

const KAIA_CHAIN_ID = 8217;
const SOPHON_CHAIN_ID = 50104;
const HYPEREVM_CHAIN_ID = 0x3e7;
const MONAD_TESTNET_CHAIN_ID = 10143;

const FUEL_NETWORK_URL = 'https://mainnet.fuel.network/v1/graphql';

const SymbolToLogo: { [k: string]: string } = {
  BNB: 'https://assets.coingecko.com/coins/images/825/large/bnb-icon2_2x.png',
  AVAX: 'https://assets.coingecko.com/coins/images/12559/standard/Avalanche_Circle_RedWhite_Trans.png',
  ETH: 'https://coin-images.coingecko.com/coins/images/279/large/ethereum.png',
  KAIA: 'https://assets.coingecko.com/coins/images/39901/large/KAIA.png',
  MATIC: 'https://coin-images.coingecko.com/coins/images/32440/standard/polygon.png',
  MON: 'https://assets.coingecko.com/coins/images/38927/large/monad.jpg',
  POL: 'https://coin-images.coingecko.com/coins/images/32440/standard/polygon.png',
  SOPH: 'https://assets.coingecko.com/coins/images/38680/large/sophon_logo_200.png',
  USDC: 'https://coin-images.coingecko.com/coins/images/6319/large/usdc.png',
  USDT: 'https://coin-images.coingecko.com/coins/images/35023/large/USDT.png',
  WETH: 'https://coin-images.coingecko.com/coins/images/2518/standard/weth.png',
  HYPE: 'https://assets.coingecko.com/coins/images/50882/large/hyperliquid.jpg',
};

const FUEL_BASE_ASSET_ID = '0xf8f8b6283d7fa5b672b530cbb84fcccb4ff8dc40f8176ef4544ddb1f1952ad07';

const getLogoFromSymbol = (symbol: string) => {
  const logo = SymbolToLogo[symbol];
  if (!logo) {
    return '';
  }

  return logo;
};

const isNativeAddress = (universe: Universe, address: `0x${string}`) => {
  if (universe === Universe.ETHEREUM) {
    return address === ZERO_ADDRESS || address === ZERO_ADDRESS_FUEL;
  }

  if (universe === Universe.FUEL) {
    return address === FUEL_BASE_ASSET_ID;
  }

  // Handle other universes or return false by default
  return false;
};

const INTENT_EXPIRY = 15 * 60 * 1000;

const AaveTokenContracts: {
  [key: number]: {
    [symbol: string]: `0x${string}`;
  };
} = {
  1: {
    USDC: '0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c',
    USDT: '0x23878914EFE38d27C4D67Ab83ed1b93A74D4086a',
    WETH: '0x4d5F47FA6A74757f35C14fD3a6Ef8E3C9BC514E8',
  },
  10: {
    USDC: '0x38d693cE1dF5AaDF7bC62595A37D667aD57922e5',
    USDT: '0x6ab707Aca953eDAeFBc4fD23bA73294241490620',
    WETH: '0xe50fA9b3c56FfB159cB0FCA61F5c9D750e8128c8',
  },
  11155420: {
    USDC: '0xa818F1B57c201E092C4A2017A91815034326Efd1',
  },
  137: {
    USDC: '0xA4D94019934D8333Ef880ABFFbF2FDd611C762BD',
    USDT: '0x6ab707Aca953eDAeFBc4fD23bA73294241490620',
    WETH: '0xe50fA9b3c56FfB159cB0FCA61F5c9D750e8128c8',
  },
  42161: {
    USDC: '0x724dc807b04555b71ed48a6896b6F41593b8C637',
    USDT: '0x6ab707Aca953eDAeFBc4fD23bA73294241490620',
    WETH: '0xe50fA9b3c56FfB159cB0FCA61F5c9D750e8128c8',
  },
  // Testnet chains
  421614: {
    USDC: '0x460b97BD498E1157530AEb3086301d5225b91216',
  },
  43114: {
    USDC: '0x625E7708f30cA75bfd92586e17077590C60eb4cD',
    USDT: '0x6ab707Aca953eDAeFBc4fD23bA73294241490620',
    WETH: '0xe50fA9b3c56FfB159cB0FCA61F5c9D750e8128c8',
  },
  534352: {
    USDC: '0x1D738a3436A8C49CefFbaB7fbF04B660fb528CbD',
    WETH: '0xf301805bE1Df81102C957f6d4Ce29d2B8c056B2a',
  },
  56: {
    USDC: '0x00901a076785e0906d1028c7d6372d247bec7d61',
    USDT: '0xa9251ca9DE909CB71783723713B21E4233fbf1B1',
  },
  59144: {
    USDC: '0x374D7860c4f2f604De0191298dD393703Cce84f3',
    USDT: '0x88231dfEC71D4FF5c1e466D08C321944A7adC673',
    WETH: '0x787897dF92703BB3Fc4d9Ee98e15C0b8130Bf163',
  },
  8453: {
    USDC: '0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB',
    WETH: '0x7C307e128efA31F540F2E2d976C995E0B65F51F6',
  },
  84532: {
    USDC: '0x10F1A9D11CDf50041f3f8cB7191CBE2f31750ACC',
    USDT: '0xcE3CAae5Ed17A7AafCEEbc897DE843fA6CC0c018',
  },
};

const TOKEN_MINTER_CONTRACTS: {
  [key: number]: {
    [symbol: string]: `0x${string}`;
  };
} = {
  534352: {
    USDT: '0xe2b4795039517653c5ae8c2a9bfdd783b48f447a',
  },
  59144: {
    USDC: '0xA2Ee6Fce4ACB62D95448729cDb781e3BEb62504A',
    USDT: '0x353012dc4a9A6cF55c941bADC267f82004A8ceB9',
  },
  8453: {
    USDT: '0x4200000000000000000000000000000000000010',
  },
};

const TOP_OWNER: {
  [key: number]: {
    [symbol: string]: `0x${string}`;
  };
} = {
  [SOPHON_CHAIN_ID]: {
    ETH: '0x353B35a3362Dff8174cd9679BC4a46365CcD4dA7',
    USDC: '0x61a87fa6Dd89a23c78F0754EF3372d35ccde5935',
    USDT: '0x61a87fa6Dd89a23c78F0754EF3372d35ccde5935',
  },
};

const ZERO_ADDRESS: `0x${string}` = '0x0000000000000000000000000000000000000000';

const ZERO_ADDRESS_FUEL = convertTo32BytesHex(ZERO_ADDRESS);

export {
  AaveTokenContracts,
  FUEL_BASE_ASSET_ID,
  FUEL_NETWORK_URL,
  getLogoFromSymbol,
  HYPEREVM_CHAIN_ID,
  INTENT_EXPIRY,
  isNativeAddress,
  KAIA_CHAIN_ID,
  MONAD_TESTNET_CHAIN_ID,
  SOPHON_CHAIN_ID,
  TOKEN_MINTER_CONTRACTS,
  TOP_OWNER,
  ZERO_ADDRESS,
};
