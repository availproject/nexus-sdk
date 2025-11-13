import { Universe } from '@avail-project/ca-common';

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
  if (universe === Universe.ETHEREUM || universe === Universe.TRON) {
    return address === ZERO_ADDRESS || address === ZERO_ADDRESS_FUEL;
  }

  if (universe === Universe.FUEL) {
    return address === FUEL_BASE_ASSET_ID;
  }

  // Handle other universes or return false by default
  return false;
};

const INTENT_EXPIRY = 15 * 60 * 1000;

const ZERO_ADDRESS: `0x${string}` = '0x0000000000000000000000000000000000000000';

const ZERO_ADDRESS_FUEL = '0x0000000000000000000000000000000000000000000000000000000000000000';

export {
  FUEL_BASE_ASSET_ID,
  FUEL_NETWORK_URL,
  getLogoFromSymbol,
  INTENT_EXPIRY,
  isNativeAddress,
  ZERO_ADDRESS,
};
