import Decimal from 'decimal.js';
import type { Hex } from 'viem';
import type { ChainListType } from '../../domain/types';
import { equalFold } from '../../services/strings';
import {
  AggregateMode,
  type Aggregator,
  aggregateAggregators,
  type QuoteResponse,
  QuoteSeriousness,
  QuoteType,
} from '../aggregators';
import { EADDRESS } from '../constants';
import { CurrencyID } from '../cot';
import {
  convergeExactIn,
  maxConvergenceExtraAmountRaw,
  preferredOrFallback,
  tryExactOutDirect,
} from './convergence';

// ---------------------------------------------------------------------------
// determineDestinationSwaps
// ---------------------------------------------------------------------------

type DetermineInput = {
  dst: {
    chainId: number;
    token: {
      contractAddress: Hex;
      amountRaw: bigint;
    };
  };
  options: {
    chainList: ChainListType;
    aggregators: Aggregator[];
    // Taker (executes the swap) and receiver (gets the output) are passed deliberately —
    // the destination swap's output always goes to the user's EOA, never a default.
    userAddress: Hex;
    recipientAddress: Hex;
    cotCurrencyID?: CurrencyID;
  };
};

/**
 * Determines the COT → destination token swap quote.
 *
 * Races two candidates in parallel: an EXACT_OUT direct quote (where the aggregator
 * picks the input for a given output) and an EXACT_IN convergence loop (priced off a
 * reverse quote, then iteratively bumped under a USD cap). First success wins; v1
 * pattern. Returns null if destination token IS COT (no swap needed) or neither
 * candidate covers the requirement.
 */
export const determineDestinationSwaps = async ({
  dst,
  options,
}: DetermineInput): Promise<QuoteResponse | null> => {
  const cotCurrencyID = options.cotCurrencyID ?? CurrencyID.USDC;

  const cot = options.chainList.getTokenByCurrencyId(dst.chainId, cotCurrencyID);

  // No swap needed if destination token IS COT
  if (equalFold(dst.token.contractAddress, cot.contractAddress)) {
    return null;
  }

  const exactOutPromise = tryExactOutDirect({
    request: {
      userAddress: options.userAddress,
      recipientAddress: options.recipientAddress,
      chainId: dst.chainId,
      inputToken: cot.contractAddress,
      outputToken: dst.token.contractAddress,
      seriousness: QuoteSeriousness.SERIOUS,
      type: QuoteType.EXACT_OUT,
      outputAmount: dst.token.amountRaw,
    },
    aggregators: options.aggregators,
    requiredOutputAmountRaw: dst.token.amountRaw,
  });

  const convergedPromise = (async () => {
    const reverseResults = await aggregateAggregators(
      [
        {
          userAddress: options.userAddress,
          recipientAddress: options.recipientAddress,
          chainId: dst.chainId,
          inputToken: dst.token.contractAddress,
          outputToken: cot.contractAddress,
          seriousness: QuoteSeriousness.PRICE_SURVEY,
          type: QuoteType.EXACT_IN,
          inputAmount: dst.token.amountRaw,
        },
      ],
      options.aggregators,
      AggregateMode.MaximizeOutput
    );
    const reverseQuote = reverseResults[0]?.quote;
    if (!reverseQuote) return null;

    const cotOutputHuman = new Decimal(reverseQuote.output.amount);
    if (cotOutputHuman.lte(0)) return null;

    const initialInputAmountRaw = cotOutputHuman.mul(Decimal.pow(10, cot.decimals));

    const converged = await convergeExactIn({
      initialInputAmountRaw,
      requiredOutputAmountRaw: dst.token.amountRaw,
      maxExtraInputAmountRaw: maxConvergenceExtraAmountRaw(cot.decimals),
      aggregators: options.aggregators,
      makeRequest: (inputAmountRaw) => ({
        userAddress: options.userAddress,
        recipientAddress: options.recipientAddress,
        chainId: dst.chainId,
        inputToken: cot.contractAddress,
        outputToken: dst.token.contractAddress,
        seriousness: QuoteSeriousness.SERIOUS,
        type: QuoteType.EXACT_IN,
        inputAmount: inputAmountRaw,
      }),
    });
    return converged;
  })();

  const winner = await preferredOrFallback({
    preferred: exactOutPromise,
    fallback: convergedPromise,
  });

  if (!winner) return null;

  return {
    chainID: dst.chainId,
    quote: winner.quote,
    holding: {
      chainID: dst.chainId,
      tokenAddress: dst.token.contractAddress,
      amountRaw: dst.token.amountRaw,
      decimals: winner.quote.output.decimals,
      symbol: winner.quote.output.symbol,
    },
    aggregator: winner.aggregator,
  };
};

// ---------------------------------------------------------------------------
// destinationSwapWithExactIn
// ---------------------------------------------------------------------------

type ExactInInput = {
  chainId: number;
  outputToken: Hex;
  input: {
    amountRaw: bigint;
    tokenAddress: Hex;
  };
  options: {
    aggregators: Aggregator[];
    userAddress: Hex;
    recipientAddress: Hex;
    chainList: ChainListType;
  };
};

/**
 * Single EXACT_IN quote: inputAmount of COT → outputToken.
 * Used for EXACT_IN routes where we know the COT amount available.
 */
export const destinationSwapWithExactIn = async ({
  chainId,
  outputToken,
  input,
  options,
}: ExactInInput): Promise<QuoteResponse | null> => {
  const results = await aggregateAggregators(
    [
      {
        userAddress: options.userAddress,
        recipientAddress: options.recipientAddress,
        chainId,
        inputToken: input.tokenAddress,
        outputToken,
        seriousness: QuoteSeriousness.SERIOUS,
        type: QuoteType.EXACT_IN as const,
        inputAmount: input.amountRaw,
      },
    ],
    options.aggregators,
    AggregateMode.MaximizeOutput
  );
  const best = results[0];

  if (!best.quote) return null;

  return {
    chainID: chainId,
    quote: best.quote,
    holding: {
      chainID: chainId,
      tokenAddress: input.tokenAddress,
      amountRaw: input.amountRaw,
      decimals: best.quote.input.decimals,
      symbol: best.quote.input.symbol,
    },
    aggregator: best.aggregator,
  };
};

// ---------------------------------------------------------------------------
// destinationGasSwapExactIn
// ---------------------------------------------------------------------------

type GasSwapInput = {
  chainId: number;
  gasAmountInCotRaw: bigint;
  options: {
    aggregators: Aggregator[];
    userAddress: Hex;
    recipientAddress: Hex;
    chainList: ChainListType;
    cotCurrencyID?: CurrencyID;
  };
};

/**
 * Single EXACT_IN quote: gasAmountInCotRaw of dst-chain COT → native (EADDRESS).
 * Receiver = the user's EOA so the aggregator delivers native directly, no wrapper sweep.
 */
export const destinationGasSwapExactIn = async ({
  chainId,
  gasAmountInCotRaw,
  options,
}: GasSwapInput): Promise<QuoteResponse | null> => {
  const cotCurrencyID = options.cotCurrencyID ?? CurrencyID.USDC;
  const cot = options.chainList.getTokenByCurrencyId(chainId, cotCurrencyID);

  return destinationSwapWithExactIn({
    chainId,
    outputToken: EADDRESS,
    input: {
      amountRaw: gasAmountInCotRaw,
      tokenAddress: cot.contractAddress,
    },
    options: {
      aggregators: options.aggregators,
      userAddress: options.userAddress,
      recipientAddress: options.recipientAddress,
      chainList: options.chainList,
    },
  });
};
