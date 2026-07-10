import type { NetworkConfig, NexusNetwork } from '../domain';

const TESTNET_CONFIG: NetworkConfig = {
  MIDDLEWARE_HTTP_URL: 'https://nexus-v2.testnet.avail.so/middleware/',
  INTENT_EXPLORER_URL: 'https://nexus-v2.testnet.avail.so/',
  NETWORK_HINT: 'testnet',
};

const CANARY_MAINNET_CONFIG: NetworkConfig = {
  MIDDLEWARE_HTTP_URL: 'https://nexus-v2.canary.avail.so/middleware/',
  INTENT_EXPLORER_URL: 'https://nexus-v2.canary.avail.so/',
  NETWORK_HINT: 'canary',
};

const MAINNET_CONFIG: NetworkConfig = {
  MIDDLEWARE_HTTP_URL: 'https://nexus-v2.mainnet.avail.so/middleware/',
  INTENT_EXPLORER_URL: 'https://nexus-v2.mainnet.avail.so/',
  NETWORK_HINT: 'mainnet',
};

const isNetworkConfig = (config?: NetworkConfig): config is NetworkConfig => {
  if (typeof config !== 'object') {
    return false;
  }
  if (!(config.MIDDLEWARE_HTTP_URL && config.INTENT_EXPLORER_URL)) {
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
    case 'canary':
      return CANARY_MAINNET_CONFIG;
    default:
      return MAINNET_CONFIG;
  }
};

const getNetwork = (network: NexusNetwork) => {
  if (typeof network !== 'string') {
    return 'custom';
  }
  return network;
};

const readEnv = (key: string): string | undefined => {
  try {
    const runtimeProcess = Reflect.get(globalThis, 'process');
    if (!runtimeProcess || typeof runtimeProcess !== 'object') {
      return undefined;
    }
    const runtimeEnv = Reflect.get(runtimeProcess, 'env');
    if (!runtimeEnv || typeof runtimeEnv !== 'object') {
      return undefined;
    }
    const value = Reflect.get(runtimeEnv, key);
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
};

export { getNetwork, getNetworkConfig, readEnv };
