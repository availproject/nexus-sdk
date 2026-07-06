import { type Hex, zeroAddress } from 'viem';
import { SLIPPAGE_BPS_STRING } from './constants';
import type { Aggregator, Quote, QuoteRequest } from './types';
import { QuoteType } from './types';

// Chains 0x's Swap API serves. Best-effort mainnet set; outside it we return null without a
// round-trip (mirrors LiFi's ALLOWED_CHAINS). Confirm/expand against
// https://docs.0x.org/introduction/supported-chains (or api.0x.org/sources).
const ALLOWED_CHAINS = new Set<number>([
  1, // Ethereum
  10, // Optimism
  56, // BSC
  137, // Polygon
  143, // Monad
  999, // HyperEVM
  5000, // Mantle
  8453, // Base
  42161, // Arbitrum
  43114, // Avalanche
  534352, // Scroll
]);

export class ZeroExAggregator implements Aggregator {
  private readonly getQuote: (params: Record<string, string>) => Promise<unknown>;

  constructor(getQuote: (params: Record<string, string>) => Promise<unknown>) {
    this.getQuote = getQuote;
  }

  async getQuotes(requests: QuoteRequest[]): Promise<(Quote | null)[]> {
    return Promise.all(requests.map((req) => this.fetchQuote(req)));
  }

  private async fetchQuote(req: QuoteRequest): Promise<Quote | null> {
    if (!ALLOWED_CHAINS.has(req.chainId)) return null;
    try {
      const isExactOut = req.type === QuoteType.EXACT_OUT;

      const params: Record<string, string> = {
        chainId: req.chainId.toString(),
        sellToken: req.inputToken,
        buyToken: req.outputToken,
        taker: req.userAddress,
        recipient: req.recipientAddress,
        slippageBps: SLIPPAGE_BPS_STRING,
      };
      if (isExactOut && 'outputAmount' in req) {
        params.buyAmount = req.outputAmount.toString();
      } else if ('inputAmount' in req) {
        params.sellAmount = req.inputAmount.toString();
      }

      const data = (await this.getQuote(params)) as ZeroExResponse;
      return parseResponse(data, req, isExactOut);
    } catch {
      return null;
    }
  }
}

// 0x returns amounts, token addresses and the tx — but no token decimals and no USD price. The
// adapter fills only what 0x reports; decimals, symbol and priceUsd are left as placeholders for
// aggregateAggregators to backfill from a sibling quote (same request ⇒ same token ⇒ exact
// decimals). A leg only 0x quoted has no sibling and is dropped there.
const parseResponse = (
  data: ZeroExResponse,
  req: QuoteRequest,
  isExactOut: boolean
): Quote | null => {
  if (data.liquidityAvailable === false || !data.transaction) return null;

  // Both modes use the slippage-protected bound: EXACT_IN floors the output (minBuyAmount),
  // EXACT_OUT caps the input (maxSellAmount) and delivers exactly buyAmount.
  const inputAmountRaw = BigInt(isExactOut ? data.maxSellAmount : data.sellAmount);
  const outputAmountRaw = BigInt(isExactOut ? data.buyAmount : data.minBuyAmount);

  return {
    input: placeholderSide(req.inputToken, inputAmountRaw),
    output: placeholderSide(req.outputToken, outputAmountRaw),
    txData: {
      approvalAddress: data.allowanceTarget ?? zeroAddress, // null for native sells (no approval)
      tx: { to: data.transaction.to, data: data.transaction.data, value: data.transaction.value },
    },
  };
};

// amount/decimals/symbol/value are placeholders — aggregateAggregators backfills them from a sibling.
const placeholderSide = (contractAddress: Hex, amountRaw: bigint): Quote['input'] => ({
  contractAddress,
  amountRaw,
  amount: '0',
  decimals: 0,
  value: 0,
  symbol: '',
});

// ---------------------------------------------------------------------------
// 0x response types (internal) — only the fields the adapter reads
// ---------------------------------------------------------------------------

type ZeroExResponse = {
  liquidityAvailable?: boolean;
  sellAmount: string;
  buyAmount: string;
  minBuyAmount: string;
  maxSellAmount: string;
  allowanceTarget: Hex | null;
  transaction?: { to: Hex; data: Hex; value: Hex };
};
