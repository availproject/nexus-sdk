import axios from 'axios';
import { getLogger } from '../../../commons';
import { Errors } from '../errors';
import { minutesToMs } from './common.utils';

const logger = getLogger();

const coinbasePrices = {
  lastUpdatedAt: 0,
  rates: {},
};

const COINBASE_UPDATE_INTERVAL = minutesToMs(1);

const getCoinbasePrices = async () => {
  if (coinbasePrices.lastUpdatedAt + COINBASE_UPDATE_INTERVAL < Date.now()) {
    try {
      const exchange = await axios.get<{
        data: { rates: Record<string, string> };
      }>('https://api.coinbase.com/v2/exchange-rates?currency=USD');
      coinbasePrices.rates = exchange.data.data.rates;
      coinbasePrices.lastUpdatedAt = Date.now();
    } catch (error) {
      logger.error('Failed to fetch Coinbase prices', error, { cause: 'INTERNAL_ERROR' });
      // Return cached rates if available, otherwise throw
      if (Object.keys(coinbasePrices.rates).length === 0) {
        throw Errors.internal('Failed to fetch exchange rates and no cache available');
      }
    }
  }
  return coinbasePrices.rates;
};

export { getCoinbasePrices };
