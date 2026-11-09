import {
  formatUnits as viemFormatUnits,
  isAddress as viemIsAddress,
  parseUnits as viemParseUnits,
} from 'viem';
import {
  formatTokenBalance as domainFormatTokenBalance,
  formatTokenBalanceParts as domainFormatTokenBalanceParts,
  type NexusNetworkHint,
  truncateAddress as utilTruncateAddress,
} from '../domain';
import { Errors } from '../domain/errors';
import { createMiddlewareClient } from '../intent/middleware';
import { getSupportedChainsFromCatalog, type SupportedChainsResult } from '../services/chains';
import { reportOperationError } from '../services/error-telemetry';
import { getNetworkConfig } from '../services/network-config';
import { getCoinbasePrices } from '../services/pricing';
import { resolveSurfaceIdentity, type SurfaceIdentity } from '../services/surface-identity';
import { setLoggerProvider } from '../services/telemetry';

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
  env: NexusNetworkHint,
  options?: Partial<SurfaceIdentity> & { clientId: string }
): Promise<SupportedChainsResult> => {
  const surface = resolveSurfaceIdentity(options);
  try {
    if (typeof options?.clientId !== 'string' || !options.clientId.trim()) {
      throw Errors.invalidInput('getSupportedChains requires a non-empty clientId');
    }
    const networkConfig = getNetworkConfig(env);
    await setLoggerProvider(networkConfig);
    const middlewareClient = createMiddlewareClient(networkConfig.MIDDLEWARE_HTTP_URL, {
      ...options,
      ...surface,
    });
    try {
      return getSupportedChainsFromCatalog(await middlewareClient.getIntentChains());
    } finally {
      middlewareClient.destroy();
    }
  } catch (error) {
    reportOperationError({
      operation: 'getSupportedChains',
      operationId: 'no_analytics',
      params: { env },
      attributes: {
        'nexus.client.id': options?.clientId,
        'surface.name': surface.surfaceName,
        'surface.version': surface.surfaceVersion,
        'nexus.network': env,
      },
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
  getSupportedChains: (env: NexusNetworkHint) => Promise<SupportedChainsResult>;
};

export const createNexusUtils = (identity: SurfaceIdentity & { clientId: string }): NexusUtils => ({
  formatTokenBalance,
  formatTokenBalanceParts,
  parseUnits,
  formatUnits,
  isValidAddress,
  truncateAddress,
  getCoinbaseRates,
  getSupportedChains: (env: NexusNetworkHint): Promise<SupportedChainsResult> =>
    getSupportedChains(env, identity),
});
