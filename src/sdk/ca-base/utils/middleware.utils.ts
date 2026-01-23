import axios, { AxiosInstance } from 'axios';
import { Hex } from 'viem';
import {
  V2BalanceResponse,
  V2ApprovalsByChain,
  V2ApprovalResponse,
  V2MiddlewareRffPayload,
  CreateRffResponse,
  V2RffResponse,
  ListRffsResponse,
  UnifiedBalanceResponseData,
} from '../../../commons';
import { logger } from '../../../commons/utils/logger';
import { Errors } from '../errors';

// ============================================================================
// Singleton Axios Client
// ============================================================================

let middlewareClient: AxiosInstance | null = null;

/**
 * Get or create a singleton axios client for the middleware
 */
export const getMiddlewareClient = (middlewareUrl: string): AxiosInstance => {
  if (!middlewareClient) {
    middlewareClient = axios.create({
      baseURL: middlewareUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }
  return middlewareClient;
};

// ============================================================================
// REST API Functions
// ============================================================================

/**
 * Adapts V2 balance response (JSON with string chainIds) to V1 format (msgpack with Uint8Array)
 * V2: { "42161": { currencies: [{ token_address: "0x...", balance, value }], ... } }
 * V1: [{ chain_id: Uint8Array(32), currencies: [{ token_address: Uint8Array(32), balance, value }] }]
 */
export const adaptV2BalanceToV1Format = (
  v2Response: V2BalanceResponse,
): UnifiedBalanceResponseData[] => {
  const result: UnifiedBalanceResponseData[] = [];

  for (const [chainIdStr, chainData] of Object.entries(v2Response)) {
    const chainId = parseInt(chainIdStr, 10);
    const chainIdBytes = new Uint8Array(32);
    const chainIdBigInt = BigInt(chainId);

    for (let i = 0; i < 32; i++) {
      chainIdBytes[31 - i] = Number((chainIdBigInt >> BigInt(i * 8)) & 0xFFn);
    }

    const currencies = chainData.currencies.map(c => {
      const tokenAddress = c.token_address.startsWith('0x')
        ? c.token_address.slice(2)
        : c.token_address;
      const tokenBytes = new Uint8Array(32);
      for (let i = 0; i < 20; i++) {
        tokenBytes[12 + i] = parseInt(tokenAddress.slice(i * 2, i * 2 + 2), 16);
      }

      return {
        balance: c.balance,
        token_address: tokenBytes,
        value: c.value,
      };
    });

    result.push({
      chain_id: chainIdBytes,
      currencies,
      total_usd: chainData.total_usd,
      universe: chainData.universe as 0 | 1,
      errored: chainData.errored,
    });
  }

  return result;
};

/**
 * Get balances from middleware
 * GET /balance/:universe/:addr
 */
export const getBalancesFromMiddleware = async (
  middlewareUrl: string,
  address: Hex,
  universe: number,
): Promise<UnifiedBalanceResponseData[]> => {
  try {
    const client = getMiddlewareClient(middlewareUrl);
    logger.debug('getBalancesFromMiddleware', { address, universe, middlewareUrl });

    const response = await client.get<V2BalanceResponse>(`/balance/${universe}/${address}`);

    logger.debug('getBalancesFromMiddleware:response', { data: response.data });
    return adaptV2BalanceToV1Format(response.data);
  } catch (error) {
    logger.error('getBalancesFromMiddleware:error', error);
    throw Errors.internal('Failed to fetch balances from middleware', {
      address,
      universe,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

/**
 * Submit RFF to middleware
 * POST /rff
 */
export const submitRffToMiddleware = async (
  middlewareUrl: string,
  payload: V2MiddlewareRffPayload,
): Promise<CreateRffResponse> => {
  try {
    const client = getMiddlewareClient(middlewareUrl);
    logger.debug('submitRffToMiddleware', { payload, middlewareUrl });

    const response = await client.post<CreateRffResponse>('/rff', payload);

    logger.debug('submitRffToMiddleware:response', { data: response.data });
    return response.data;
  } catch (error) {
    logger.error('submitRffToMiddleware:error', error);
    throw Errors.internal('Failed to submit RFF to middleware', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

/**
 * Get RFF status from middleware
 * GET /rff/:hash
 */
export const getRffFromMiddleware = async (
  middlewareUrl: string,
  hash: Hex,
): Promise<V2RffResponse> => {
  try {
    const client = getMiddlewareClient(middlewareUrl);
    logger.debug('getRffFromMiddleware', { hash, middlewareUrl });

    const response = await client.get<V2RffResponse>(`/rff/${hash}`);

    logger.debug('getRffFromMiddleware:response', { data: response.data });
    return response.data;
  } catch (error) {
    logger.error('getRffFromMiddleware:error', error);
    throw Errors.internal('Failed to fetch RFF from middleware', {
      hash,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

/**
 * List RFFs from middleware with optional filters
 * GET /rffs?address=...&status=...&limit=...
 */
export const listRffsFromMiddleware = async (
  middlewareUrl: string,
  params?: {
    address?: Hex;
    status?: 'created' | 'deposited' | 'fulfilled' | 'expired';
    limit?: number;
  },
): Promise<ListRffsResponse> => {
  try {
    const client = getMiddlewareClient(middlewareUrl);
    logger.debug('listRffsFromMiddleware', { params, middlewareUrl });

    const response = await client.get<ListRffsResponse>('/rffs', { params });

    logger.debug('listRffsFromMiddleware:response', { data: response.data });
    return response.data;
  } catch (error) {
    logger.error('listRffsFromMiddleware:error', error);
    throw Errors.internal('Failed to list RFFs from middleware', {
      params,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

// ============================================================================
// WebSocket Functions
// ============================================================================

/**
 * Create sponsored approvals via middleware WebSocket
 * WebSocket /create-sponsored-approvals
 */
export const createApprovalsViaMiddleware = async (
  middlewareUrl: string,
  approvals: V2ApprovalsByChain,
): Promise<V2ApprovalResponse[]> => {
  return new Promise((resolve, reject) => {
    try {
      // Convert HTTP URL to WebSocket URL
      const wsUrl = middlewareUrl.replace(/^http/, 'ws') + '/create-sponsored-approvals';
      logger.debug('createApprovalsViaMiddleware', { wsUrl, approvals });

      const ws = new WebSocket(wsUrl);
      const results: V2ApprovalResponse[] = [];
      let isConnected = false;

      const timeout = setTimeout(() => {
        if (ws.readyState !== WebSocket.CLOSED) {
          ws.close();
          reject(Errors.internal('WebSocket timeout waiting for approval responses'));
        }
      }, 120000); // 120 second timeout

      ws.onopen = () => {
        logger.debug('createApprovalsViaMiddleware:connected');
        isConnected = true;
        // Send the approvals data as JSON
        ws.send(JSON.stringify(approvals));
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          logger.debug('createApprovalsViaMiddleware:message', { message });

          // Handle status message
          if (message.status === 'connected') {
            logger.debug('createApprovalsViaMiddleware:status', { status: message.status });
            return;
          }

          // Handle approval response
          if (message.chainId !== undefined) {
            results.push(message as V2ApprovalResponse);
          }
        } catch (parseError) {
          logger.error('createApprovalsViaMiddleware:parse-error', parseError);
        }
      };

      ws.onerror = (error) => {
        clearTimeout(timeout);
        logger.error('createApprovalsViaMiddleware:error', error);
        reject(Errors.internal('WebSocket error during approval creation', {
          error: String(error),
        }));
      };

      ws.onclose = () => {
        clearTimeout(timeout);
        logger.debug('createApprovalsViaMiddleware:closed', { results });

        if (!isConnected) {
          reject(Errors.internal('WebSocket connection failed'));
        } else {
          resolve(results);
        }
      };
    } catch (error) {
      logger.error('createApprovalsViaMiddleware:error', error);
      reject(Errors.internal('Failed to create approvals via middleware', {
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  });
};
