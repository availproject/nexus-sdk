import axios from 'axios';
import type { Hex } from 'viem';
import type {
  CreateRffResponse,
  ListRffsResponse,
  UnifiedBalanceResponseData,
  V2ApprovalResponse,
  V2ApprovalsByChain,
  V2BalanceResponse,
  V2MiddlewareRffPayload,
  V2RffResponse,
} from '../../../commons';
import { logger } from '../../../commons/utils/logger';
import { Errors } from '../errors';

/**
 * Create middleware client
 */
const createMiddlewareClient = (middlewareURL: string, middlewareWSURL: string) => {
  const client = axios.create({
    baseURL: middlewareURL,
    timeout: 30000,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });

  const getBalances = async (
    address: Hex,
    universe: number
  ): Promise<UnifiedBalanceResponseData[]> => {
    try {
      const universeStr = universeToString(universe);
      logger.debug('getBalancesFromMiddleware', { address, universe: universeStr });

      const response = await client.get<V2BalanceResponse>(
        `/api/v1/balance/${universeStr}/${address}`
      );

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

  const submitRFF = async (payload: V2MiddlewareRffPayload): Promise<CreateRffResponse> => {
    try {
      logger.debug('submitRffToMiddleware', { payload });

      const response = await client.post<CreateRffResponse>('/api/v1/rff', payload);

      logger.debug('submitRffToMiddleware:response', { data: response.data });
      return response.data;
    } catch (error) {
      logger.error('submitRffToMiddleware:error', error);
      throw Errors.internal('Failed to submit RFF to middleware', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const getRFF = async (hash: Hex): Promise<V2RffResponse> => {
    try {
      logger.debug('getRffFromMiddleware', { hash });

      const response = await client.get<V2RffResponse>(`/api/v1/rff/${hash}`);

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
  const listRFFs = async (params?: {
    address?: Hex;
    status?: 'created' | 'deposited' | 'fulfilled' | 'expired';
    limit?: number;
  }): Promise<ListRffsResponse['rffs']> => {
    try {
      logger.debug('listRffsFromMiddleware', { params });

      const response = await client.get<ListRffsResponse>('/api/v1/rffs', { params });

      logger.debug('listRffsFromMiddleware:response', { data: response.data });
      return response.data.rffs;
    } catch (error) {
      logger.error('listRffsFromMiddleware:error', error);
      throw Errors.internal('Failed to list RFFs from middleware', {
        params,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
  const createApprovals = async (approvals: V2ApprovalsByChain): Promise<V2ApprovalResponse[]> => {
    const expectedChains = Object.keys(approvals).length;
    logger.debug('createApprovalsViaMiddleware', { expectedChains, approvals });

    return new Promise((resolve, reject) => {
      try {
        const wsURL = new URL(middlewareWSURL);
        logger.debug('createApprovalsViaMiddleware:connecting', { wsURL: wsURL.toString() });

        const ws = new WebSocket(wsURL.toString());
        const results: V2ApprovalResponse[] = [];
        let isConnected = false;

        const timeout = setTimeout(() => {
          logger.error('createApprovalsViaMiddleware:timeout', { results });
          if (ws.readyState !== WebSocket.CLOSED) {
            ws.close();
            reject(Errors.internal('WebSocket timeout waiting for approval responses'));
          }
        }, 120000);

        ws.onopen = () => {
          logger.debug('createApprovalsViaMiddleware:connected');
          isConnected = true;
          ws.send(JSON.stringify(approvals));
        };

        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data as string) as Record<string, unknown>;
            logger.debug('createApprovalsViaMiddleware:message', { message });

            if (message.status === 'connected') {
              return;
            }

            if (message.status === 'done' || message.status === 'complete') {
              clearTimeout(timeout);
              ws.close();
              return;
            }

            if (message.errored && message.chainId === undefined) {
              logger.error('createApprovalsViaMiddleware:middlewareError', {
                message: message.message,
              });
              clearTimeout(timeout);
              ws.close();
              return;
            }

            if (message.chainId !== undefined) {
              results.push(message as unknown as V2ApprovalResponse);
              if (results.length >= expectedChains) {
                clearTimeout(timeout);
                ws.close();
              }
            }
          } catch (parseError) {
            logger.error('createApprovalsViaMiddleware:parseError', parseError);
          }
        };

        ws.onerror = (error) => {
          clearTimeout(timeout);
          logger.error('createApprovalsViaMiddleware:error', error);
          reject(
            Errors.internal('WebSocket error during approval creation', {
              error: String(error),
            })
          );
        };

        ws.onclose = () => {
          clearTimeout(timeout);
          logger.debug('createApprovalsViaMiddleware:closed', { results });
          if (isConnected) {
            resolve(results);
          } else {
            reject(Errors.internal('WebSocket connection failed'));
          }
        };
      } catch (error) {
        logger.error('createApprovalsViaMiddleware:error', error);
        reject(
          Errors.internal('Failed to create approvals via middleware', {
            error: error instanceof Error ? error.message : String(error),
          })
        );
      }
    });
  };

  return {
    getBalances,
    createApprovals,
    listRFFs,
    submitRFF,
    getRFF,
  };
};

const adaptV2BalanceToV1Format = (v2Response: V2BalanceResponse): UnifiedBalanceResponseData[] => {
  const result: UnifiedBalanceResponseData[] = [];

  for (const [chainIdStr, chainData] of Object.entries(v2Response)) {
    const chainId = Number.parseInt(chainIdStr, 10);
    const chainIdBytes = new Uint8Array(32);
    const chainIdBigInt = BigInt(chainId);

    for (let i = 0; i < 32; i++) {
      chainIdBytes[31 - i] = Number((chainIdBigInt >> BigInt(i * 8)) & 0xffn);
    }

    const currencies = chainData.currencies.map((c) => {
      const tokenAddress = c.token_address.startsWith('0x')
        ? c.token_address.slice(2)
        : c.token_address;
      const tokenBytes = new Uint8Array(32);
      for (let i = 0; i < 20; i++) {
        tokenBytes[12 + i] = Number.parseInt(tokenAddress.slice(i * 2, i * 2 + 2), 16);
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
 * Convert numeric universe to string for API
 */
const universeToString = (universe: number): string => {
  switch (universe) {
    case 0:
      return 'evm';
    case 1:
      return 'tron';
    default:
      return 'evm';
  }
};

export { createMiddlewareClient };
