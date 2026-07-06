import Decimal from 'decimal.js';
import { getAddress, type Hex } from 'viem';
import { logger } from '../../domain/utils';
import { divDecimals } from '../../services/math';
import type { Aggregator, Quote, QuoteRequest } from './types';
import { QuoteType } from './types';

// Bebop chain name mapping
const CHAIN_NAME_MAP: Record<number, string> = {
  1: 'ethereum',
  42161: 'arbitrum',
  10: 'optimism',
  8453: 'base',
  56: 'bsc',
  137: 'polygon',
  534352: 'scroll',
  999: 'hyperevm',
  43114: 'avalanche',
};

export class BebopAggregator implements Aggregator {
  private readonly getQuote: (params: Record<string, string>) => Promise<unknown>;

  constructor(getQuote: (params: Record<string, string>) => Promise<unknown>) {
    this.getQuote = getQuote;
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
        skip_validation: 'true',
        gasless: false,
        source: 'arcana',
      };

      if (req.type === QuoteType.EXACT_OUT && 'outputAmount' in req) {
        params.buy_amounts = req.outputAmount.toString();
      } else if ('inputAmount' in req) {
        params.sell_amounts = req.inputAmount.toString();
      }

      const data = await this.getQuote(params as Record<string, string>);

      return this.parseResponse(
        data as BebopQuoteData,
        sellToken,
        buyToken,
        req.type === QuoteType.EXACT_OUT
      );
    } catch (error) {
      logger.debug('bebop:quote-failed', {
        chainId: req.chainId,
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private parseResponse(
    data: BebopQuoteData,
    sellToken: Hex,
    buyToken: Hex,
    isExactOut: boolean
  ): Quote | null {
    // Bebop returns several routes (PMMv3, JAMv2, …); pick the best for the user, not just [0].
    const route = selectBestBebopRoute(data.routes ?? [], sellToken, buyToken, isExactOut);
    if (!route) return null;

    // Bebop nests the token maps, tx, approvalTarget and expiry together under route.quote.
    const { quote } = route;

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
      output: {
        contractAddress: buyToken,
        amount: outputAmountInDecimal,
        amountRaw: BigInt(outputToken.minimumAmount),
        decimals: outputToken.decimals,
        value: Decimal.mul(outputAmountInDecimal, outputToken.priceUsd ?? 0).toNumber(),
        priceUsd: outputToken.priceUsd,
        symbol: outputToken.symbol,
      },
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

type BebopRoute = {
  quote: {
    buyTokens: Record<
      Hex,
      {
        decimals: number;
        priceUsd?: number;
        symbol: string;
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
};

type BebopQuoteData = {
  routes: BebopRoute[];
};

// Bebop returns several routes (PMMv3, JAMv2, …) and hints the winner via `bestPrice`. We pick by
// the user-relevant amount instead — most output for EXACT_IN, least input for EXACT_OUT — which is
// self-contained and consistent with how the SDK compares quotes across aggregators. Routes missing
// the requested token (or with an unparseable amount) are skipped.
const selectBestBebopRoute = (
  routes: BebopRoute[],
  sellToken: Hex,
  buyToken: Hex,
  isExactOut: boolean
): BebopRoute | null => {
  let best: BebopRoute | null = null;
  let bestMetric: bigint | null = null;
  for (const route of routes) {
    const buy = route.quote?.buyTokens?.[buyToken];
    const sell = route.quote?.sellTokens?.[sellToken];
    if (!buy || !sell) continue;
    let metric: bigint;
    try {
      metric = isExactOut ? BigInt(sell.amount) : BigInt(buy.minimumAmount);
    } catch {
      continue;
    }
    if (bestMetric === null || (isExactOut ? metric < bestMetric : metric > bestMetric)) {
      best = route;
      bestMetric = metric;
    }
  }
  return best;
};
