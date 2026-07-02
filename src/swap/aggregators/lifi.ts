import Decimal from 'decimal.js';
import type { Hex } from 'viem';
import { divDecimals } from '../../services/math';
import type { Aggregator, Quote, QuoteRequest } from './types';
import { QuoteType } from './types';

// LiFi exchanges to deny. openocean over-quotes everywhere; on HyperEVM (999)
// fly/hyperflow/liquidswap share one on-chain entry and over-quote native HYPE->USDC by
// 5-11%, causing InsufficientAmountOut (0xe52970aa) at execution.
const GLOBAL_DENY = ['openocean'];
const PER_CHAIN_DENY: Record<number, readonly string[]> = {
  999: ['fly', 'hyperflow', 'liquidswap'],
};
const denyExchangesFor = (chainId: number): string =>
  [...GLOBAL_DENY, ...(PER_CHAIN_DENY[chainId] ?? [])].join(',');

// Chains LiFi serves. Anything outside this set returns null immediately so we don't
// pay a network round-trip just to get a 404 back. Mirrors ca-common's
// `LiFiAllowedChains` (xcs/aggregator-support.ts).
const ALLOWED_CHAINS = new Set<number>([
  1, // Ethereum
  10, // Optimism
  56, // BSC
  137, // Polygon
  143, // Monad
  999, // HyperEVM
  4326, // MegaETH
  8453, // Base
  42161, // Arbitrum
  43114, // Avalanche
  8217, // Kaia
  534352, // Scroll
]);

export class LiFiAggregator implements Aggregator {
  private readonly getQuote: (
    params: Record<string, string>,
    exactOut?: boolean
  ) => Promise<unknown>;

  constructor(getQuote: (params: Record<string, string>, exactOut?: boolean) => Promise<unknown>) {
    this.getQuote = getQuote;
  }

  async getQuotes(requests: QuoteRequest[]): Promise<(Quote | null)[]> {
    return Promise.all(requests.map((req) => this.fetchQuote(req)));
  }

  private async fetchQuote(req: QuoteRequest): Promise<Quote | null> {
    if (!ALLOWED_CHAINS.has(req.chainId)) return null;
    try {
      const isExactOut = req.type === QuoteType.EXACT_OUT;
      const toAddress = req.recipientAddress;

      const params: Record<string, string | number | boolean> = {
        fromChain: req.chainId,
        toChain: req.chainId,
        fromToken: req.inputToken,
        toToken: req.outputToken,
        fromAddress: req.userAddress,
        toAddress,
        denyExchanges: denyExchangesFor(req.chainId),
        slippage: '0.01',
        skipSimulation: true,
      };

      if (isExactOut && 'outputAmount' in req) {
        params.toAmount = req.outputAmount.toString();
      } else if ('inputAmount' in req) {
        params.fromAmount = req.inputAmount.toString();
      }

      const data = await this.getQuote(params as Record<string, string>, isExactOut);

      return this.parseResponse(data as LiFiQuoteResponse, req);
    } catch {
      return null;
    }
  }

  private parseResponse(data: LiFiQuoteResponse, _req: QuoteRequest): Quote {
    const { estimate, action, transactionRequest } = data;

    const inputAmountRaw = BigInt(estimate.fromAmount);
    const outputAmountRaw = BigInt(estimate.toAmountMin);
    const inputAmount = divDecimals(inputAmountRaw, action.fromToken.decimals).toFixed();
    const outputAmount = divDecimals(outputAmountRaw, action.toToken.decimals).toFixed();

    return {
      input: {
        contractAddress: action.fromToken.address as Hex,
        amount: inputAmount,
        amountRaw: inputAmountRaw,
        decimals: action.fromToken.decimals,
        // value = delivered amount × token priceUSD (ca-common parity), not LiFi's fromAmountUSD.
        value: Decimal.mul(inputAmount, action.fromToken.priceUSD).toNumber(),
        priceUsd: Number(action.fromToken.priceUSD),
        symbol: action.fromToken.symbol,
      },
      output: {
        contractAddress: action.toToken.address as Hex,
        amount: outputAmount,
        amountRaw: outputAmountRaw,
        decimals: action.toToken.decimals,
        value: Decimal.mul(outputAmount, action.toToken.priceUSD).toNumber(),
        priceUsd: Number(action.toToken.priceUSD),
        symbol: action.toToken.symbol,
      },
      txData: {
        approvalAddress: estimate.approvalAddress as Hex,
        tx: {
          to: transactionRequest.to as Hex,
          data: transactionRequest.data as Hex,
          value: transactionRequest.value as Hex,
        },
      },
    };
  }
}

// ---------------------------------------------------------------------------
// LiFi response types (internal)
// ---------------------------------------------------------------------------

type LiFiQuoteResponse = {
  estimate: {
    fromAmount: string;
    toAmount: string;
    toAmountMin: string;
    approvalAddress: string;
    feeCosts: unknown[];
    gasCosts: unknown[];
  };
  action: {
    fromToken: { address: string; symbol: string; decimals: number; priceUSD: string };
    toToken: { address: string; symbol: string; decimals: number; priceUSD: string };
  };
  transactionRequest: {
    to: string;
    data: string;
    value: string;
  };
};
