import type { NetworkConfig, NexusNetwork } from '../../commons';

const TESTNET_CONFIG: NetworkConfig = {
  MIDDLEWARE_HTTP_URL: '',
  MIDDLEWARE_WS_URL: '',
  INTENT_EXPLORER_URL: 'http://64.225.34.135:3000',
  NETWORK_HINT: 'testnet',
};

const isNetworkConfig = (config?: NetworkConfig): config is NetworkConfig => {
  if (typeof config !== 'object') {
    return false;
  }
  if (!(config.MIDDLEWARE_WS_URL && config.MIDDLEWARE_HTTP_URL && config.INTENT_EXPLORER_URL)) {
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
      return TESTNET_CONFIG;
    default:
      return TESTNET_CONFIG;
  }
};

export { getNetworkConfig };
