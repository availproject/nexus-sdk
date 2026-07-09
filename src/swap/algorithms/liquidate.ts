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
  // Path A (direct destination swap): liquidate straight to a fixed destination token on every chain
  // instead of each chain's COT. When set, the per-chain COT lookup is bypassed and holdings equal to
  // this token are skipped as identities. Absent ⇒ the default COT round-trip (byte-identical).
  outputToken?: { contractAddress: Hex };
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
  const { holdings, aggregators, userAddressByChain, recipientAddressByChain, outputToken } = input;

  // Filter out holdings already in the target token — the per-chain COT by default, or the fixed
  // destination token for Path A. Those transfer directly without a swap.
  const swappable = holdings.filter((h) => {
    if (outputToken) return !equalFold(h.tokenAddress, outputToken.contractAddress);
    const cot = input.chainList.getTokenByCurrencyId(h.chainID, input.cotCurrencyId);
    if (!cot) return true; // no COT for chain = treat as non-COT
    return !equalFold(h.tokenAddress, cot.contractAddress);
  });

  if (swappable.length === 0) return [];

  // Build EXACT_IN requests: each holding → the target token on the same chain.
  const requests = swappable.map((h) => {
    const outputTokenAddress = outputToken
      ? outputToken.contractAddress
      : input.chainList.getTokenByCurrencyId(h.chainID, input.cotCurrencyId).contractAddress;
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
      outputToken: outputTokenAddress,
      seriousness: QuoteSeriousness.SERIOUS,
      type: QuoteType.EXACT_IN as const,
      inputAmount: h.amountRaw,
    };
  });

  const results = await aggregateAggregators(requests, aggregators, AggregateMode.MaximizeOutput);

  // Build QuoteResponses, filtering out nulls
  const quoteResponses: QuoteResponse[] = [];
  for (let i = 0; i < swappable.length; i++) {
    const { quote, aggregator } = results[i];
    if (!quote) continue;
    quoteResponses.push({
      chainID: swappable[i].chainID,
      quote,
      holding: swappable[i],
      aggregator,
    });
  }

  return quoteResponses;
};
