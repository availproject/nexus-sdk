import Decimal from 'decimal.js';
import type { Hex } from 'viem';
import type { ChainListType, TokenInfo, Universe } from '../domain';
import { Errors } from '../domain/errors';
import { isNativeAddress } from '../services/addresses';
import { createUserAssets, getBalancesForBridge } from '../services/balances';
import { divDecimals, mulDecimals } from '../services/math';
import { MAYAN_MIN_USD_PER_LEG, quoteMayanLegs } from '../services/mayan';
import type { MiddlewareBridgeClient, QuoteResponse } from '../transport';
import { lookupDepositFee } from './intent/creator';
import {
  buildBridgeProviderRequest,
  buildQuoteRequest,
  resolveBridgeProvider,
} from './intent/quote-request';
import type { BridgeMaxParams, BridgeMaxResult } from './types';

type BridgeMaxExecutionParams = {
  chainList: ChainListType;
  evmAddress: Hex;
  middlewareClient: MiddlewareBridgeClient;
  forceMayan?: boolean;
};

// One per-chain holding of the bridged token, as produced by `asset.iterate(chainList)`.
type SourceEntry = {
  balance: Decimal;
  value: Decimal;
  chain: { id: number; logo: string; name: string };
  contractAddress: Hex;
  decimals: number;
  universe: Universe;
};

// ---------------------------------------------------------------------------
// calculateMaxForBridge
// ---------------------------------------------------------------------------

/**
 * Calculates the maximum amount a user can bridge to a destination token, accounting for the
 * provider that will actually run.
 *
 * Algorithm:
 * 1. Gather same-currency holdings on every chain except the destination.
 * 2. Pick the provider the way the real bridge does — feed the summed bridge amount to the
 *    middleware, which compares it against the Mayan threshold.
 * 3. Compute the receivable max for that provider (Nexus: back out deposit/fulfillment/bps;
 *    Mayan: sum minReceived across eligible legs quoted at full balance).
 */
export async function calculateMaxForBridge(
  input: BridgeMaxParams,
  options: BridgeMaxExecutionParams
): Promise<BridgeMaxResult> {
  const { chainList, evmAddress, middlewareClient } = options;
  const { token: dstToken } = chainList.getChainAndTokenFromSymbol(
    input.toChainId,
    input.toTokenSymbol
  );
  if (!dstToken) {
    throw Errors.tokenNotFound(input.toTokenSymbol, input.toChainId);
  }

  const sourceFilter = input.sources ?? [];

  const assets = await getBalancesForBridge({ middlewareClient, evmAddress, chainList });

  const asset = createUserAssets(assets).find({
    currencyId: dstToken.currencyId,
    symbol: dstToken.symbol,
  });

  const entries: SourceEntry[] = (await asset.iterate(chainList)).filter(
    (entry) =>
      entry.chain.id !== input.toChainId &&
      entry.balance.gt(0) &&
      (sourceFilter.length === 0 || sourceFilter.includes(entry.chain.id))
  );
  const quoteResponse = await middlewareClient.getQuote(
    buildQuoteRequest(
      chainList,
      dstToken,
      input.toChainId,
      entries.map((entry) => entry.chain.id)
    )
  );

  // Provider decision: hand the middleware the summed bridge amount (in destination token
  // units) so it applies the same Mayan threshold the real bridge would.
  const bridgeAmountRaw = mulDecimals(
    entries.reduce((sum, entry) => Decimal.add(sum, entry.balance), new Decimal(0)),
    dstToken.decimals
  );
  let provider = await resolveBridgeProvider(
    middlewareClient,
    buildBridgeProviderRequest(dstToken, input.toChainId, bridgeAmountRaw),
    options.forceMayan ?? false
  );

  let maxToken: Decimal;
  let selected: SourceEntry[];
  if (provider === 'mayan') {
    const mayan = await computeMayanBridgeMax({
      entries,
      dstToken,
      dstChainId: input.toChainId,
      quoteResponse,
      chainList,
      middlewareClient,
    });
    // ponytail: mirror createMayanBridgeIntent's Mayan→Nexus fallback — if no leg clears the
    // per-leg minimum, the real bridge runs on Nexus, so the max should too.
    if (mayan.selected.length === 0) {
      provider = 'nexus';
      ({ maxToken, selected } = computeNexusBridgeMax({ entries, dstToken, quoteResponse }));
    } else {
      ({ maxToken, selected } = mayan);
    }
  } else {
    ({ maxToken, selected } = computeNexusBridgeMax({ entries, dstToken, quoteResponse }));
  }

  return {
    toChainId: input.toChainId,
    toTokenSymbol: input.toTokenSymbol,
    provider,
    maxAmount: maxToken.toFixed(dstToken.decimals),
    maxAmountRaw: mulDecimals(maxToken, dstToken.decimals),
    symbol: dstToken.symbol,
    decimals: dstToken.decimals,
    sources: selected.map((entry) => ({
      chainId: entry.chain.id,
      tokenAddress: entry.contractAddress,
      symbol: chainList.getTokenByAddress(entry.chain.id, entry.contractAddress).symbol,
      decimals: entry.decimals,
      amount: entry.balance.toFixed(entry.decimals),
    })),
  };
}

// Nexus max: each source contributes `balance − depositFee`; back the fulfillment fee and
// protocol bps out of the summed usable to get the receivable destination amount. Inverts the
// `payable = amount·(1 + bps/10000) + fulfillmentFee` selection in createBridgeIntent.
const computeNexusBridgeMax = (args: {
  entries: SourceEntry[];
  dstToken: TokenInfo;
  quoteResponse: QuoteResponse;
}): { maxToken: Decimal; selected: SourceEntry[] } => {
  const { entries, dstToken, quoteResponse } = args;
  const selected: SourceEntry[] = [];
  let totalUsable = new Decimal(0);

  for (const entry of entries) {
    const depositFee = lookupDepositFee(
      entry.chain.id,
      entry.contractAddress,
      quoteResponse,
      entry.decimals
    ).amount;
    if (depositFee.gte(entry.balance)) continue;
    totalUsable = Decimal.add(totalUsable, Decimal.sub(entry.balance, depositFee));
    selected.push(entry);
  }

  const fulfillmentFee = divDecimals(
    quoteResponse.destination.fulfillmentFeeToken,
    dstToken.decimals
  );
  const bpsMultiplier = Decimal.add(1, Decimal.div(quoteResponse.fulfillmentBps, 10_000));
  const maxToken = Decimal.max(
    Decimal.sub(totalUsable, fulfillmentFee).div(bpsMultiplier),
    new Decimal(0)
  );
  return { maxToken, selected };
};

// Mayan max: drop sources below the per-leg minimum, quote every survivor at its full usable
// balance, and sum minReceived. No swing-trim (that only matters for an exact-out target).
const computeMayanBridgeMax = async (args: {
  entries: SourceEntry[];
  dstToken: TokenInfo;
  dstChainId: number;
  quoteResponse: QuoteResponse;
  chainList: ChainListType;
  middlewareClient: MiddlewareBridgeClient;
}): Promise<{ maxToken: Decimal; selected: SourceEntry[] }> => {
  const { entries, dstToken, dstChainId, quoteResponse, chainList, middlewareClient } = args;
  const minPerLeg = new Decimal(MAYAN_MIN_USD_PER_LEG);

  const eligible = entries
    .filter((entry) => {
      if (!chainList.getChainByID(entry.chain.id).mayanEnabled) return false;
      return (
        chainList.getTokenByAddress(entry.chain.id, entry.contractAddress).mayanEnabled === true
      );
    })
    .map((entry) => {
      const depositFee = lookupDepositFee(
        entry.chain.id,
        entry.contractAddress,
        quoteResponse,
        entry.decimals,
        'depositMayan'
      ).amount;
      const usable = Decimal.sub(entry.balance, depositFee);
      const usdPerToken = entry.balance.gt(0) ? entry.value.div(entry.balance) : new Decimal(0);
      const minimumAmount = usdPerToken.gt(0)
        ? Decimal.div(minPerLeg, usdPerToken).mul(
            // Native ETH bridged to Ethereum mainnet requires a higher per-leg minimum.
            dstChainId === 1 && isNativeAddress(dstToken.contractAddress) ? 2 : 1
          )
        : new Decimal(Number.POSITIVE_INFINITY);
      return { entry, usable, usableUsd: Decimal.mul(usable, usdPerToken), minimumAmount };
    })
    .filter((leg) => leg.usableUsd.gte(minPerLeg) && leg.usable.gte(leg.minimumAmount));

  if (eligible.length === 0) {
    return { maxToken: new Decimal(0), selected: [] };
  }

  const quotes = await quoteMayanLegs(middlewareClient, {
    legs: eligible.map((leg) => ({
      chainId: leg.entry.chain.id,
      tokenAddress: leg.entry.contractAddress,
      amountRaw: mulDecimals(leg.usable, leg.entry.decimals),
    })),
    destination: { chainId: dstChainId, tokenAddress: dstToken.contractAddress },
  });

  return {
    maxToken: quotes.reduce((sum, leg) => Decimal.add(sum, leg.minReceived), new Decimal(0)),
    selected: eligible.map((leg) => leg.entry),
  };
};
