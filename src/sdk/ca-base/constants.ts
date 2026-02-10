import { Universe } from '@avail-project/ca-common';
import { equalFold } from './utils';

const NEXUS_ASSETS_BASE_URL =
  'https://raw.githubusercontent.com/availproject/nexus-assets/main/tokens';

const NEXUS_CHAIN_ASSETS_BASE_URL =
  'https://raw.githubusercontent.com/availproject/nexus-assets/main/chains';

const SymbolToLogo: { [k: string]: string } = {
  AVAX: `${NEXUS_ASSETS_BASE_URL}/avax/logo.png`,
  BNB: `${NEXUS_ASSETS_BASE_URL}/bnb/logo.png`,
  ETH: `${NEXUS_ASSETS_BASE_URL}/eth/logo.png`,
  KAIA: `${NEXUS_ASSETS_BASE_URL}/kaia/logo.png`,
  MATIC: `${NEXUS_ASSETS_BASE_URL}/matic/logo.png`,
  MON: `${NEXUS_ASSETS_BASE_URL}/mon/logo.png`,
  POL: `${NEXUS_ASSETS_BASE_URL}/pol/logo.png`,
  USDC: `${NEXUS_ASSETS_BASE_URL}/usdc/logo.png`,
  USDT: `${NEXUS_ASSETS_BASE_URL}/usdt/logo.png`,
  USDM: 'https://assets.coingecko.com/coins/images/31719/large/usdm.png',
  WETH: `${NEXUS_ASSETS_BASE_URL}/weth/logo.png`,
  HYPE: `${NEXUS_ASSETS_BASE_URL}/hype/logo.png`,
  CBTC: `${NEXUS_ASSETS_BASE_URL}/cbtc/logo.png`,
};

const getLogoFromSymbol = (symbol: string) => {
  const logo = SymbolToLogo[symbol.toUpperCase()];
  if (!logo) {
    return '';
  }

  return logo;
};

const isNativeAddress = (universe: Universe, address: `0x${string}`) => {
  if (universe === Universe.ETHEREUM || universe === Universe.TRON) {
    return equalFold(address, ZERO_ADDRESS) || equalFold(address, ZERO_ADDRESS_BYTES_32);
  }

  // Handle other universes or return false by default
  return false;
};

const INTENT_EXPIRY = 15 * 60 * 1000;

const ZERO_ADDRESS: `0x${string}` = '0x0000000000000000000000000000000000000000';

const ZERO_ADDRESS_BYTES_32 = '0x0000000000000000000000000000000000000000000000000000000000000000';

export {
  getLogoFromSymbol,
  INTENT_EXPIRY,
  isNativeAddress,
  NEXUS_CHAIN_ASSETS_BASE_URL,
  ZERO_ADDRESS,
};
