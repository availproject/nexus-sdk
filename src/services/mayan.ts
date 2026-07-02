import Decimal from 'decimal.js';
import { type Hex, toHex } from 'viem';
import { Errors } from '../domain/errors';
import type { MayanQuote, MiddlewareMayanQuoteClient } from '../transport';
import { equalFold } from './strings';

/**
 * Minimum USD value a single Mayan source leg must carry. Mayan's fixed relayer-fee
 * component makes sub-floor legs uneconomical, so both the bridge and the swap drop
 * sources below this before quoting.
 */
export const MAYAN_MIN_USD_PER_LEG = 1.1;

/**
 * Slippage tolerance (basis points) sent with every Mayan quote. 5 bps matches Mayan's own
 * same-token default; Nexus only bridges like-for-like assets, where real slippage is near
 * zero, so a tight floor keeps `minReceived` high without risking under-fill.
 */
export const MAYAN_SLIPPAGE_BPS = 5;

export type MayanLegRequest = {
  chainId: number;
  tokenAddress: Hex;
  amountRaw: bigint;
  /** Destination gas drop (native units). Only one leg should carry it. */
  gasDrop?: number;
};

export type MayanLegQuote = {
  chainId: number;
  tokenAddress: Hex;
  quote: MayanQuote;
  minReceived: Decimal;
};

/**
 * Shared Mayan quote plumbing: builds the `getMayanQuotes` request from a list of legs,
 * validates the response is index-aligned with the request (length + per-leg
 * chain/token), and returns each leg's quote with `minReceived` as a `Decimal`.
 *
 * The response is assumed to be in request order — both the bridge convergence and the
 * swap bridge step rely on that alignment.
 */
export const quoteMayanLegs = async (
  client: MiddlewareMayanQuoteClient,
  params: {
    legs: MayanLegRequest[];
    destination: { chainId: number; tokenAddress: Hex };
  }
): Promise<MayanLegQuote[]> => {
  const response = await client.getMayanQuotes({
    sources: params.legs.map((leg) => ({
      chain_id: toHex(leg.chainId),
      contract_address: leg.tokenAddress,
      amount: leg.amountRaw.toString(),
      ...(leg.gasDrop ? { gas_drop: leg.gasDrop } : {}),
    })),
    destination: {
      chain_id: toHex(params.destination.chainId),
      contract_address: params.destination.tokenAddress,
    },
    slippage_bps: MAYAN_SLIPPAGE_BPS,
  });

  if (response.quotes.length !== params.legs.length) {
    throw Errors.internal('Mayan quote response length mismatch');
  }

  return params.legs.map((leg, index) => {
    const quote = response.quotes[index];
    if (
      !quote ||
      quote.source.chainId !== leg.chainId ||
      !equalFold(quote.source.tokenAddress, leg.tokenAddress)
    ) {
      throw Errors.internal('Mayan quote response source mismatch');
    }
    return {
      chainId: leg.chainId,
      tokenAddress: leg.tokenAddress,
      quote: quote.mayanQuote,
      minReceived: new Decimal(quote.mayanQuote.minReceived.toString()),
    };
  });
};
