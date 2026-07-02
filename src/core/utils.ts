import {
  formatUnits as viemFormatUnits,
  isAddress as viemIsAddress,
  parseUnits as viemParseUnits,
} from 'viem';
import {
  formatTokenBalance as domainFormatTokenBalance,
  formatTokenBalanceParts as domainFormatTokenBalanceParts,
  type NexusNetworkHint,
  type SupportedChainsAndTokensResult,
  truncateAddress as utilTruncateAddress,
} from '../domain';
import { createChainList } from '../services/chain-list';
import { getSupportedChainsFromChainList } from '../services/chains';
import { reportOperationError } from '../services/error-telemetry';
import { getNetworkConfig } from '../services/network-config';
import { getCoinbasePrices } from '../services/pricing';
import { createMiddlewareClient } from '../transport';

// Stateless utility exports
export const formatTokenBalance = domainFormatTokenBalance;
export const formatTokenBalanceParts = domainFormatTokenBalanceParts;
export const truncateAddress = utilTruncateAddress;
export const parseUnits = viemParseUnits;
export const formatUnits = viemFormatUnits;
export const isValidAddress = viemIsAddress;
// Utility-helper OTel boundary (rev 10): emit-and-rethrow only. Categorization happens
// upstream — `getCoinbasePrices` throws `ExternalServiceError(EXTERNAL_EXCHANGE_RATE_FETCH_FAILED)`
// with `service='coinbase'` already set. We do NOT re-wrap.
// `operationId: 'no_analytics'` is the sentinel for utility records (vs real op_… ids
// from client-method records). SigNoz can filter on that to separate the two.
export const getCoinbaseRates = async (): Promise<Record<string, string>> => {
  try {
    return await getCoinbasePrices();
  } catch (error) {
    reportOperationError({
      operation: 'getCoinbaseRates',
      operationId: 'no_analytics',
      error,
    });
    throw error;
  }
};

export const getSupportedChains = async (
  env: NexusNetworkHint
): Promise<SupportedChainsAndTokensResult> => {
  try {
    const networkConfig = getNetworkConfig(env);
    const middlewareClient = createMiddlewareClient(
      networkConfig.MIDDLEWARE_HTTP_URL,
      networkConfig.MIDDLEWARE_WS_URL
    );
    const deployment = await middlewareClient.getDeployment();
    // if (deployment.network !== networkConfig.NETWORK_HINT) {
    //   throw Errors.invalidInput(
    //     `Deployment network mismatch: expected ${networkConfig.NETWORK_HINT}, got ${deployment.network}`
    //   );
    // }
    const chainList = createChainList(deployment);
    return getSupportedChainsFromChainList(chainList);
  } catch (error) {
    reportOperationError({
      operation: 'getSupportedChains',
      operationId: 'no_analytics',
      params: { env },
      error,
    });
    throw error;
  }
};

export type NexusUtils = {
  formatTokenBalance: typeof formatTokenBalance;
  formatTokenBalanceParts: typeof formatTokenBalanceParts;
  parseUnits: typeof parseUnits;
  formatUnits: typeof formatUnits;
  isValidAddress: typeof isValidAddress;
  truncateAddress: typeof truncateAddress;
  getCoinbaseRates: typeof getCoinbaseRates;
  getSupportedChains: (env: NexusNetworkHint) => Promise<SupportedChainsAndTokensResult>;
};

export const nexusUtils: NexusUtils = {
  formatTokenBalance,
  formatTokenBalanceParts,
  parseUnits,
  formatUnits,
  isValidAddress,
  truncateAddress,
  getCoinbaseRates,
  getSupportedChains: (env: NexusNetworkHint): Promise<SupportedChainsAndTokensResult> =>
    getSupportedChains(env),
};
