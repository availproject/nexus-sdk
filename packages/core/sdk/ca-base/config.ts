import { Environment } from '@arcana/ca-common';

import { NetworkConfig } from '@nexus/commons';

// Testnet with mainnet tokens
const CORAL_CONFIG: NetworkConfig = {
  COSMOS_URL: 'https://cosmos01-testnet.arcana.network',
  EXPLORER_URL: 'https://explorer.nexus.availproject.org',
  FAUCET_URL: 'https://gateway001-testnet.arcana.network/api/v1/faucet',
  GRPC_URL: 'https://grpcproxy-testnet.arcana.network',
  NETWORK_HINT: Environment.CORAL,
  SIMULATION_URL: 'https://ca-sim-testnet.arcana.network',
  VSC_DOMAIN: 'vsc1-testnet.arcana.network',
};

// Dev with mainnet tokens
const CERISE_CONFIG: NetworkConfig = {
  COSMOS_URL: 'https://cosmos01-dev.arcana.network',
  EXPLORER_URL: 'https://explorer.nexus-cerise.availproject.org',
  FAUCET_URL: 'https://gateway-dev.arcana.network/api/v1/faucet',
  GRPC_URL: 'https://mimosa-dash-grpc.arcana.network',
  NETWORK_HINT: Environment.CERISE,
  SIMULATION_URL: 'https://ca-sim-dev.arcana.network',
  VSC_DOMAIN: 'mimosa-dash-vsc.arcana.network',
};

// Dev with testnet tokens
const FOLLY_CONFIG: NetworkConfig = {
  COSMOS_URL: 'https://cosmos04-dev.arcana.network',
  EXPLORER_URL: 'https://explorer.nexus-folly.availproject.org',
  FAUCET_URL: 'https://gateway-dev.arcana.network/api/v1/faucet',
  GRPC_URL: 'https://grpc-folly.arcana.network',
  NETWORK_HINT: Environment.FOLLY,
  SIMULATION_URL: 'https://ca-sim-dev.arcana.network',
  VSC_DOMAIN: 'vsc1-folly.arcana.network',
};

const isNetworkConfig = (config?: Environment | NetworkConfig): config is NetworkConfig => {
  if (typeof config !== 'object') {
    return false;
  }
  if (
    !(
      config.VSC_DOMAIN &&
      config.COSMOS_URL &&
      config.SIMULATION_URL &&
      config.FAUCET_URL &&
      config.EXPLORER_URL &&
      config.GRPC_URL
    )
  ) {
    return false;
  }
  if (config.NETWORK_HINT === undefined) {
    return false;
  }
  return true;
};

const getNetworkConfig = (network?: Environment | NetworkConfig): NetworkConfig => {
  if (isNetworkConfig(network)) {
    return network;
  }
  switch (network) {
    case Environment.CERISE:
      return CERISE_CONFIG;
    case Environment.FOLLY:
      return FOLLY_CONFIG;
    default:
      return CORAL_CONFIG;
  }
};

export { CERISE_CONFIG, CORAL_CONFIG, getNetworkConfig };
