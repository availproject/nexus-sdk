import axios from 'axios';
import type { Hex } from 'viem';
import { version } from '../../package.json' with { type: 'json' };
import { installAxiosNetworkTiming } from '../analytics/network-timing';
import type { TimingSpanHooks } from '../domain';
import {
  BackendError,
  ERROR_CODES,
  type ErrorCode,
  Errors,
  formatUnknownError,
  NexusError,
} from '../domain/errors';
import {
  normalizeIntentBalances,
  normalizeIntentChains,
  normalizeIntentHistory,
  normalizeIntentQuote,
  normalizeIntentSourceVerdicts,
  normalizeIntentStatus,
  normalizeIntentSubmitResponse,
  normalizeIntentTokens,
} from './normalize';
import type {
  ExecutableIntentQuote,
  IntentBalancesResult,
  IntentChainMetadata,
  IntentHistoryQuery,
  IntentHistoryResult,
  IntentProvider,
  IntentQuoteRequest,
  IntentRouteConstraints,
  IntentSourceVerdict,
  IntentStatus,
  IntentSubmitRequest,
  IntentSubmitResponse,
  IntentTokenPage,
  IntentTokenQuery,
} from './types';

export type MiddlewareClient = {
  getIntentChains: (constraints?: IntentRouteConstraints) => Promise<IntentChainMetadata[]>;
  getIntentTokens: (query?: IntentTokenQuery) => Promise<IntentTokenPage>;
  getIntentBalances: (
    address: Hex,
    options?: { refresh?: boolean; providers?: IntentProvider[]; attemptId?: string }
  ) => Promise<IntentBalancesResult>;
  getIntentQuote: (
    request: IntentQuoteRequest,
    attemptId?: string
  ) => Promise<ExecutableIntentQuote>;
  submitIntent: (request: IntentSubmitRequest, attemptId?: string) => Promise<IntentSubmitResponse>;
  getIntentStatus: (id: Hex, attemptId?: string) => Promise<IntentStatus>;
  listIntentHistory: (query?: IntentHistoryQuery) => Promise<IntentHistoryResult>;
  configureTiming: (options?: { timing?: TimingSpanHooks; captureNetworkTiming?: boolean }) => void;
  destroy: () => void;
};

const INTENT_API_PREFIX = '/api/v1/intent';
// Keep attempt IDs on each request, never on shared Axios defaults or in signed payloads.
const attemptHeaders = (attemptId?: string) =>
  attemptId ? { 'x-nexus-attempt-id': attemptId } : undefined;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

type MiddlewareFailure = readonly [code: ErrorCode, message: string];

// Mirrors common/errors.ts and better-intent's HttpError subcodes in the middleware.
// Subcodes take precedence; provider-specific aliases share the same SDK recovery code.
const middlewareFailures: Readonly<Record<string, MiddlewareFailure>> = {
  INVALID_REQUEST: [
    ERROR_CODES.BACKEND_INVALID_REQUEST,
    'The swap request is invalid. Check the selected tokens, chains, and amounts.',
  ],
  UNAUTHORIZED: [
    ERROR_CODES.BACKEND_UNAUTHORIZED,
    'This client is not authorized to use the swap service.',
  ],
  NOT_FOUND: [ERROR_CODES.BACKEND_NOT_FOUND, 'The requested intent or resource was not found.'],
  RATE_LIMITED: [
    ERROR_CODES.BACKEND_RATE_LIMITED,
    'Too many requests. Wait a moment before trying again.',
  ],
  CONFIGURATION_ERROR: [
    ERROR_CODES.BACKEND_CONFIGURATION_ERROR,
    'The swap service is not configured for this operation. Please try again later.',
  ],
  UPSTREAM_ERROR: [
    ERROR_CODES.BACKEND_UPSTREAM_ERROR,
    'The swap service is temporarily unavailable. Please try again later.',
  ],
  UPSTREAM_TIMEOUT: [
    ERROR_CODES.BACKEND_UPSTREAM_TIMEOUT,
    'The swap service timed out. Check the intent status before retrying a submission.',
  ],
  RPC_ERROR: [
    ERROR_CODES.BACKEND_RPC_ERROR,
    'Unable to read or submit blockchain data. Please try again later.',
  ],
  SIMULATION_FAILED: [
    ERROR_CODES.BACKEND_SIMULATION_FAILED,
    'Transaction simulation failed. Request a new quote or choose different sources.',
  ],
  TRANSACTION_REVERTED: [
    ERROR_CODES.BACKEND_TRANSACTION_REVERTED,
    'The source transaction reverted. Check its status before retrying.',
  ],
  QUOTE_UNAVAILABLE: [
    ERROR_CODES.BACKEND_QUOTE_UNAVAILABLE,
    'No quote is available for this swap. Try different sources or an amount change.',
  ],
  PRICE_UNAVAILABLE: [
    ERROR_CODES.BACKEND_PRICE_UNAVAILABLE,
    'A required token price is unavailable. Please try again later.',
  ],
  GAS_UNAVAILABLE: [
    ERROR_CODES.BACKEND_GAS_UNAVAILABLE,
    'Gas estimates are unavailable for this swap. Please try again later.',
  ],
  CHAIN_NOT_SUPPORTED: [
    ERROR_CODES.BACKEND_CHAIN_NOT_SUPPORTED,
    'A selected chain is not supported. Choose another chain.',
  ],
  TOKEN_NOT_SUPPORTED: [
    ERROR_CODES.BACKEND_TOKEN_NOT_SUPPORTED,
    'A selected token is not supported. Choose another token.',
  ],
  INTERNAL_ERROR: [
    ERROR_CODES.BACKEND_ERROR,
    'The swap service encountered an unexpected error. Please try again later.',
  ],
  NO_ROUTABLE_SOURCE: [
    ERROR_CODES.BACKEND_NO_ROUTABLE_SOURCE,
    'No route is available from the selected sources. Try different tokens, chains, or amounts.',
  ],
  INTENT_REFUSED: [
    ERROR_CODES.BACKEND_INTENT_REFUSED,
    'The available providers cannot fulfill this swap. Try different sources or amounts.',
  ],
  PROVIDER_UNAVAILABLE: [
    ERROR_CODES.BACKEND_PROVIDER_UNAVAILABLE,
    'Swap providers are temporarily unavailable. Please try again later.',
  ],
  NO_PROVIDERS_ENABLED: [
    ERROR_CODES.BACKEND_NO_PROVIDERS_ENABLED,
    'No swap providers are enabled. Please try again later.',
  ],
  INSUFFICIENT_BALANCE: [
    ERROR_CODES.BACKEND_INSUFFICIENT_BALANCE,
    'Insufficient source balance for this swap and its fees. Reduce the amount or choose another source.',
  ],
  INSUFFICIENT_APPROVAL_GAS: [
    ERROR_CODES.BACKEND_INSUFFICIENT_APPROVAL_GAS,
    'Not enough gas to approve a source token. Add gas funds on the source chain or choose another source.',
  ],
  SAME_CHAIN_GAS_DROP_UNSUPPORTED: [
    ERROR_CODES.BACKEND_SAME_CHAIN_GAS_DROP_UNSUPPORTED,
    'Gas top-ups require a cross-chain swap. Remove the gas top-up or choose a different destination chain.',
  ],
  QUOTE_PRICE_UNAVAILABLE: [
    ERROR_CODES.BACKEND_PRICE_UNAVAILABLE,
    'A required token price is unavailable. Please try again later.',
  ],
  QUOTE_PRICE_OUTLIER: [
    ERROR_CODES.BACKEND_QUOTE_PRICE_OUTLIER,
    'The quote failed price checks or cannot cover the requested output. Request a new quote or adjust the amount.',
  ],
  INPUT_BELOW_DEPOSIT_FEE: [
    ERROR_CODES.BACKEND_INPUT_BELOW_DEPOSIT_FEE,
    'The source amount is too small to cover the deposit fee. Increase the amount or choose another source.',
  ],
  GAS_DROP_TOO_SMALL: [
    ERROR_CODES.BACKEND_GAS_DROP_TOO_SMALL,
    'The requested gas top-up is too small. Increase it or remove the gas top-up.',
  ],
  REQUEST_EXPIRED: [
    ERROR_CODES.BACKEND_REQUEST_EXPIRED,
    'This swap request has expired. Request a new quote and sign again.',
  ],
  INVALID_INTENT_SIGNATURE: [
    ERROR_CODES.BACKEND_INVALID_INTENT_SIGNATURE,
    'The intent signature is invalid. Request a new quote and sign with the selected wallet.',
  ],
  MISSING_INTENT_SIGNATURE: [
    ERROR_CODES.BACKEND_MISSING_INTENT_SIGNATURE,
    'The intent signature is missing. Sign the intent before submitting.',
  ],
  INVALID_PERMIT_SIGNATURE: [
    ERROR_CODES.BACKEND_INVALID_PERMIT_SIGNATURE,
    'The approval signature is invalid or stale. Request a new quote and sign the approval again.',
  ],
  PERMIT_WITHOUT_SOURCE: [
    ERROR_CODES.BACKEND_PERMIT_WITHOUT_SOURCE,
    'An approval signature does not match a unique source token. Request a new quote and sign again.',
  ],
  PERMIT_NOT_SPONSORABLE: [
    ERROR_CODES.BACKEND_PERMIT_NOT_SPONSORABLE,
    'Sponsored approvals are not supported for this source. Choose another source or approve the token with gas.',
  ],
  INSUFFICIENT_ALLOWANCE: [
    ERROR_CODES.BACKEND_INSUFFICIENT_ALLOWANCE,
    'The source token approval is missing or insufficient. Complete the approval before submitting.',
  ],
  PERMIT_RELAY_FAILED: [
    ERROR_CODES.BACKEND_PERMIT_RELAY_FAILED,
    'The sponsored approval failed. Check the approval status, then request a new quote.',
  ],
  MAYAN_INSUFFICIENT_COVERAGE: [
    ERROR_CODES.BACKEND_INSUFFICIENT_BALANCE,
    'Insufficient source balance for this swap and its fees. Reduce the amount or choose another source.',
  ],
  INVALID_MAYAN_QUOTE: [
    ERROR_CODES.BACKEND_QUOTE_UNAVAILABLE,
    'The provider returned an invalid quote. Request a new quote or choose different sources.',
  ],
  MAYAN_QUOTE_FETCH_FAILED: [
    ERROR_CODES.BACKEND_PROVIDER_UNAVAILABLE,
    'The quote provider is temporarily unavailable. Please try again later.',
  ],
  MAYAN_NO_ROUTE: [
    ERROR_CODES.BACKEND_NO_ROUTABLE_SOURCE,
    'No route is available from the selected sources. Try different tokens, chains, or amounts.',
  ],
  MAYAN_CALLDATA_BUILD_FAILED: [
    ERROR_CODES.BACKEND_PROVIDER_UNAVAILABLE,
    'The quote provider is temporarily unavailable. Please try again later.',
  ],
  MISSING_CLIENT_ID: [
    ERROR_CODES.BACKEND_INVALID_REQUEST,
    'The app is missing its client identity. Configure the SDK clientId before requesting a swap.',
  ],
  MISSING_SURFACE: [
    ERROR_CODES.BACKEND_INVALID_REQUEST,
    'The app is missing required client identity headers. Check the SDK integration.',
  ],
};

const intentRequestFailures = {
  'chains request': [
    ERROR_CODES.BACKEND_ERROR,
    'Unable to load supported chains and tokens. Please try again.',
  ],
  'tokens request': [ERROR_CODES.BACKEND_ERROR, 'Unable to load tokens. Please try again.'],
  'balances request': [
    ERROR_CODES.BACKEND_BALANCES_FETCH_FAILED,
    'Unable to load balances. Please try again.',
  ],
  'quote request': [
    ERROR_CODES.BACKEND_GET_QUOTE_FAILED,
    'Unable to fetch a quote. Please try again.',
  ],
  'submit request': [
    ERROR_CODES.BACKEND_RFF_SUBMIT_FAILED,
    'Unable to submit the intent. Check its status before retrying.',
  ],
  'status request': [
    ERROR_CODES.BACKEND_RFF_STATUS_FAILED,
    'Unable to load the intent status. Please try again.',
  ],
  'history request': [
    ERROR_CODES.BACKEND_RFF_LIST_FAILED,
    'Unable to load intent history. Please try again.',
  ],
} satisfies Record<string, MiddlewareFailure>;

const httpFailureCodes: Readonly<Record<number, string>> = {
  401: 'UNAUTHORIZED',
  403: 'UNAUTHORIZED',
  404: 'NOT_FOUND',
  408: 'UPSTREAM_TIMEOUT',
  429: 'RATE_LIMITED',
  500: 'INTERNAL_ERROR',
  502: 'UPSTREAM_ERROR',
  503: 'UPSTREAM_ERROR',
  504: 'UPSTREAM_TIMEOUT',
};

const middlewareErrorDetails = (error: unknown): Record<string, unknown> => {
  const response = isRecord(error) && isRecord(error.response) ? error.response : undefined;
  const data = response?.data;
  const httpStatus = typeof response?.status === 'number' ? response.status : undefined;
  if (!isRecord(data)) return { error: formatUnknownError(error), httpStatus };
  const details = isRecord(data.details) ? data.details : undefined;
  const subcode = data.subcode;
  let intentQuoteFailure: Record<string, unknown> | undefined;
  const quoteFailureSubcodes = new Set([
    'NO_ROUTABLE_SOURCE',
    'INTENT_REFUSED',
    'PROVIDER_UNAVAILABLE',
    'NO_PROVIDERS_ENABLED',
    'INSUFFICIENT_BALANCE',
    'INSUFFICIENT_APPROVAL_GAS',
    'SAME_CHAIN_GAS_DROP_UNSUPPORTED',
    'QUOTE_PRICE_UNAVAILABLE',
    'QUOTE_PRICE_OUTLIER',
  ]);
  if (typeof subcode === 'string' && quoteFailureSubcodes.has(subcode)) {
    let sourceVerdicts: IntentSourceVerdict[] = [];
    try {
      sourceVerdicts = normalizeIntentSourceVerdicts(details?.sourceVerdicts ?? []);
    } catch {
      // Preserve the original backend error even if optional diagnostics are malformed.
    }
    intentQuoteFailure = {
      code: typeof data.code === 'string' ? data.code : undefined,
      subcode,
      errorId: typeof data.errorId === 'string' ? data.errorId : undefined,
      retryable: subcode === 'PROVIDER_UNAVAILABLE',
      sourceVerdicts,
      providerReasons: Array.isArray(details?.providerReasons)
        ? details.providerReasons.filter((reason): reason is string => typeof reason === 'string')
        : [],
      details: details ?? {},
    };
  }
  return {
    error: typeof data.message === 'string' ? data.message : formatUnknownError(error),
    middlewareCode: typeof data.code === 'string' ? data.code : undefined,
    middlewareSubcode: typeof data.subcode === 'string' ? data.subcode : undefined,
    errorId: typeof data.errorId === 'string' ? data.errorId : undefined,
    middlewareDetails: details,
    httpStatus,
    intentQuoteFailure,
  };
};

const mapMiddlewareError = (
  error: unknown,
  operation: keyof typeof intentRequestFailures
): BackendError => {
  const details = middlewareErrorDetails(error);
  const key = [details.middlewareSubcode, details.middlewareCode].find(
    (value): value is string =>
      typeof value === 'string' && Object.hasOwn(middlewareFailures, value)
  );
  let mapped = key ? middlewareFailures[key] : undefined;
  const response = isRecord(error) && isRecord(error.response) ? error.response : undefined;
  const payload = isRecord(response?.data) ? response.data : undefined;
  const message = typeof payload?.message === 'string' ? payload.message.trim() : '';
  // Future middleware codes can still carry useful messages. HTTP and network fallbacks
  // apply when the response does not contain a usable error envelope.
  if (!mapped && !message) {
    if (typeof response?.status === 'number') {
      const httpCode = httpFailureCodes[response.status];
      mapped = httpCode ? middlewareFailures[httpCode] : undefined;
    } else if (isRecord(error)) {
      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        mapped = middlewareFailures.UPSTREAM_TIMEOUT;
      } else if (error.code === 'ERR_NETWORK') {
        mapped = [
          ERROR_CODES.BACKEND_NETWORK_ERROR,
          'Unable to reach the swap service. Check your connection and try again.',
        ];
      }
    }
  }
  const fallback = intentRequestFailures[operation];
  return new BackendError(mapped?.[0] ?? fallback[0], mapped?.[1] ?? (message || fallback[1]), {
    context: { service: 'middleware' },
    details: { operation, ...details },
  });
};

const intentChainParams = (constraints?: IntentRouteConstraints): URLSearchParams => {
  const params = new URLSearchParams();
  for (const provider of constraints?.providers ?? []) params.append('provider', provider);
  const appendLegs = (
    prefix: 'source' | 'destination',
    legs?: NonNullable<IntentRouteConstraints['sources']>
  ) => {
    const fields = ['chainId', 'tokenAddress', 'amountRaw'] as const;
    for (const field of fields) {
      const populated = (legs ?? []).filter((leg) => leg[field] !== undefined).length;
      if (populated > 0 && populated !== legs?.length) {
        throw Errors.invalidInput(`${prefix} ${field} must be supplied for every constrained leg`);
      }
    }
    for (const leg of legs ?? []) {
      if (leg.chainId === undefined && leg.tokenAddress === undefined) {
        throw Errors.invalidInput(`${prefix} constraints require chainId or tokenAddress`);
      }
      if (leg.chainId !== undefined) {
        if (!Number.isInteger(leg.chainId) || leg.chainId <= 0) {
          throw Errors.invalidInput(`${prefix} chainId must be a positive integer`);
        }
        params.append(`${prefix}Chain`, `EVM_${leg.chainId}`);
      }
      if (leg.tokenAddress !== undefined) {
        if (!/^0x[0-9a-fA-F]{40}$/.test(leg.tokenAddress)) {
          throw Errors.invalidInput(`${prefix} tokenAddress must be an EVM address`);
        }
        params.append(`${prefix}Token`, leg.tokenAddress);
      }
      if (leg.amountRaw !== undefined) {
        if (leg.chainId === undefined || leg.tokenAddress === undefined) {
          throw Errors.invalidInput(`${prefix} amountRaw requires chainId and tokenAddress`);
        }
        if (leg.amountRaw < 0n) throw Errors.invalidInput(`${prefix} amountRaw cannot be negative`);
        params.append(`${prefix}Amount`, leg.amountRaw.toString());
      }
    }
  };
  appendLegs('source', constraints?.sources);
  appendLegs('destination', constraints?.destinations);
  const sourceSized = constraints?.sources?.some((leg) => leg.amountRaw !== undefined) ?? false;
  const destinationSized =
    constraints?.destinations?.some((leg) => leg.amountRaw !== undefined) ?? false;
  if (
    Number(sourceSized) + Number(destinationSized) + Number(constraints?.valueUsd !== undefined) >
    1
  ) {
    throw Errors.invalidInput(
      'Use only one sizing mode: source amounts, destination amounts, or valueUsd'
    );
  }
  if (constraints?.valueUsd !== undefined) {
    if (!Number.isFinite(constraints.valueUsd) || constraints.valueUsd < 0) {
      throw Errors.invalidInput('valueUsd must be a non-negative finite number');
    }
    params.set('valueUsd', constraints.valueUsd.toString());
  }
  return params;
};

export const createMiddlewareClient = (
  middlewareURL: string,
  options?: { clientId?: string; timing?: TimingSpanHooks; captureNetworkTiming?: boolean }
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
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'x-nexus-client-id': options?.clientId,
      'x-nexus-surface': 'nexus-sdk',
      'x-nexus-surface-version': version,
    },
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
  configureTiming(options);

  const request = async <T>(
    operation: keyof typeof intentRequestFailures,
    run: () => Promise<T>
  ): Promise<T> => {
    try {
      return await run();
    } catch (error) {
      if (error instanceof NexusError) throw error;
      throw mapMiddlewareError(error, operation);
    }
  };

  const getIntentChains: MiddlewareClient['getIntentChains'] = (constraints) =>
    request('chains request', async () =>
      normalizeIntentChains(
        (
          await client.get(`${INTENT_API_PREFIX}/chains`, {
            params: intentChainParams(constraints),
          })
        ).data
      )
    );

  const getIntentTokens: MiddlewareClient['getIntentTokens'] = (query = {}) =>
    request('tokens request', async () => {
      const offset = query.offset ?? 0;
      const limit = query.limit ?? 50;
      if (!Number.isInteger(offset) || offset < 0) {
        throw Errors.invalidInput('token offset must be a non-negative integer');
      }
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
        throw Errors.invalidInput('token limit must be an integer from 1 to 1000');
      }
      const params = new URLSearchParams();
      if (query.chainId !== undefined) {
        if (!Number.isInteger(query.chainId) || query.chainId <= 0) {
          throw Errors.invalidInput('token chainId must be a positive integer');
        }
        params.set('chainId', `EVM_${query.chainId}`);
      }
      for (const provider of query.providers ?? []) params.append('provider', provider);
      for (const field of ['name', 'symbol', 'contract'] as const) {
        if (query[field] !== undefined) params.set(field, query[field]);
      }
      params.set('offset', offset.toString());
      params.set('limit', limit.toString());
      const page = normalizeIntentTokens(
        (await client.get(`${INTENT_API_PREFIX}/tokens`, { params })).data
      );
      if (
        page.offset !== offset ||
        page.limit > limit ||
        page.tokens.length > page.limit ||
        (page.tokens.length > 0 && offset + page.tokens.length > page.total) ||
        (page.tokens.length === 0 && offset < page.total)
      ) {
        throw Errors.backend('Invalid Better Intent token pagination', { service: 'middleware' });
      }
      return page;
    });

  const getIntentBalances: MiddlewareClient['getIntentBalances'] = (address, options) =>
    request('balances request', async () =>
      normalizeIntentBalances(
        (
          await client.get(`${INTENT_API_PREFIX}/balances/${address}`, {
            ...(options?.attemptId ? { headers: attemptHeaders(options.attemptId) } : {}),
            params: {
              refresh: options?.refresh ?? false,
              provider:
                options?.providers?.length === 1 ? options.providers[0] : options?.providers,
            },
          })
        ).data
      )
    );

  const getIntentQuote: MiddlewareClient['getIntentQuote'] = (quoteRequest, attemptId) =>
    request('quote request', async () =>
      normalizeIntentQuote(
        (
          await client.post(`${INTENT_API_PREFIX}/quote`, quoteRequest, {
            headers: attemptHeaders(attemptId),
          })
        ).data
      )
    );

  const submitIntent: MiddlewareClient['submitIntent'] = (submitRequest, attemptId) =>
    request('submit request', async () =>
      normalizeIntentSubmitResponse(
        (
          await client.post(`${INTENT_API_PREFIX}/submit`, submitRequest, {
            headers: attemptHeaders(attemptId),
          })
        ).data
      )
    );

  const getIntentStatus: MiddlewareClient['getIntentStatus'] = (id, attemptId) =>
    request('status request', async () => {
      const [statusResponse, detailResponse] = await Promise.all([
        client.get(`${INTENT_API_PREFIX}/status/${id}`, { headers: attemptHeaders(attemptId) }),
        client.get(`${INTENT_API_PREFIX}/rff/${id}`, { headers: attemptHeaders(attemptId) }),
      ]);
      return normalizeIntentStatus(statusResponse.data, detailResponse.data);
    });

  const listIntentHistory = (query: IntentHistoryQuery = {}): Promise<IntentHistoryResult> =>
    request('history request', async () => {
      const [nexusResponse, externalResponse] = await Promise.all([
        client.get(`${INTENT_API_PREFIX}/rffs`, { params: query }),
        client.get(`${INTENT_API_PREFIX}/rffs-external`, { params: query }),
      ]);
      const nexus = normalizeIntentHistory(nexusResponse.data, 'nexus-v2');
      // External history can contain Mayan, Relay, or future providers. Do not
      // invent an attribution when middleware has not returned one.
      const external = normalizeIntentHistory(externalResponse.data);
      return {
        total: nexus.total + external.total,
        intents: [...nexus.intents, ...external.intents].sort(
          (left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0)
        ),
      };
    });

  return {
    getIntentChains,
    getIntentTokens,
    getIntentBalances,
    getIntentQuote,
    submitIntent,
    getIntentStatus,
    listIntentHistory,
    configureTiming,
    destroy: () => uninstallTiming(),
  };
};
