import Decimal from 'decimal.js';
import { getAddress, type Hex } from 'viem';
import { logger } from '../../domain/utils';
import { divDecimals } from '../../services/math';
import type { Aggregator, Quote, QuoteRequest } from './types';
import { QuoteType } from './types';
import { normalizeExpectedOutput } from './expected-output';

type BebopApi = 'aggregation' | 'rfq';

type BebopAggregatorOptions = {
  useRfq?: boolean;
};

const logQuoteFailure = (api: BebopApi | 'request', chainId: number, reason: unknown): void => {
  logger.debug('swap.route.aggregator.bebop_quote.failed', {
    api,
    chainId,
    message: reason instanceof Error ? reason.message : String(reason),
  });
};

// Bebop chain name mapping
const CHAIN_NAME_MAP: Record<number, string> = {
  1: 'ethereum',
  42161: 'arbitrum',
  10: 'optimism',
  8453: 'base',
  56: 'bsc',
  137: 'polygon',
  999: 'hyperevm',
  43114: 'avalanche',
};

export class BebopAggregator implements Aggregator {
  private readonly getQuote: (
    params: Record<string, string>,
    api?: BebopApi
  ) => Promise<unknown>;
  private readonly useRfq: boolean;

  constructor(
    getQuote: (params: Record<string, string>, api?: BebopApi) => Promise<unknown>,
    options: BebopAggregatorOptions = {}
  ) {
    this.getQuote = getQuote;
    this.useRfq = options.useRfq ?? true;
  }

  supportsChain(chainId: number): boolean {
    return chainId in CHAIN_NAME_MAP;
  }

  async getQuotes(requests: QuoteRequest[]): Promise<(Quote | null)[]> {
    return Promise.all(requests.map((req) => this.fetchQuote(req)));
  }

  private async fetchQuote(req: QuoteRequest): Promise<Quote | null> {
    const chainName = CHAIN_NAME_MAP[req.chainId];
    if (!chainName) return null;

    try {
      // Bebop keys its response token maps by checksummed address and validates input addresses,
      // so checksum everything we send and look up by the same form (mirrors ca-common).
      const sellToken = getAddress(req.inputToken);
      const buyToken = getAddress(req.outputToken);

      const params: Record<string, string | number | boolean> = {
        chain: chainName,
        sell_tokens: sellToken,
        buy_tokens: buyToken,
        taker_address: getAddress(req.userAddress),
        receiver_address: getAddress(req.recipientAddress),
        approval_type: 'Standard',
        gasless: false,
        source: 'arcana',
      };

      if (req.type === QuoteType.EXACT_OUT && 'outputAmount' in req) {
        params.buy_amounts = req.outputAmount.toString();
      } else if ('inputAmount' in req) {
        params.sell_amounts = req.inputAmount.toString();
      }

      const requests: Array<{ api: BebopApi; params: Record<string, string> }> = [
        { api: 'aggregation', params: params as Record<string, string> },
      ];
      if (this.useRfq) {
        requests.push({
          api: 'rfq',
          params: { ...params, skip_validation: 'true' } as Record<string, string>,
        });
      }

      const results = await Promise.allSettled(
        requests.map(({ api, params: apiParams }) => this.getQuote(apiParams, api))
      );
      const quotes: BebopQuoteData[] = [];
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          quotes.push(result.value as BebopQuoteData);
          return;
        }
        logQuoteFailure(requests[index].api, req.chainId, result.reason);
      });

      return this.parseResponse(
        quotes,
        sellToken,
        buyToken,
        req.type === QuoteType.EXACT_OUT
      );
    } catch (error) {
      logQuoteFailure('request', req.chainId, error);
      return null;
    }
  }

  private parseResponse(
    quotes: BebopQuoteData[],
    sellToken: Hex,
    buyToken: Hex,
    isExactOut: boolean
  ): Quote | null {
    const quote = selectBestBebopQuote(quotes, sellToken, buyToken, isExactOut);
    if (!quote) return null;

    const inputToken = quote.sellTokens[sellToken];
    const outputToken = quote.buyTokens[buyToken];

    if (!inputToken || !outputToken) return null;

    const outputAmountInDecimal = divDecimals(
      outputToken.minimumAmount,
      outputToken.decimals
    ).toFixed(outputToken.decimals);

    const inputAmountInDecimal = divDecimals(inputToken.amount, inputToken.decimals).toFixed(
      inputToken.decimals
    );

    const output: Quote['output'] = {
      contractAddress: buyToken,
      amount: outputAmountInDecimal,
      amountRaw: BigInt(outputToken.minimumAmount),
      decimals: outputToken.decimals,
      value: Decimal.mul(outputAmountInDecimal, outputToken.priceUsd ?? 0).toNumber(),
      priceUsd: outputToken.priceUsd,
      symbol: outputToken.symbol,
    };

    return {
      expiry: quote.expiry,
      input: {
        contractAddress: sellToken,
        amount: inputAmountInDecimal,
        amountRaw: BigInt(inputToken.amount),
        decimals: inputToken.decimals,
        value: Decimal.mul(inputAmountInDecimal, inputToken.priceUsd ?? 0).toNumber(),
        priceUsd: inputToken.priceUsd,
        symbol: inputToken.symbol,
      },
      output,
      expectedOutput: normalizeExpectedOutput(outputToken.amount, output),
      txData: {
        approvalAddress: quote.approvalTarget,
        tx: {
          to: quote.tx.to,
          data: quote.tx.data,
          value: quote.tx.value,
        },
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Bebop response types (internal)
// ---------------------------------------------------------------------------

type BebopQuoteData = {
  buyTokens: Record<
    Hex,
    {
      decimals: number;
      priceUsd?: number;
      symbol: string;
      amount?: string;
      minimumAmount: string;
    }
  >;
  sellTokens: Record<
    Hex,
    {
      amount: string;
      decimals: number;
      priceUsd?: number;
      symbol: string;
    }
  >;
  approvalTarget: Hex;
  tx: { to: Hex; data: Hex; value: Hex };
  expiry: number;
};

// Pick the user-relevant executable amount across the Aggregation and RFQ APIs: most protected
// output for EXACT_IN, least input for EXACT_OUT. Responses missing execution data, the requested
// token, or a parseable amount are skipped.
const selectBestBebopQuote = (
  quotes: BebopQuoteData[],
  sellToken: Hex,
  buyToken: Hex,
  isExactOut: boolean
): BebopQuoteData | null => {
  let best: BebopQuoteData | null = null;
  let bestMetric: bigint | null = null;
  for (const quote of quotes) {
    const buy = quote?.buyTokens?.[buyToken];
    const sell = quote?.sellTokens?.[sellToken];
    if (
      !buy ||
      !sell ||
      !quote.approvalTarget ||
      !quote.tx?.to ||
      !quote.tx.data ||
      quote.tx.value === undefined ||
      typeof quote.expiry !== 'number'
    ) {
      continue;
    }
    let metric: bigint;
    try {
      metric = isExactOut ? BigInt(sell.amount) : BigInt(buy.minimumAmount);
    } catch {
      continue;
    }
    if (bestMetric === null || (isExactOut ? metric < bestMetric : metric > bestMetric)) {
      best = quote;
      bestMetric = metric;
    }
  }
  return best;
};
