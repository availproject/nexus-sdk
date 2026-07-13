import type {
  ApprovalResult,
  ApprovalsByChain,
  BalancesByChain,
  BridgeLeg,
  BridgeProviderRequest,
  BridgeProviderResponse,
  CreateRffPayload,
  CreateRffResponse,
  ListRffsParams,
  MayanQuote,
  MayanQuoteRequest,
  MayanQuoteResponse,
  Universe as NexusUniverse,
  RecordMayanNativeTxPayload,
  RecordMayanNativeTxResponse,
  RFF,
  RFFListResponse,
  RFFRequest,
} from '@avail-project/nexus-types';
import { mayanQuoteSchema } from '@avail-project/nexus-types/rff';
import axios from 'axios';
import Decimal from 'decimal.js';
import type { Hex } from 'viem';
import { formatUnits } from 'viem';
import { z } from 'zod';
import { installAxiosNetworkTiming } from '../analytics/network-timing';
import {
  type DeploymentResponse,
  type MiddlewareErrorEnvelope,
  type OraclePriceResponse,
  PermitVariant,
  type TimingSpanHooks,
  type UnifiedBalanceResponseData,
  Universe,
} from '../domain';
import { ZERO_ADDRESS } from '../domain/constants/addresses';
import { BackendError, ERROR_CODES, Errors, formatUnknownError } from '../domain/errors';
import { logger } from '../domain/utils';
import { addressString, hexString } from '../domain/utils/validation';
import { convertAddressByUniverse } from '../services/addresses';
import { equalFold } from '../services/strings';
import { getFallbackTokenLogoDataUri } from '../services/token-logo';
import { EADDRESS } from '../swap/constants';
import { createSafeMiddlewareClient } from '../swap/safe/client';
import type {
  CreateSafeExecuteTxRequest,
  CreateSafeExecuteTxResponse,
  EnsureSafeAccountRequest,
  EnsureSafeAccountResponse,
  GetSafeAccountAddressRequest,
  GetSafeAccountAddressResponse,
} from '../swap/safe/types';
import type { FlatBalance, SBCResult, SBCTx } from '../swap/types';
import { encodeChainIdToBytes32, parseHexToTokenBytes } from './encoding';
import type { SimulationRequest, SimulationResponse } from './types';

export type MiddlewareClient = {
  getBalances: (address: Hex, universe: number) => Promise<UnifiedBalanceResponseData[]>;
  createApprovals: (approvals: ApprovalsByChain) => Promise<ApprovalResult[]>;
  listRFFs: (params?: ListRffsParams) => Promise<RFFListResponse>;
  submitRFF: (payload: CreateRffPayload) => Promise<CreateRffResponse>;
  reportMayanNativeTx: (
    hash: Hex,
    payload: RecordMayanNativeTxPayload
  ) => Promise<RecordMayanNativeTxResponse>;
  getRFF: (hash: Hex) => Promise<RFF & { bridgeLegs?: BridgeLeg[] }>;
  getRFFStatus: (hash: Hex) => Promise<Pick<RFF, 'status'>>;
  getDeployment: () => Promise<DeploymentResponse>;
  getOraclePrices: () => Promise<OraclePriceResponse>;
  simulateBundleV2: (request: SimulationRequest) => Promise<{ gas: bigint[] }>;
  submitSBCs: (sbcTxs: SBCTx[]) => Promise<SBCResult[]>;
  getLiFiQuote: (params: Record<string, string>, exactOut?: boolean) => Promise<unknown>;
  getBebopQuote: (params: Record<string, string>) => Promise<unknown>;
  getFibrousQuote: (params: Record<string, string>) => Promise<unknown>;
  getZeroExQuote: (params: Record<string, string>) => Promise<unknown>;
  // 0x's indicative /price endpoint (amounts only, no calldata) — used for price surveys; /quote
  // stays for SERIOUS/executable quotes.
  getZeroExPrice: (params: Record<string, string>) => Promise<unknown>;
  // Mystic is a multi-endpoint POST/JSON API (quote → build); one proxy, the aggregator supplies the
  // versioned path. Bodies carry mixed types (numeric chainId/slippageBps + string amounts) rather
  // than the string-only GET query maps above.
  postMystic: (path: string, body: Record<string, unknown>) => Promise<unknown>;
  getRelayQuote: (params: Record<string, string>) => Promise<unknown>;
  // Token-metadata lookups (raw responses) used to enrich a metadata-less winner (0x/Mystic) when no
  // sibling quote supplies decimals: LiFi for non-Citrea (+USD price), Mystic-resolve for Citrea.
  getLiFiToken: (chainId: number, token: string) => Promise<unknown>;
  getMysticToken: (chainId: number, address: string) => Promise<unknown>;
  getSwapBalances: (address: Hex) => Promise<FlatBalance[]>;
  getQuote: (request: QuoteRequest) => Promise<QuoteResponse>;
  getMayanQuotes: (request: MayanQuoteRequest) => Promise<MayanQuoteResponse>;
  getBridgeProvider: (request: BridgeProviderRequest) => Promise<BridgeProviderResponse>;
  getSafeAccountAddress: (
    req: GetSafeAccountAddressRequest
  ) => Promise<GetSafeAccountAddressResponse>;
  ensureSafeAccount: (req: EnsureSafeAccountRequest) => Promise<EnsureSafeAccountResponse>;
  createSafeExecuteTx: (req: CreateSafeExecuteTxRequest) => Promise<CreateSafeExecuteTxResponse>;
  configureTiming: (options?: { timing?: TimingSpanHooks; captureNetworkTiming?: boolean }) => void;
  destroy: () => void;
};

export type MiddlewareBridgeBalanceClient = Pick<MiddlewareClient, 'getBalances'>;
export type MiddlewareSwapBalanceClient = Pick<MiddlewareClient, 'getSwapBalances'>;
export type MiddlewareApprovalCreatorClient = Pick<MiddlewareClient, 'createApprovals'>;
export type MiddlewareOracleClient = Pick<MiddlewareClient, 'getOraclePrices'>;
export type MiddlewareQuoteClient = Pick<MiddlewareClient, 'getQuote'>;
export type MiddlewareMayanQuoteClient = Pick<MiddlewareClient, 'getMayanQuotes'>;
export type MiddlewareBridgeProviderClient = Pick<MiddlewareClient, 'getBridgeProvider'>;
export type MiddlewareAggregatorQuoteClient = Pick<
  MiddlewareClient,
  | 'getLiFiQuote'
  | 'getBebopQuote'
  | 'getFibrousQuote'
  | 'getZeroExQuote'
  | 'getZeroExPrice'
  | 'postMystic'
  | 'getRelayQuote'
  | 'getLiFiToken'
  | 'getMysticToken'
>;
export type MiddlewareRffClient = Pick<MiddlewareClient, 'getRFF'>;
export type MiddlewareRffStatusClient = Pick<MiddlewareClient, 'getRFFStatus'>;
export type MiddlewareRffSubmitterClient = Pick<MiddlewareClient, 'submitRFF'>;
export type MiddlewareMayanNativeTxReporterClient = Pick<MiddlewareClient, 'reportMayanNativeTx'>;
export type MiddlewareSbcSubmitterClient = Pick<MiddlewareClient, 'submitSBCs'>;
export type MiddlewareSafeClient = Pick<
  MiddlewareClient,
  'getSafeAccountAddress' | 'ensureSafeAccount' | 'createSafeExecuteTx'
>;
export type MiddlewareSimulationClient = Pick<MiddlewareClient, 'simulateBundleV2'>;
export type MiddlewareConfigureTimingClient = Pick<MiddlewareClient, 'configureTiming'>;
export type MiddlewareDestroyClient = Pick<MiddlewareClient, 'destroy'>;

export type MiddlewareBridgeExecutionClient = MiddlewareRffSubmitterClient &
  MiddlewareRffClient &
  MiddlewareRffStatusClient &
  MiddlewareMayanNativeTxReporterClient;
export type MiddlewareBridgeClient = MiddlewareBridgeBalanceClient &
  MiddlewareApprovalCreatorClient &
  MiddlewareOracleClient &
  MiddlewareQuoteClient &
  MiddlewareMayanQuoteClient &
  MiddlewareBridgeProviderClient &
  MiddlewareBridgeExecutionClient;
export type MiddlewareBridgeAndExecuteClient = MiddlewareBridgeClient & MiddlewareSimulationClient;

export type MiddlewareSwapPreflightClient = MiddlewareSwapBalanceClient &
  MiddlewareOracleClient &
  MiddlewareQuoteClient &
  MiddlewareAggregatorQuoteClient &
  MiddlewareBridgeProviderClient &
  MiddlewareMayanQuoteClient &
  MiddlewareConfigureTimingClient &
  MiddlewareDestroyClient;
export type MiddlewareSwapExecutionClient = MiddlewareSwapBalanceClient &
  MiddlewareApprovalCreatorClient &
  MiddlewareSbcSubmitterClient &
  MiddlewareSafeClient &
  MiddlewareMayanQuoteClient &
  MiddlewareBridgeExecutionClient;
export type MiddlewareSwapClient = MiddlewareSwapPreflightClient & MiddlewareSwapExecutionClient;

export type { MayanQuote, MayanQuoteRequest, MayanQuoteResponse };

const SUPPORTED_MIDDLEWARE_UNIVERSES = ['EVM', 'TRON', 'FUEL', 'SVM'] as const;
const supportedMiddlewareUniverses = new Set<string>(SUPPORTED_MIDDLEWARE_UNIVERSES);
const universeSchema = z.enum(SUPPORTED_MIDDLEWARE_UNIVERSES);
const rffStatusSchema = z
  .object({
    status: z.enum(['created', 'deposited', 'fulfilled', 'expired']),
  })
  .passthrough();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isSupportedMiddlewareUniverse = (value: unknown): value is NexusUniverse =>
  typeof value === 'string' && supportedMiddlewareUniverses.has(value);

const getUniverseValue = (value: unknown): unknown => {
  if (!isRecord(value)) {
    return undefined;
  }

  return value.universe;
};

const hasSupportedUniverse = (value: unknown): boolean => {
  const universe = getUniverseValue(value);
  return universe === undefined || isSupportedMiddlewareUniverse(universe);
};

const filterRecordValues = (data: unknown, predicate: (value: unknown) => boolean): unknown => {
  if (!isRecord(data)) {
    return data;
  }

  return Object.fromEntries(Object.entries(data).filter(([, value]) => predicate(value)));
};

const filterArrayValues = (
  data: unknown,
  key: string,
  predicate: (value: unknown) => boolean
): unknown => {
  if (!isRecord(data)) {
    return data;
  }

  const values = data[key];
  if (!Array.isArray(values)) {
    return data;
  }

  return {
    ...data,
    [key]: values.filter(predicate),
  };
};

const normalizeEvmAddress = (value: Hex): Hex =>
  convertAddressByUniverse(value, Universe.ETHEREUM) as Hex;

const rffHasSupportedUniverses = (data: unknown): boolean => {
  if (!isRecord(data) || !isRecord(data.request)) {
    return true;
  }

  const request = data.request;

  if (
    request.destination_universe !== undefined &&
    !isSupportedMiddlewareUniverse(request.destination_universe)
  ) {
    return false;
  }

  if (
    Array.isArray(request.sources) &&
    request.sources.some((source) => !isSupportedMiddlewareUniverse(getUniverseValue(source)))
  ) {
    return false;
  }

  if (
    Array.isArray(request.parties) &&
    request.parties.some((party) => !isSupportedMiddlewareUniverse(getUniverseValue(party)))
  ) {
    return false;
  }

  return true;
};

const rffRequestSchema: z.ZodType<RFFRequest> = z.object({
  sources: z.array(
    z.object({
      universe: universeSchema,
      chain_id: z.string(),
      contract_address: hexString,
      value: z.string(),
      fee: z.string(),
    })
  ),
  destination_universe: universeSchema,
  destination_chain_id: z.string(),
  recipient_address: hexString,
  destinations: z.array(
    z.object({
      contract_address: hexString,
      value: z.string(),
    })
  ),
  nonce: z.string(),
  expiry: z.string(),
  parties: z.array(
    z.object({
      universe: universeSchema,
      address: hexString,
    })
  ),
});

const createRffResponseSchema: z.ZodType<CreateRffResponse> = z.object({
  request_hash: hexString,
});

const recordMayanNativeTxResponseSchema: z.ZodType<RecordMayanNativeTxResponse> = z.object({
  success: z.literal(true),
});

const rffSchemaBase = z.object({
  request: rffRequestSchema,
  request_hash: hexString,
  signature: hexString.optional(),
  status: z.enum(['created', 'deposited', 'fulfilled', 'expired']),
  solver: hexString.nullable(),
  created_at: z.number().optional(),
  updated_at: z.number().optional(),
});
const rffSchema: z.ZodType<RFF> = rffSchemaBase;

const bridgeLegSchema: z.ZodType<BridgeLeg> = z.object({
  requestHash: hexString,
  sourceIndex: z.number(),
  quote: z.custom<MayanQuote>((value) => typeof value === 'object' && value !== null),
  status: z.enum(['created', 'deposited', 'fulfilled', 'expired']),
  txHash: hexString.nullable(),
  explorerLink: z.string().nullable(),
  mayanExplorerLink: z.string().nullable(),
  error: z.string().nullable(),
});

const rffWithBridgeLegsSchema: z.ZodType<RFF & { bridgeLegs?: BridgeLeg[] }> = rffSchemaBase.extend(
  {
    bridgeLegs: z.array(bridgeLegSchema).optional(),
  }
);

const rffListResponseSchema: z.ZodType<RFFListResponse> = z.object({
  rffs: z.array(rffSchema),
  total: z.number(),
});

const balancesByChainSchema = z.record(
  z.string(),
  z.object({
    currencies: z.array(
      z.object({
        balance: z.string(),
        token_address: hexString,
        symbol: z.string(),
        decimals: z.number(),
        value: z.string(),
      })
    ),
    total_usd: z.string(),
    universe: universeSchema,
    errored: z.boolean(),
  })
);

const swapBalanceSchema = z.record(
  z.string(),
  z.object({
    currencies: z.array(
      z
        .object({
          balance: z.string(),
          token_address: hexString,
          name: z.string().optional().default(''),
          symbol: z.string(),
          decimals: z.number(),
          value: z.string(),
          logo: z.string().optional(),
        })
        .transform((currency) => ({
          ...currency,
          name: currency.name,
          logo: currency.logo ?? getFallbackTokenLogoDataUri(currency.symbol),
        }))
    ),
    total_usd: z.string(),
    universe: universeSchema,
    errored: z.boolean(),
  })
);

const approvalResultSchema: z.ZodType<ApprovalResult> = z.object({
  chainId: z.number(),
  address: hexString,
  errored: z.boolean(),
  txHash: hexString.optional(),
  message: z.string().optional(),
});

const sbcResultSchema = z.union([
  z.object({
    chainId: z.number().int(),
    address: addressString,
    errored: z.literal(false),
    txHash: hexString,
  }),
  z.object({
    chainId: z.number().int(),
    address: addressString,
    errored: z.literal(true),
    message: z.string(),
    code: z.string(),
    errorId: z.string(),
    subcode: z.string().optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
]) as z.ZodType<SBCResult>;

const permitVariantSchema = z.number().int().optional().default(1);

const permitVersionSchema = z
  .union([z.string(), z.number()])
  .transform((value) => Number(value))
  .pipe(z.number().int())
  .default(PermitVariant.EIP2612Canonical);

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
      .transform(({ eip7702Enabled, ...rest }) => ({
        ...rest,
        supports7702: eip7702Enabled,
      }))
  ),
});

const oraclePriceEntrySchema: z.ZodType<OraclePriceResponse[number]> = z.object({
  universe: universeSchema,
  chainId: z.number().int(),
  tokenAddress: addressString,
  tokenSymbol: z.string(),
  tokenDecimals: z.number().int(),
  priceUsd: z.union([z.number(), z.string()]).transform((value) => new Decimal(value)),
  timestamp: z.number().int(),
});

const oraclePriceResponseSchema: z.ZodType<{ priceData: OraclePriceResponse }> = z.object({
  priceData: z.array(oraclePriceEntrySchema),
});

// --- Quote types ---

export type QuoteRequest = {
  sources: { chain_id: string; contract_address: string }[];
  destination: { chain_id: string; contract_address: string };
};

export type QuoteSourceFee = {
  chainId: number;
  tokenAddress: Hex;
  depositFeeUsd: string;
  depositFeeToken: string;
  depositMayanFeeUsd: string;
  depositMayanFeeToken: string;
};

export type QuoteDestinationFee = {
  chainId: number;
  tokenAddress: Hex;
  fulfillmentFeeUsd: string;
  fulfillmentFeeToken: string;
};

export type QuoteResponse = {
  fulfillmentBps: number;
  sources: QuoteSourceFee[];
  destination: QuoteDestinationFee;
};

const bridgeProviderResponseSchema: z.ZodType<BridgeProviderResponse> = z.object({
  provider: z.enum(['nexus', 'mayan']),
});

const quoteResponseSchema: z.ZodType<QuoteResponse> = z.object({
  fulfillmentBps: z.number().int(),
  sources: z.array(
    z.object({
      chainId: z.number().int(),
      tokenAddress: addressString,
      depositFeeUsd: z.string(),
      depositFeeToken: z.string(),
      depositMayanFeeUsd: z.string(),
      depositMayanFeeToken: z.string(),
    })
  ),
  destination: z.object({
    chainId: z.number().int(),
    tokenAddress: addressString,
    fulfillmentFeeUsd: z.string(),
    fulfillmentFeeToken: z.string(),
  }),
});

const mayanQuoteResponseSchema: z.ZodType<MayanQuoteResponse> = z.object({
  destination: z.object({
    chainId: z.number().int(),
    tokenAddress: addressString,
  }),
  quotes: z.array(
    z.object({
      source: z.object({
        chainId: z.number().int(),
        tokenAddress: addressString,
        amount: z.string(),
      }),
      mayanQuote: mayanQuoteSchema,
    })
  ),
});

const parseMiddlewareResponse = <T>(schema: z.ZodType<T>, data: unknown, context: string): T => {
  const result = schema.safeParse(data);
  logger.debug('parseMiddlewareResponse', {
    result,
  });
  if (!result.success) {
    throw new BackendError(ERROR_CODES.BACKEND_ERROR, `Invalid middleware response: ${context}`, {
      context: { service: 'middleware' },
      details: { endpoint: context, issues: result.error.issues },
    });
  }

  logger.debug('parseMiddlewareResponse', {
    data,
  });
  return result.data;
};

// Lenient: `code` is a plain string so unknown/new server codes are captured verbatim rather than
// rejected. The middleware returns this envelope as the body of every HTTP error and per-item in
// SBC/approval result arrays.
const middlewareErrorEnvelopeSchema = z.object({
  code: z.string(),
  message: z.string(),
  errorId: z.string(),
  subcode: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

const extractMiddlewareError = (error: unknown): MiddlewareErrorEnvelope | undefined => {
  const data = (error as { response?: { data?: unknown } } | null | undefined)?.response?.data;
  const result = middlewareErrorEnvelopeSchema.safeParse(data);
  return result.success ? (result.data as MiddlewareErrorEnvelope) : undefined;
};

// Detail bag threaded into every middleware BackendError. When the failure carries the typed
// envelope, surface code/subcode/errorId/details as first-class detail fields (SigNoz correlation +
// frontend branching); otherwise fall back to the raw message.
const middlewareErrorDetails = (error: unknown): Record<string, unknown> => {
  const envelope = extractMiddlewareError(error);
  if (!envelope) {
    const message = formatUnknownError(error);
    return { error: message };
  }
  return {
    error: envelope.message,
    middlewareCode: envelope.code,
    middlewareSubcode: envelope.subcode,
    errorId: envelope.errorId,
    middlewareDetails: envelope.details,
  };
};

const groupSbcTxsByChain = (sbcTxs: SBCTx[]): Record<number, SBCTx[]> =>
  sbcTxs.reduce<Record<number, SBCTx[]>>((acc, tx) => {
    (acc[tx.chainId] ??= []).push(tx);
    return acc;
  }, {});

/**
 * Create middleware client
 */
export const createMiddlewareClient = (
  middlewareURL: string,
  timingOptions?: {
    timing?: TimingSpanHooks;
    captureNetworkTiming?: boolean;
  }
): MiddlewareClient => {
  try {
    const httpUrl = new URL(middlewareURL);
    if (httpUrl.protocol !== 'http:' && httpUrl.protocol !== 'https:') {
      throw new Error('Invalid protocol');
    }
  } catch {
    throw Errors.invalidInput(`Invalid middleware HTTP URL: ${middlewareURL}`);
  }

  const client = axios.create({
    baseURL: middlewareURL,
    timeout: 30000,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });

  // biome-ignore lint/suspicious/noEmptyBlockStatements: initializing to empty
  let uninstallTiming = () => {};

  const configureTiming = (options?: {
    timing?: TimingSpanHooks;
    captureNetworkTiming?: boolean;
  }) => {
    uninstallTiming();
    uninstallTiming = installAxiosNetworkTiming(client, {
      timing: options?.timing,
      enabled: options?.captureNetworkTiming !== false,
      spanName: 'network.middleware.request',
    });
  };
  configureTiming(timingOptions);

  const getBalances = async (
    address: Hex,
    universe: number
  ): Promise<UnifiedBalanceResponseData[]> => {
    try {
      const universeStr = universeToString(universe);
      logger.debug('getBalancesFromMiddleware', { address, universe: universeStr });

      const response = await client.get<BalancesByChain>(
        `/api/v1/balance/${universeStr}/${address}`
      );

      logger.debug('getBalancesFromMiddleware:response', { data: response.data });
      const payload = parseMiddlewareResponse(
        balancesByChainSchema,
        filterRecordValues(response.data, hasSupportedUniverse),
        'balances'
      );
      return adaptBalanceFormat(payload);
    } catch (error) {
      logger.error('getBalancesFromMiddleware:error', error);
      throw new BackendError(
        ERROR_CODES.BACKEND_BALANCES_FETCH_FAILED,
        'Failed to fetch balances from middleware',
        {
          context: { service: 'middleware' },
          details: { address, universe, ...middlewareErrorDetails(error) },
        }
      );
    }
  };

  const getDeployment = async (): Promise<DeploymentResponse> => {
    try {
      logger.debug('getDeploymentFromMiddleware');

      const response = await client.get<DeploymentResponse>('/deployment');

      logger.debug('getDeploymentFromMiddleware:response', { data: response.data });
      return parseMiddlewareResponse(
        deploymentResponseSchema,
        filterArrayValues(response.data, 'chains', hasSupportedUniverse),
        'deployment'
      );
    } catch (error) {
      logger.error('getDeploymentFromMiddleware:error', error);
      throw new BackendError(
        ERROR_CODES.BACKEND_DEPLOYMENT_FETCH_FAILED,
        'Failed to fetch deployment from middleware',
        {
          context: { service: 'middleware' },
          details: { ...middlewareErrorDetails(error) },
        }
      );
    }
  };

  const submitRFF = async (payload: CreateRffPayload): Promise<CreateRffResponse> => {
    try {
      logger.debug('submitRffToMiddleware', { payload });

      const response = await client.post<CreateRffResponse>('/api/v1/rff', payload);

      logger.debug('submitRffToMiddleware:response', { data: response.data });
      return parseMiddlewareResponse(createRffResponseSchema, response.data, 'submitRFF');
    } catch (error) {
      logger.error('submitRffToMiddleware:error', error);
      throw new BackendError(
        ERROR_CODES.BACKEND_RFF_SUBMIT_FAILED,
        'Failed to submit RFF to middleware',
        {
          context: { service: 'middleware' },
          details: { ...middlewareErrorDetails(error) },
        }
      );
    }
  };

  const reportMayanNativeTx = async (
    hash: Hex,
    payload: RecordMayanNativeTxPayload
  ): Promise<RecordMayanNativeTxResponse> => {
    try {
      logger.debug('reportMayanNativeTxToMiddleware', { hash, payload });

      const response = await client.post<RecordMayanNativeTxResponse>(
        `/api/v1/rff/${hash}/mayan-native-tx`,
        payload
      );

      logger.debug('reportMayanNativeTxToMiddleware:response', { data: response.data });
      return parseMiddlewareResponse(
        recordMayanNativeTxResponseSchema,
        response.data,
        'reportMayanNativeTx'
      );
    } catch (error) {
      logger.error('reportMayanNativeTxToMiddleware:error', error);
      throw new BackendError(
        ERROR_CODES.BACKEND_REPORT_MAYAN_TX_FAILED,
        'Failed to report Mayan native tx to middleware',
        {
          context: { service: 'middleware' },
          details: {
            endpoint: 'reportMayanNativeTxToMiddleware',
            ...middlewareErrorDetails(error),
          },
        }
      );
    }
  };

  const getOraclePrices = async (): Promise<OraclePriceResponse> => {
    try {
      logger.debug('getOraclePricesFromMiddleware');
      const response = await client.get<{ priceData: OraclePriceResponse }>('/api/v1/oracle');
      logger.debug('getOraclePricesFromMiddleware:response', { data: response.data });
      return parseMiddlewareResponse(
        oraclePriceResponseSchema,
        filterArrayValues(response.data, 'priceData', hasSupportedUniverse),
        'oraclePrices'
      ).priceData;
    } catch (error) {
      logger.error('getOraclePricesFromMiddleware:error', error);
      throw new BackendError(
        ERROR_CODES.BACKEND_ORACLE_PRICES_FAILED,
        'Failed to fetch oracle prices from middleware',
        {
          context: { service: 'middleware' },
          details: { ...middlewareErrorDetails(error) },
        }
      );
    }
  };

  const getRFF = async (hash: Hex): Promise<RFF & { bridgeLegs?: BridgeLeg[] }> => {
    try {
      logger.debug('getRffFromMiddleware', { hash });

      const response = await client.get<RFF & { bridgeLegs?: BridgeLeg[] }>(`/api/v1/rff/${hash}`);

      logger.debug('getRffFromMiddleware:response', { data: response.data });
      return parseMiddlewareResponse(rffWithBridgeLegsSchema, response.data, 'getRFF');
    } catch (error) {
      logger.error('getRffFromMiddleware:error', error);
      throw new BackendError(
        ERROR_CODES.BACKEND_RFF_FETCH_FAILED,
        'Failed to fetch RFF from middleware',
        {
          context: { service: 'middleware' },
          details: { hash, ...middlewareErrorDetails(error) },
        }
      );
    }
  };

  const getRFFStatus = async (hash: Hex): Promise<Pick<RFF, 'status'>> => {
    try {
      logger.debug('getRffStatusFromMiddleware', { hash });

      const response = await client.get<Pick<RFF, 'status'>>(`/api/v1/rff/${hash}`);

      logger.debug('getRffStatusFromMiddleware:response', { data: response.data });
      return parseMiddlewareResponse(rffStatusSchema, response.data, 'getRFFStatus');
    } catch (error) {
      logger.error('getRffStatusFromMiddleware:error', error);
      throw new BackendError(
        ERROR_CODES.BACKEND_RFF_STATUS_FAILED,
        'Failed to fetch RFF status from middleware',
        {
          context: { service: 'middleware' },
          details: { hash, ...middlewareErrorDetails(error) },
        }
      );
    }
  };

  const listRFFs = async (params?: ListRffsParams): Promise<RFFListResponse> => {
    try {
      logger.debug('listRffsFromMiddleware', { params });

      const response = await client.get<RFFListResponse>('/api/v1/rffs', { params });

      logger.debug('listRffsFromMiddleware:response', { data: response.data });
      const payload = parseMiddlewareResponse(
        rffListResponseSchema,
        filterArrayValues(response.data, 'rffs', rffHasSupportedUniverses),
        'listRFFs'
      );
      return payload;
    } catch (error) {
      logger.error('listRffsFromMiddleware:error', error);
      throw new BackendError(
        ERROR_CODES.BACKEND_RFF_LIST_FAILED,
        'Failed to list RFFs from middleware',
        {
          context: { service: 'middleware' },
          details: { params, ...middlewareErrorDetails(error) },
        }
      );
    }
  };
  const createApprovals = async (approvals: ApprovalsByChain): Promise<ApprovalResult[]> => {
    try {
      logger.debug('createApprovalsViaMiddleware', {
        expectedChains: Object.keys(approvals).length,
        approvals,
      });
      const response = await client.post<ApprovalResult[]>(
        '/api/v2/create-sponsored-approvals',
        approvals
      );
      logger.debug('createApprovalsViaMiddleware:response', { data: response.data });
      return parseMiddlewareResponse(z.array(approvalResultSchema), response.data, 'approvals');
    } catch (error) {
      logger.error('createApprovalsViaMiddleware:error', error);
      throw new BackendError(
        ERROR_CODES.BACKEND_APPROVALS_WS_FAILED,
        'Failed to create approvals via middleware',
        {
          context: { service: 'middleware' },
          details: { ...middlewareErrorDetails(error) },
        }
      );
    }
  };

  const simulateBundleV2 = async (request: SimulationRequest): Promise<{ gas: bigint[] }> => {
    try {
      logger.debug('simulateBundleV2:request', { request });
      const response = await client.post<SimulationResponse>('/api/v1/gas/bundle-v2', request);
      logger.debug('simulateBundleV2:response', { data: response.data });

      const data = response.data;
      if (!Array.isArray(data)) {
        throw new BackendError(
          ERROR_CODES.BACKEND_SIMULATION_BUNDLE_FAILED,
          'Simulation middleware returned error',
          {
            context: { service: 'middleware' },
            details: {
              chainId: request.chainId,
              message: 'Bundle simulation returned invalid response shape',
            },
          }
        );
      }

      return { gas: data.map((d) => BigInt(d.gasLimit)) };
    } catch (error) {
      logger.error('simulateBundleV2:error', error);
      throw new BackendError(
        ERROR_CODES.BACKEND_SIMULATION_BUNDLE_FAILED,
        'Failed to call simulation middleware',
        {
          context: { service: 'middleware' },
          details: { chainId: request.chainId, ...middlewareErrorDetails(error) },
        }
      );
    }
  };

  const submitSBCs = async (sbcTxs: SBCTx[]): Promise<SBCResult[]> => {
    try {
      logger.debug('submitSBCs', { expectedCount: sbcTxs.length });
      const response = await client.post<SBCResult[]>(
        '/api/v2/create-sbc-tx',
        groupSbcTxsByChain(sbcTxs)
      );
      logger.debug('submitSBCs:response', { data: response.data });
      return parseMiddlewareResponse(z.array(sbcResultSchema), response.data, 'sbc results');
    } catch (error) {
      logger.error('submitSBCs:error', error);
      throw new BackendError(
        ERROR_CODES.BACKEND_SBC_SUBMIT_FAILED,
        'Failed to submit SBCs via middleware',
        {
          context: { service: 'middleware' },
          details: { ...middlewareErrorDetails(error) },
        }
      );
    }
  };

  const getLiFiQuote = async (
    params: Record<string, string>,
    exactOut = false
  ): Promise<unknown> => {
    const path = exactOut ? 'quote/toAmount' : 'quote';
    const response = await client.get(`/api/v1/proxy/lifi/${path}`, { params });
    return response.data;
  };

  const getBebopQuote = async (params: Record<string, string>): Promise<unknown> => {
    const { chain: chainName, ...nextParams } = params;
    const response = await client.get(`/api/v1/proxy/bebop/router/${chainName}/v1/quote`, {
      params: nextParams,
    });
    return response.data;
  };

  const getFibrousQuote = async (params: Record<string, string>): Promise<unknown> => {
    const { chain: chainName, ...nextParams } = params;
    const response = await client.get(`/api/v1/proxy/fibrous/${chainName}/v2/routeAndCallData`, {
      params: nextParams,
    });
    return response.data;
  };

  // LiFi token metadata (decimals/symbol/priceUSD) — enriches a lone 0x quote. `chain` accepts a
  // chain id; covers all non-Citrea chains (broader than LiFi's swap chain list).
  const getLiFiToken = async (chainId: number, token: string): Promise<unknown> => {
    const response = await client.get('/api/v1/proxy/lifi/token', {
      params: { chain: chainId.toString(), token },
    });
    return response.data;
  };

  // Mystic on-chain ERC-20 resolve (decimals/symbol/name, no price) — enriches a lone Mystic quote.
  const getMysticToken = async (chainId: number, address: string): Promise<unknown> => {
    const response = await client.get('/api/v1/proxy/mystic/v1/tokens/resolve', {
      params: { chainId: chainId.toString(), address },
    });
    return response.data;
  };

  const getZeroExQuote = async (params: Record<string, string>): Promise<unknown> => {
    const response = await client.get('/api/v1/proxy/zerox/swap/allowance-holder/quote', {
      params,
    });
    return response.data;
  };

  const getZeroExPrice = async (params: Record<string, string>): Promise<unknown> => {
    const response = await client.get('/api/v1/proxy/zerox/swap/allowance-holder/price', {
      params,
    });
    return response.data;
  };

  // Mystic's `/mystic/*` proxy forwards method + body to router.mysticfinance.xyz, so endpoints are
  // POSTs with a JSON body (not GET query params like the aggregators above). One proxy for all
  // Mystic endpoints — the aggregator passes the versioned path (e.g. 'v1/swap/quote').
  const postMystic = async (path: string, body: Record<string, unknown>): Promise<unknown> => {
    const response = await client.post(`/api/v1/proxy/mystic/${path}`, body);
    return response.data;
  };

  // Relay is a POST /quote/v2 with a JSON body (chain ids as numbers), unlike the GET aggregators.
  const getRelayQuote = async (params: Record<string, string>): Promise<unknown> => {
    const { originChainId, destinationChainId, ...rest } = params;
    const response = await client.post('/api/v1/proxy/relay/quote/v2', {
      ...rest,
      originChainId: Number(originChainId),
      destinationChainId: Number(destinationChainId),
    });
    return response.data;
  };

  const getSwapBalances = async (address: Hex): Promise<FlatBalance[]> => {
    try {
      const response = await client.get<BalancesByChain>(`/api/v1/swap-balance/EVM/${address}`);
      const payload = parseMiddlewareResponse(swapBalanceSchema, response.data, 'swapBalances');
      return balancesByChainToFlatBalances(payload);
    } catch (error) {
      logger.error('getSwapBalances:error', error);
      return [];
    }
  };

  const getQuote = async (request: QuoteRequest): Promise<QuoteResponse> => {
    try {
      logger.debug('getQuote', { request });
      const response = await client.post<QuoteResponse>('/api/v1/quote', request);
      logger.debug('getQuote:response', { data: response.data });
      return parseMiddlewareResponse(quoteResponseSchema, response.data, 'getQuote');
    } catch (error) {
      logger.error('getQuote:error', error);
      throw new BackendError(
        ERROR_CODES.BACKEND_GET_QUOTE_FAILED,
        'Failed to get quote from middleware',
        {
          context: { service: 'middleware' },
          details: { endpoint: 'getQuote', ...middlewareErrorDetails(error) },
        }
      );
    }
  };

  const getMayanQuotes = async (request: MayanQuoteRequest): Promise<MayanQuoteResponse> => {
    try {
      logger.debug('getMayanQuotes', { request });
      const response = await client.post<MayanQuoteResponse>('/api/v1/quotes-mayan', request);
      logger.debug('getMayanQuotes:response', { data: response.data });
      return parseMiddlewareResponse(mayanQuoteResponseSchema, response.data, 'getMayanQuotes');
    } catch (error) {
      logger.error('getMayanQuotes:error', error);
      throw new BackendError(
        ERROR_CODES.BACKEND_GET_MAYAN_QUOTE_FAILED,
        'Failed to get Mayan quotes from middleware',
        {
          context: { service: 'middleware' },
          details: { endpoint: 'getMayanQuotes', ...middlewareErrorDetails(error) },
        }
      );
    }
  };

  const getBridgeProvider = async (
    request: BridgeProviderRequest
  ): Promise<BridgeProviderResponse> => {
    try {
      logger.debug('getBridgeProvider', { request });
      const response = await client.post<BridgeProviderResponse>(
        '/api/v1/bridge-provider',
        request
      );
      logger.debug('getBridgeProvider:response', { data: response.data });
      return parseMiddlewareResponse(
        bridgeProviderResponseSchema,
        response.data,
        'getBridgeProvider'
      );
    } catch (error) {
      logger.error('getBridgeProvider:error', error);
      throw new BackendError(
        ERROR_CODES.BACKEND_GET_BRIDGE_PROVIDER_FAILED,
        'Failed to get bridge provider from middleware',
        {
          context: { service: 'middleware' },
          details: { endpoint: 'getBridgeProvider', ...middlewareErrorDetails(error) },
        }
      );
    }
  };

  const safe = createSafeMiddlewareClient(client);

  const wrapSafe = async <T>(
    label: string,
    errorCode: (typeof ERROR_CODES)[
      | 'BACKEND_SAFE_GET_ADDRESS_FAILED'
      | 'BACKEND_SAFE_ENSURE_FAILED'
      | 'BACKEND_SAFE_EXECUTE_FAILED'],
    detail: Record<string, unknown>,
    fn: () => Promise<T>
  ): Promise<T> => {
    try {
      return await fn();
    } catch (error) {
      logger.error(`${label}:error`, error);
      throw new BackendError(errorCode, `Failed to ${label} via middleware`, {
        context: { service: 'middleware' },
        details: { endpoint: label, ...middlewareErrorDetails(error), ...detail },
      });
    }
  };

  const getSafeAccountAddress = (req: GetSafeAccountAddressRequest) =>
    wrapSafe(
      'getSafeAccountAddress',
      ERROR_CODES.BACKEND_SAFE_GET_ADDRESS_FAILED,
      { chainId: req.chainId, owner: req.owner },
      () => safe.getSafeAccountAddress(req)
    );

  const ensureSafeAccount = (req: EnsureSafeAccountRequest) =>
    wrapSafe(
      'ensureSafeAccount',
      ERROR_CODES.BACKEND_SAFE_ENSURE_FAILED,
      { chainId: req.chainId, owner: req.owner, safeAddress: req.safeAddress },
      () => safe.ensureSafeAccount(req)
    );

  const createSafeExecuteTx = (req: CreateSafeExecuteTxRequest) =>
    wrapSafe(
      'createSafeExecuteTx',
      ERROR_CODES.BACKEND_SAFE_EXECUTE_FAILED,
      { chainId: req.chainId, safeAddress: req.safeAddress, to: req.to },
      () => safe.createSafeExecuteTx(req)
    );

  return {
    getBalances,
    createApprovals,
    listRFFs,
    submitRFF,
    reportMayanNativeTx,
    getRFF,
    getRFFStatus,
    getDeployment,
    getOraclePrices,
    simulateBundleV2,
    submitSBCs,
    getLiFiQuote,
    getBebopQuote,
    getFibrousQuote,
    getZeroExQuote,
    getZeroExPrice,
    getLiFiToken,
    getMysticToken,
    postMystic,
    getRelayQuote,
    getSwapBalances,
    getQuote,
    getMayanQuotes,
    getBridgeProvider,
    getSafeAccountAddress,
    ensureSafeAccount,
    createSafeExecuteTx,
    configureTiming,
    destroy: () => {
      uninstallTiming();
    },
  };
};

type BalanceEndpointResponse = z.infer<typeof balancesByChainSchema>;

const adaptBalanceFormat = (response: BalanceEndpointResponse): UnifiedBalanceResponseData[] => {
  const result: UnifiedBalanceResponseData[] = [];

  for (const chainIdStr in response) {
    const chainData = response[chainIdStr];
    const chainId = Number.parseInt(chainIdStr, 10);
    const chainIdBytes = encodeChainIdToBytes32(chainId);

    const currencies = chainData.currencies.map((c) => {
      return {
        balance: c.balance,
        token_address: parseHexToTokenBytes(c.token_address),
        value: c.value,
      };
    });

    result.push({
      chain_id: chainIdBytes,
      currencies,
      total_usd: chainData.total_usd,
      universe: apiUniverseToInternal(chainData.universe),
      errored: chainData.errored,
    });
  }

  return result;
};

const apiUniverseToInternal = (universe: NexusUniverse): Universe => {
  switch (universe) {
    case 'EVM':
      return Universe.ETHEREUM;
    case 'FUEL':
      return Universe.FUEL;
    case 'SVM':
      return Universe.SOLANA;
    case 'TRON':
      return Universe.TRON;
    default:
      throw Errors.internal('Unsupported universe from middleware', { universe });
  }
};

const balancesByChainToFlatBalances = (data: BalancesByChain): FlatBalance[] => {
  const balances: FlatBalance[] = [];
  for (const [chainIdStr, chain] of Object.entries(data)) {
    if (chain.errored) continue;
    const chainID = Number(chainIdStr);
    for (const c of chain.currencies) {
      if (c.balance === '0' || BigInt(c.balance) <= 0n) continue;
      balances.push({
        amount: formatUnits(BigInt(c.balance), c.decimals),
        chainID,
        decimals: c.decimals,
        logo: c.logo,
        name: c.name,
        symbol: c.symbol,
        tokenAddress: equalFold(c.token_address, ZERO_ADDRESS)
          ? (EADDRESS as Hex)
          : c.token_address,
        // Unpriced long-tail tokens come back with value '' — coerce to 0 so the asset
        // stays usable instead of carrying NaN through selection/sorting/display.
        value: Number.parseFloat(c.value) || 0,
      });
    }
  }
  return balances;
};

/**
 * Convert numeric universe to string for API
 */
const universeToString = (universe: number): string => {
  switch (universe) {
    case 0:
      return 'evm';
    default:
      throw new Error(`Unsupported universe: ${universe}`);
  }
};
