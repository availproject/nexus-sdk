import { Environment } from '@avail-project/ca-common';

import { NetworkConfig, NexusNetwork } from '../../commons';

// Mainnet
const CORAL_CONFIG: NetworkConfig = {
  COSMOS_REST_URL: 'https://cosmos01-testnet.arcana.network',
  COSMOS_RPC_URL: 'https://cosmos01-testnet.arcana.network:26650',
  COSMOS_WS_URL: 'wss://cosmos01-testnet.arcana.network:26650/websocket',
  COSMOS_GRPC_URL: 'https://grpcproxy-testnet.arcana.network',
  VSC_BASE_URL: 'https://vsc1-testnet.arcana.network',
  VSC_WS_URL: 'wss://vsc1-testnet.arcana.network',
  INTENT_EXPLORER_URL: 'https://explorer.nexus.availproject.org',
  NETWORK_HINT: Environment.CORAL,
};

// Testnet
const FOLLY_CONFIG: NetworkConfig = {
  COSMOS_REST_URL: 'https://cosmos04-dev.arcana.network',
  COSMOS_RPC_URL: 'https://cosmos04-dev.arcana.network:26650',
  COSMOS_WS_URL: 'wss://cosmos04-dev.arcana.network:26650',
  COSMOS_GRPC_URL: 'https://grpc-folly.arcana.network',
  VSC_BASE_URL: 'https://vsc1-folly.arcana.network',
  VSC_WS_URL: 'wss://vsc1-folly.arcana.network',
  INTENT_EXPLORER_URL: 'https://explorer.nexus-folly.availproject.org',
  NETWORK_HINT: Environment.FOLLY,
};

const isNetworkConfig = (config?: Environment | NetworkConfig): config is NetworkConfig => {
  if (typeof config !== 'object') {
    return false;
  }
  if (
    !(
      config.VSC_BASE_URL &&
      config.VSC_WS_URL &&
      config.COSMOS_REST_URL &&
      config.COSMOS_RPC_URL &&
      config.COSMOS_WS_URL &&
      config.INTENT_EXPLORER_URL &&
      config.COSMOS_GRPC_URL &&
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
    case 'testnet':
      return FOLLY_CONFIG;
    default:
      return CORAL_CONFIG;
  }
};

export { getNetworkConfig };
