import type { Hex } from 'viem';
import type { ChainListType } from '../../domain';
import { equalFold } from '../../services/strings';
import {
  AggregateMode,
  type Aggregator,
  aggregateAggregators,
  type Holding,
  type QuoteResponse,
  QuoteSeriousness,
  QuoteType,
} from '../aggregators';
import type { CurrencyID } from '../cot';
import { requireRequestAddresses } from './auto-select';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LiquidateInput = {
  holdings: Holding[];
  aggregators: Aggregator[];
  chainList: ChainListType;
  cotCurrencyId: CurrencyID;
  userAddressByChain: Map<number, `0x${string}`>;
  recipientAddressByChain: Map<number, Hex>;
};

// ---------------------------------------------------------------------------
// liquidateInputHoldings
// ---------------------------------------------------------------------------

/**
 * Liquidates non-COT holdings into COT (USDC) via EXACT_IN swaps.
 * COT holdings are skipped — they transfer directly without a swap.
 *
 * 1. Filter to non-COT holdings only
 * 2. Create EXACT_IN quote requests: token → chain's COT
 * 3. aggregateAggregators with MaximizeOutput
 * 4. Filter out null quotes
 * 5. Return QuoteResponse[]
 */
export const liquidateInputHoldings = async (input: LiquidateInput): Promise<QuoteResponse[]> => {
  const { holdings, aggregators, userAddressByChain, recipientAddressByChain } = input;

  // Filter non-COT holdings
  const nonCOT = holdings.filter((h) => {
    const cot = input.chainList.getTokenByCurrencyId(h.chainID, input.cotCurrencyId);
    if (!cot) return true; // no COT for chain = treat as non-COT
    return !equalFold(h.tokenAddress, cot.contractAddress);
  });

  if (nonCOT.length === 0) return [];

  // Build EXACT_IN requests: each non-COT → COT on same chain
  const requests = nonCOT.map((h) => {
    const cot = input.chainList.getTokenByCurrencyId(h.chainID, input.cotCurrencyId);
    const { userAddress, recipientAddress } = requireRequestAddresses(
      h.chainID,
      userAddressByChain,
      recipientAddressByChain
    );
    return {
      userAddress,
      recipientAddress,
      chainId: h.chainID,
      inputToken: h.tokenAddress,
      outputToken: cot.contractAddress,
      seriousness: QuoteSeriousness.SERIOUS,
      type: QuoteType.EXACT_IN as const,
      inputAmount: h.amountRaw,
    };
  });

  const results = await aggregateAggregators(requests, aggregators, AggregateMode.MaximizeOutput);

  // Build QuoteResponses, filtering out nulls
  const quoteResponses: QuoteResponse[] = [];
  for (let i = 0; i < nonCOT.length; i++) {
    const { quote, aggregator } = results[i];
    if (!quote) continue;
    quoteResponses.push({
      chainID: nonCOT[i].chainID,
      quote,
      holding: nonCOT[i],
      aggregator,
    });
  }

  return quoteResponses;
};
