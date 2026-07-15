import Decimal from 'decimal.js';
import type { Hex } from 'viem';
import { ZERO_ADDRESS } from '../../domain/constants/addresses';
import { logger } from '../../domain/utils';
import { isNativeAddress } from '../../services/addresses';
import { equalFold } from '../../services/strings';
import type { MiddlewareTokenPriceClient } from '../../transport';
import { EADDRESS } from '../constants';
import type { FlatBalance, OraclePriceResponse } from '../types';

const CITREA_CHAIN_ID = 4114;
const EXTERNAL_PRICE_TIMEOUT_MS = 2_000;
const FIBROUS_GRAPH_BASE_URL = 'https://graph.fibrous.finance';

export type ResolvedTokenPrice = {
  priceUsd: Decimal;
  source: 'oracle' | 'balance' | 'lifi' | 'relay' | 'fibrous';
};

type Inputs = {
  balances: FlatBalance[];
  oraclePrices: OraclePriceResponse;
  middlewareClient: MiddlewareTokenPriceClient;
};

const sameToken = (left: Hex, right: Hex): boolean =>
  isNativeAddress(left) && isNativeAddress(right) ? true : equalFold(left, right);

const parsePrice = (
  value: string | null,
  source: ResolvedTokenPrice['source']
): ResolvedTokenPrice | null => {
  if (value == null) return null;
  try {
    const priceUsd = new Decimal(value);
    return priceUsd.isFinite() && priceUsd.gt(0) ? { priceUsd, source } : null;
  } catch {
    return null;
  }
};

const withinExternalPriceBudget = <T>(promise: Promise<T>): Promise<T | null> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), EXTERNAL_PRICE_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      }
    );
  });

const fetchFibrousTokenPrice = async (address: Hex): Promise<ResolvedTokenPrice | null> => {
  try {
    const response = await fetch(`${FIBROUS_GRAPH_BASE_URL}/citrea/tokens/${address}`);
    if (!response.ok) return null;

    const data: unknown = await response.json();
    if (data == null || typeof data !== 'object' || Array.isArray(data)) return null;

    const value = (data as Record<string, unknown>).price;
    return parsePrice(
      typeof value === 'string' || typeof value === 'number' ? String(value) : null,
      'fibrous'
    );
  } catch {
    return null;
  }
};

export const createTokenPriceResolver = (inputs: Inputs) => {
  const cache = new Map<string, Promise<ResolvedTokenPrice | null>>();

  const resolveUncached = async (
    chainId: number,
    tokenAddress: Hex
  ): Promise<ResolvedTokenPrice | null> => {
    const oracle = inputs.oraclePrices.find(
      (entry) => entry.chainId === chainId && sameToken(entry.tokenAddress, tokenAddress)
    );
    if (oracle?.priceUsd.isFinite() && oracle.priceUsd.gt(0)) {
      return { priceUsd: oracle.priceUsd, source: 'oracle' };
    }

    const balance = inputs.balances.find(
      (entry) =>
        entry.chainID === chainId &&
        sameToken(entry.tokenAddress, tokenAddress) &&
        new Decimal(entry.amount).gt(0) &&
        new Decimal(entry.value).gt(0)
    );
    if (balance) {
      return {
        priceUsd: new Decimal(balance.value).div(balance.amount),
        source: 'balance',
      };
    }

    const middleware = inputs.middlewareClient as Partial<MiddlewareTokenPriceClient>;
    let external: Promise<ResolvedTokenPrice | null>;
    if (chainId === CITREA_CHAIN_ID) {
      external = fetchFibrousTokenPrice(
        isNativeAddress(tokenAddress) ? ZERO_ADDRESS : tokenAddress
      );
    } else {
      const lifi = Promise.resolve()
        .then(() =>
          middleware.getLiFiTokenPrice?.(
            chainId,
            isNativeAddress(tokenAddress) ? EADDRESS : tokenAddress
          )
        )
        .then((value) => parsePrice(value ?? null, 'lifi'));
      const relay = Promise.resolve()
        .then(() =>
          middleware.getRelayTokenPrice?.(
            chainId,
            isNativeAddress(tokenAddress) ? ZERO_ADDRESS : tokenAddress
          )
        )
        .then((value) => parsePrice(value ?? null, 'relay'));
      external = Promise.any(
        [lifi, relay].map(async (candidate) => {
          const price = await candidate;
          if (!price) throw new Error('token price unavailable');
          return price;
        })
      ).catch(() => null);
    }

    return withinExternalPriceBudget(external);
  };

  const resolve = (chainId: number, tokenAddress: Hex): Promise<ResolvedTokenPrice | null> => {
    const normalizedAddress = isNativeAddress(tokenAddress) ? ZERO_ADDRESS : tokenAddress;
    const key = `${chainId}:${normalizedAddress.toLowerCase()}`;
    const cached = cache.get(key);
    if (cached) return cached;

    const pending = resolveUncached(chainId, tokenAddress).then((price) => {
      logger.debug('swap.route.price.resolved', {
        chainId,
        tokenAddress,
        found: price != null,
        source: price?.source ?? 'none',
      });
      return price;
    });
    cache.set(key, pending);
    return pending;
  };

  return { resolve };
};
