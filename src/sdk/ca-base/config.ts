import { Environment } from '@avail-project/ca-common';

import { NetworkConfig, NexusNetwork } from '../../commons';

// Mainnet
const JADE_CONFIG: NetworkConfig = {
  COSMOS_URL: 'https://cosmos-mainnet.availproject.org',
  EXPLORER_URL: 'https://nexus-explorer.availproject.org',
  GRPC_URL: 'https://grpcproxy-mainnet.availproject.org',
  NETWORK_HINT: Environment.JADE,
  VSC_DOMAIN: 'vsc-mainnet.availproject.org',
  STATEKEEPER_URL: 'http://localhost:9080',
  MIDDLEWARE_URL: 'http://localhost:3000',
  useV2Middleware: true,  // V2 middleware is now the default
};

// Canary
const CORAL_CONFIG: NetworkConfig = {
  COSMOS_URL: 'https://cosmos01-testnet.arcana.network',
  EXPLORER_URL: 'https://explorer.nexus.availproject.org',
  GRPC_URL: 'https://grpcproxy-testnet.arcana.network',
  NETWORK_HINT: Environment.CORAL,
  VSC_DOMAIN: 'vsc1-testnet.arcana.network',
  STATEKEEPER_URL: 'http://localhost:9080',
  MIDDLEWARE_URL: 'http://localhost:3000',
  useV2Middleware: true,  // V2 middleware is now the default
};

// Testnet
const FOLLY_CONFIG: NetworkConfig = {
  COSMOS_URL: 'https://cosmos04-dev.arcana.network',
  EXPLORER_URL: 'https://explorer.nexus-folly.availproject.org',
  GRPC_URL: 'https://grpc-folly.arcana.network',
  NETWORK_HINT: Environment.FOLLY,
  VSC_DOMAIN: 'vsc1-folly.arcana.network',
  STATEKEEPER_URL: 'http://localhost:9080',
  MIDDLEWARE_URL: 'http://localhost:3000',
  useV2Middleware: true,  // V2 middleware is now the default
};

const isNetworkConfig = (config?: Environment | NetworkConfig): config is NetworkConfig => {
  if (typeof config !== 'object') {
    return false;
  }
  // Check required fields exist (NETWORK_HINT can be 0 which is falsy, so use !== undefined)
  if (
    !config.VSC_DOMAIN ||
    !config.COSMOS_URL ||
    !config.EXPLORER_URL ||
    !config.GRPC_URL ||
    config.NETWORK_HINT === undefined
  ) {
    return false;
  }
  return true;
};

const getNetworkConfig = (network?: NexusNetwork): NetworkConfig => {
  if (typeof network === 'object' && isNetworkConfig(network)) {
    return network;
  }
  switch (network) {
    case 'canary':
      return CORAL_CONFIG;
    case 'testnet':
      return FOLLY_CONFIG;
    default:
      return JADE_CONFIG;
  }
};

export { getNetworkConfig };
