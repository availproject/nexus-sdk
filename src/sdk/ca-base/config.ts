import { Environment } from '@avail-project/ca-common';

import { NetworkConfig, NexusNetwork } from '../../commons';

// Testnet with mainnet tokens
const CORAL_CONFIG: NetworkConfig = {
  COSMOS_URL: 'https://cosmos01-testnet.arcana.network',
  EXPLORER_URL: 'https://explorer.nexus.availproject.org',
  GRPC_URL: 'https://grpcproxy-testnet.arcana.network',
  NETWORK_HINT: Environment.CORAL,
  VSC_DOMAIN: 'vsc1-testnet.arcana.network',
};

// Dev with mainnet tokens
const CERISE_CONFIG: NetworkConfig = {
  COSMOS_URL: 'https://cosmos01-dev.arcana.network',
  EXPLORER_URL: 'https://explorer.nexus-cerise.availproject.org',
  GRPC_URL: 'https://mimosa-dash-grpc.arcana.network',
  NETWORK_HINT: Environment.CERISE,
  VSC_DOMAIN: 'mimosa-dash-vsc.arcana.network',
};

// Dev with testnet tokens
const FOLLY_CONFIG: NetworkConfig = {
  COSMOS_URL: 'https://cosmos04-dev.arcana.network',
  EXPLORER_URL: 'https://explorer.nexus-folly.availproject.org',
  GRPC_URL: 'https://grpc-folly.arcana.network',
  NETWORK_HINT: Environment.FOLLY,
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
      config.EXPLORER_URL &&
      config.GRPC_URL &&
      config.NETWORK_HINT
    )
  ) {
    return false;
  }
  if (config.NETWORK_HINT === undefined) {
    return false;
  }
  return true;
};

const getNetworkConfig = (network?: NexusNetwork): NetworkConfig => {
  if (typeof network === 'object' && isNetworkConfig(network)) {
    return network;
  }
  switch (network) {
    case 'devnet':
      return CERISE_CONFIG;
    case 'testnet':
      return FOLLY_CONFIG;
    default:
      return CORAL_CONFIG;
  }
};

export { CERISE_CONFIG, CORAL_CONFIG, getNetworkConfig };
