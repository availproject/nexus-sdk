import Decimal from 'decimal.js';
import type { Hex } from 'viem';
import { divDecimals } from '../../services/math';
import { SLIPPAGE_FRACTION } from './constants';
import type { Aggregator, Quote, QuoteRequest, TokenInfo, TokenInfoProvider } from './types';
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

export class LiFiAggregator implements Aggregator, TokenInfoProvider {
  private readonly getQuote: (
    params: Record<string, string>,
    exactOut?: boolean
  ) => Promise<unknown>;
  private readonly getToken: (chainId: number, token: string) => Promise<unknown>;

  constructor(
    getQuote: (params: Record<string, string>, exactOut?: boolean) => Promise<unknown>,
    getToken: (chainId: number, token: string) => Promise<unknown>
  ) {
    this.getQuote = getQuote;
    this.getToken = getToken;
  }

  supportsChain(chainId: number): boolean {
    return ALLOWED_CHAINS.has(chainId);
  }

  // Token metadata to enrich a lone 0x quote (aggregateAggregators). LiFi's /v1/token covers all
  // non-Citrea chains (deliberately not gated by ALLOWED_CHAINS) and reports a USD price.
  async getTokenInfo(chainId: number, token: Hex): Promise<TokenInfo | null> {
    try {
      const data = await this.getToken(chainId, token);
      const raw = (Array.isArray(data) ? data[0] : data) as LiFiTokenResponse | undefined;
      if (!raw || typeof raw.decimals !== 'number') return null;
      const priceUsd = raw.priceUSD != null ? Number(raw.priceUSD) : undefined;
      return {
        decimals: raw.decimals,
        symbol: raw.symbol ?? '',
        priceUsd: priceUsd != null && !Number.isNaN(priceUsd) ? priceUsd : undefined,
      };
    } catch {
      return null;
    }
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
        slippage: SLIPPAGE_FRACTION,
        skipSimulation: true,
        order: 'CHEAPEST',
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

// /v1/token — a single token's on-chain metadata + USD price (LiFi may wrap it in an array).
type LiFiTokenResponse = {
  decimals: number;
  symbol: string;
  priceUSD?: string;
};

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
