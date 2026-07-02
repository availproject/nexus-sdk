import type { Hex } from 'viem';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export enum QuoteType {
  EXACT_IN = 'EXACT_IN',
  EXACT_OUT = 'EXACT_OUT',
}

export enum QuoteSeriousness {
  PRICE_SURVEY = 'PRICE_SURVEY',
  SERIOUS = 'SERIOUS',
}

// ---------------------------------------------------------------------------
// Quote & Holding
// ---------------------------------------------------------------------------

export type Quote = {
  expiry?: number;
  input: {
    contractAddress: Hex;
    amount: string; // human decimal string
    amountRaw: bigint; // raw integer units
    decimals: number;
    value: number; // USD value (amount × priceUsd); 0 when the aggregator reports no price
    priceUsd?: number; // USD per whole token, when the aggregator reports it (LiFi/Bebop). Absent
    // for price-less aggregators (0x); aggregateAggregators backfills `value` from a sibling's price.
    symbol: string;
  };
  output: {
    contractAddress: Hex;
    amount: string; // human decimal string
    amountRaw: bigint; // raw integer units
    decimals: number;
    value: number; // USD value (amount × priceUsd); 0 when the aggregator reports no price
    priceUsd?: number; // see input.priceUsd
    symbol: string;
  };
  txData: {
    approvalAddress: Hex;
    tx: { to: Hex; data: Hex; value: Hex };
  };
};

export type Holding = {
  chainID: number;
  tokenAddress: Hex;
  amountRaw: bigint; // raw integer units
  decimals: number;
  symbol: string;
};

// ---------------------------------------------------------------------------
// Request & Response
// ---------------------------------------------------------------------------

export type QuoteRequest = {
  // taker: the account that executes/signs the swap on this chain.
  userAddress: Hex;
  // receiver: where the swap output lands. Always passed deliberately — no default to the
  // taker — so output can't be silently misdirected (GS013 / lost funds).
  recipientAddress: Hex;
  chainId: number;
  inputToken: Hex;
  outputToken: Hex;
  seriousness: QuoteSeriousness;
} & (
  | { type: QuoteType.EXACT_IN; inputAmount: bigint }
  | { type: QuoteType.EXACT_OUT; outputAmount: bigint }
);

export type QuoteResponse = {
  chainID: number;
  quote: Quote;
  holding: Holding;
  aggregator: Aggregator;
};

// ---------------------------------------------------------------------------
// Aggregator interface
// ---------------------------------------------------------------------------

export interface Aggregator {
  getQuotes(requests: QuoteRequest[]): Promise<(Quote | null)[]>;
}
