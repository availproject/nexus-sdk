import axios from 'axios';
import type { Hex } from 'viem';
import { z } from 'zod';
import { installAxiosNetworkTiming } from '../analytics/network-timing';
import type { DeploymentResponse, TimingSpanHooks } from '../domain';
import { PermitVariant } from '../domain';
import { BackendError, ERROR_CODES, Errors, formatUnknownError } from '../domain/errors';
import { logger } from '../domain/utils/logger';
import { addressString, hexString } from '../domain/utils/validation';
import {
  normalizeIntentBalances,
  normalizeIntentChains,
  normalizeIntentHistory,
  normalizeIntentQuote,
  normalizeIntentStatus,
  normalizeIntentSubmitResponse,
} from '../intent/normalize';
import type {
  ExecutableIntentQuote,
  IntentBalancesResult,
  IntentChain,
  IntentHistoryQuery,
  IntentHistoryResult,
  IntentProvider,
  IntentQuoteRequest,
  IntentStatus,
  IntentSubmitRequest,
  IntentSubmitResponse,
} from '../intent/types';

export type MiddlewareClient = {
  getDeployment: () => Promise<DeploymentResponse>;
  getIntentChains: (providers?: IntentProvider[]) => Promise<IntentChain[]>;
  getIntentBalances: (
    address: Hex,
    options?: { refresh?: boolean; providers?: IntentProvider[] }
  ) => Promise<IntentBalancesResult>;
  getIntentQuote: (request: IntentQuoteRequest) => Promise<ExecutableIntentQuote>;
  submitIntent: (request: IntentSubmitRequest) => Promise<IntentSubmitResponse>;
  getIntentStatus: (id: Hex) => Promise<IntentStatus>;
  listIntentHistory: (query?: IntentHistoryQuery) => Promise<IntentHistoryResult>;
  configureTiming: (options?: { timing?: TimingSpanHooks; captureNetworkTiming?: boolean }) => void;
  destroy: () => void;
};

const supportedUniverses = ['EVM', 'TRON', 'FUEL', 'SVM'] as const;
const universeSchema = z.enum(supportedUniverses);
const supportedUniverseSet = new Set<string>(supportedUniverses);
const permitVariantSchema = z.number().int().optional().default(1);
const permitVersionSchema = z
  .union([z.string(), z.number()])
  .transform(Number)
  .pipe(z.number().int())
  .default(PermitVariant.EIP2612Canonical);
const normalizeEvmAddress = (value: Hex): Hex =>
  (value.length === 66 ? `0x${value.slice(-40)}` : value) as Hex;

export const deploymentResponseSchema: z.ZodType<DeploymentResponse> = z.object({
  network: z.string(),
  statekeeperUrl: z.string().url(),
  fulfillmentBps: z.number().int(),
  mayanEnabled: z.boolean().optional().default(false),
  mayanThresholdUsd: z.number().nonnegative(),
  mayanCancelRefundMaxPercentage: z.number().nonnegative(),
  chains: z.array(
    z
      .object({
        chainId: z.number().int(),
        universe: universeSchema,
        name: z.string(),
        rpcUrl: z.url(),
        vaultAddress: hexString.transform(normalizeEvmAddress).pipe(addressString),
        multicallAddress: hexString.transform(normalizeEvmAddress).pipe(addressString),
        nativeCurrency: z.object({
          name: z.string(),
          symbol: z.string(),
          decimals: z.number().int(),
          logo: z.url(),
          currencyId: z.number().int().positive(),
          mayanEnabled: z.boolean().optional().default(false),
        }),
        sponsored: z.boolean(),
        explorerUrl: z.url(),
        logo: z.url(),
        tokens: z.array(
          z.object({
            symbol: z.string(),
            name: z.string(),
            address: addressString,
            decimals: z.number().int(),
            balanceSlot: z.number().int(),
            logo: z.url(),
            permitVariant: permitVariantSchema,
            permitVersion: permitVersionSchema,
            currencyId: z.number().int().positive(),
            mayanEnabled: z.boolean().optional(),
          })
        ),
        mayanEnabled: z.boolean().optional(),
        eip7702Enabled: z.boolean().optional(),
        swapSupported: z.boolean().optional(),
      })
      .transform(({ eip7702Enabled, ...chain }) => ({
        ...chain,
        supports7702: eip7702Enabled,
      }))
  ),
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const filterUnsupportedChains = (input: unknown): unknown => {
  if (!isRecord(input) || !Array.isArray(input.chains)) return input;
  return {
    ...input,
    chains: input.chains.filter(
      (chain) =>
        !isRecord(chain) ||
        chain.universe === undefined ||
        (typeof chain.universe === 'string' && supportedUniverseSet.has(chain.universe))
    ),
  };
};

const middlewareErrorDetails = (error: unknown): Record<string, unknown> => {
  const data = (error as { response?: { data?: unknown } } | undefined)?.response?.data;
  if (!isRecord(data)) return { error: formatUnknownError(error) };
  return {
    error: typeof data.message === 'string' ? data.message : formatUnknownError(error),
    middlewareCode: data.code,
    middlewareSubcode: data.subcode,
    errorId: data.errorId,
    middlewareDetails: data.details,
  };
};

export const createMiddlewareClient = (
  middlewareURL: string,
  timingOptions?: { timing?: TimingSpanHooks; captureNetworkTiming?: boolean }
): MiddlewareClient => {
  try {
    const url = new URL(middlewareURL);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Invalid protocol');
  } catch {
    throw Errors.invalidInput(`Invalid middleware HTTP URL: ${middlewareURL}`);
  }

  const client = axios.create({
    baseURL: middlewareURL,
    timeout: 90_000,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  });
  // biome-ignore lint/suspicious/noEmptyBlockStatements: default no-op cleanup
  let uninstallTiming = () => {};
  const configureTiming: MiddlewareClient['configureTiming'] = (options) => {
    uninstallTiming();
    uninstallTiming = installAxiosNetworkTiming(client, {
      timing: options?.timing,
      enabled: options?.captureNetworkTiming !== false,
      spanName: 'network.middleware.request',
    });
  };
  configureTiming(timingOptions);

  const getDeployment = async (): Promise<DeploymentResponse> => {
    try {
      const response = await client.get('/deployment');
      return deploymentResponseSchema.parse(filterUnsupportedChains(response.data));
    } catch (error) {
      logger.error('getDeploymentFromMiddleware:error', error);
      throw new BackendError(
        ERROR_CODES.BACKEND_DEPLOYMENT_FETCH_FAILED,
        'Failed to fetch deployment from middleware',
        { context: { service: 'middleware' }, details: middlewareErrorDetails(error) }
      );
    }
  };

  const request = async <T>(operation: string, run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (error) {
      if (error instanceof BackendError) throw error;
      throw Errors.backend(`Better Intent ${operation} failed: ${formatUnknownError(error)}`, {
        service: 'middleware',
        details: { operation, ...middlewareErrorDetails(error) },
      });
    }
  };

  const getIntentChains = (providers?: IntentProvider[]): Promise<IntentChain[]> =>
    request('chains request', async () =>
      normalizeIntentChains(
        (
          await client.get('/api/v1/better-intent/chains', {
            params: { provider: providers?.length === 1 ? providers[0] : providers },
          })
        ).data
      )
    );

  const getIntentBalances: MiddlewareClient['getIntentBalances'] = (address, options) =>
    request('balances request', async () =>
      normalizeIntentBalances(
        (
          await client.get(`/api/v1/better-intent/balances/${address}`, {
            params: {
              refresh: options?.refresh ?? false,
              provider:
                options?.providers?.length === 1 ? options.providers[0] : options?.providers,
            },
          })
        ).data
      )
    );

  const getIntentQuote = (quoteRequest: IntentQuoteRequest): Promise<ExecutableIntentQuote> =>
    request('quote request', async () =>
      normalizeIntentQuote((await client.post('/api/v1/better-intent/quote', quoteRequest)).data)
    );

  const submitIntent = (submitRequest: IntentSubmitRequest): Promise<IntentSubmitResponse> =>
    request('submit request', async () =>
      normalizeIntentSubmitResponse(
        (await client.post('/api/v1/better-intent/submit', submitRequest)).data
      )
    );

  const getIntentStatus = (id: Hex): Promise<IntentStatus> =>
    request('status request', async () =>
      normalizeIntentStatus((await client.get(`/api/v1/better-intent/status/${id}`)).data)
    );

  const listIntentHistory = (query: IntentHistoryQuery = {}): Promise<IntentHistoryResult> =>
    request('history request', async () => {
      const [nexusResponse, externalResponse] = await Promise.all([
        client.get('/api/v1/better-intent/rffs', { params: query }),
        client.get('/api/v1/better-intent/rffs-external', { params: query }),
      ]);
      const nexus = normalizeIntentHistory(nexusResponse.data, 'nexus-v2');
      const external = normalizeIntentHistory(externalResponse.data, 'mayan');
      return {
        total: nexus.total + external.total,
        intents: [...nexus.intents, ...external.intents].sort(
          (left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0)
        ),
      };
    });

  return {
    getDeployment,
    getIntentChains,
    getIntentBalances,
    getIntentQuote,
    submitIntent,
    getIntentStatus,
    listIntentHistory,
    configureTiming,
    destroy: () => uninstallTiming(),
  };
};
