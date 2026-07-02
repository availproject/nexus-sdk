import axios from 'axios';
import { isEmptyObject } from 'es-toolkit';
import { getLogger } from '../domain';
import { ERROR_CODES, ExternalServiceError, formatUnknownError } from '../domain/errors';
import { minutesToMs } from './time';

const logger = getLogger();

const coinbasePrices: { lastUpdatedAt: number; rates: Record<string, string> } = {
  lastUpdatedAt: 0,
  rates: {},
};

const COINBASE_UPDATE_INTERVAL = minutesToMs(1);

export const getCoinbasePrices = async () => {
  if (coinbasePrices.lastUpdatedAt + COINBASE_UPDATE_INTERVAL < Date.now()) {
    try {
      const exchange = await axios.get<{
        data: { rates: Record<string, string> };
      }>('https://api.coinbase.com/v2/exchange-rates?currency=USD');
      coinbasePrices.rates = exchange.data.data.rates;
      coinbasePrices.lastUpdatedAt = Date.now();
    } catch (error) {
      logger.error('Failed to fetch Coinbase prices', error, {
        cause: 'EXTERNAL_EXCHANGE_RATE_FETCH_FAILED',
      });
      if (isEmptyObject(coinbasePrices.rates)) {
        throw new ExternalServiceError(
          ERROR_CODES.EXTERNAL_EXCHANGE_RATE_FETCH_FAILED,
          `Failed to fetch exchange rates and no cache available: ${formatUnknownError(error)}`,
          {
            context: { service: 'coinbase', operation: 'getCoinbaseRates' },
            details: { provider: 'coinbase' },
          }
        );
      }
    }
  }
  return coinbasePrices.rates;
};
