import { type Hex, toHex, zeroAddress } from 'viem';
import { SLIPPAGE_BPS } from './constants';
import type { Aggregator, Quote, QuoteRequest } from './types';
import { QuoteSeriousness, QuoteType } from './types';

// Chains Mystic Router serves in this SDK. Citrea-only for now (co-located with Fibrous); add
// Mystic's other chains (Flare 14, Plume 98866, …) here once validated.
const ALLOWED_CHAINS = new Set<number>([
  4114, // Citrea
]);

/**
 * Mystic Router is a two-step API: POST /v1/swap/quote returns ranked routes (amounts only, no token
 * metadata), then POST /v1/swap/build turns the chosen route into an unsigned tx. Like 0x it reports
 * no decimals/symbol/USD price, so those are left as placeholders for aggregateAggregators to
 * backfill from a sibling quote. EXACT_IN only — the quote endpoint takes `sellAmount`, not a buy
 * target.
 */
export class MysticAggregator implements Aggregator {
  // One POST proxy to the Mystic router; the adapter supplies the versioned path per endpoint.
  private readonly post: (path: string, body: Record<string, unknown>) => Promise<unknown>;

  constructor(post: (path: string, body: Record<string, unknown>) => Promise<unknown>) {
    this.post = post;
  }

  supportsChain(chainId: number): boolean {
    return ALLOWED_CHAINS.has(chainId);
  }

  async getQuotes(requests: QuoteRequest[]): Promise<(Quote | null)[]> {
    return Promise.all(requests.map((req) => this.fetchQuote(req)));
  }

  private async fetchQuote(req: QuoteRequest): Promise<Quote | null> {
    if (req.type !== QuoteType.EXACT_IN) return null; // quote endpoint is sellAmount-only
    if (!ALLOWED_CHAINS.has(req.chainId)) return null;

    try {
      const quoteBody: Record<string, unknown> = {
        chainId: req.chainId, // number, per Mystic's JSON schema
        sellToken: req.inputToken,
        buyToken: req.outputToken,
        sellAmount: req.inputAmount.toString(), // integer string, smallest unit
        taker: req.userAddress,
        recipient: req.recipientAddress,
        slippageBps: SLIPPAGE_BPS,
      };

      const quoteData = (await this.post('v1/swap/quote', quoteBody)) as MysticQuoteResponse;
      const best = quoteData.quotes?.[0]; // ranked by output, best first
      if (!best) return null;

      const inputAmountRaw = BigInt(best.sellAmount);
      const outputAmountRaw = BigInt(best.minBuyAmount); // slippage-protected floor, like 0x

      // Price surveys only compare amounts and are always re-quoted SERIOUS before execution
      // (swap/execution/source-swaps.ts), so skip the build call: it simulates on-chain, which is
      // wasteful per survey candidate and would drop otherwise-valid price data when the taker
      // can't execute yet.
      if (req.seriousness !== QuoteSeriousness.SERIOUS) {
        return {
          input: placeholderSide(req.inputToken, inputAmountRaw),
          output: placeholderSide(req.outputToken, outputAmountRaw),
          txData: SURVEY_TX_PLACEHOLDER,
        };
      }

      const buildBody: Record<string, unknown> = {
        quoteSetId: quoteData.quoteSetId,
        quoteId: best.quoteId,
        userAddress: req.userAddress,
        recipient: req.recipientAddress,
      };
      const build = (await this.post('v1/swap/build', buildBody)) as MysticBuildResponse;
      if (!build.txRequest) return null;

      return {
        input: placeholderSide(req.inputToken, inputAmountRaw),
        output: placeholderSide(req.outputToken, outputAmountRaw),
        txData: {
          approvalAddress: build.approval?.spender ?? zeroAddress, // null for native sells
          tx: {
            to: build.txRequest.to,
            data: build.txRequest.data,
            value: toHex(BigInt(build.txRequest.value)), // Mystic returns decimal wei; Quote wants hex
          },
        },
      };
    } catch {
      return null;
    }
  }
}

// amount/decimals/symbol/value are placeholders — Mystic reports amounts + tx only (no token
// metadata), so aggregateAggregators backfills them from a sibling quote. Mirrors the 0x adapter.
const placeholderSide = (contractAddress: Hex, amountRaw: bigint): Quote['input'] => ({
  contractAddress,
  amountRaw,
  amount: '0',
  decimals: 0,
  value: 0,
  symbol: '',
});

// Survey quotes are indicative (amounts only) and never executed, so txData is a placeholder built
// without the (simulating) build call.
const SURVEY_TX_PLACEHOLDER: Quote['txData'] = {
  approvalAddress: zeroAddress,
  tx: { to: zeroAddress, data: '0x', value: '0x0' },
};

// ---------------------------------------------------------------------------
// Mystic response types (internal) — only the fields the adapter reads
// ---------------------------------------------------------------------------

type MysticQuoteResponse = {
  quoteSetId: string;
  quotes?: Array<{
    quoteId: string;
    sellAmount: string;
    buyAmount: string;
    minBuyAmount: string;
  }>;
};

type MysticBuildResponse = {
  txRequest?: { to: Hex; data: Hex; value: string };
  approval: { token: Hex; spender: Hex; amount: string } | null;
};
