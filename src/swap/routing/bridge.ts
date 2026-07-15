import type { BridgeProvider } from '@avail-project/nexus-types';
import Decimal from 'decimal.js';
import { type Hex, toHex } from 'viem';
import {
  assertMayanSupportedDestination,
  buildQuoteRequest,
  resolveBridgeProvider,
} from '../../bridge/intent/quote-request';
import type { ChainListType } from '../../domain';
import { Errors } from '../../domain/errors';
import { logger } from '../../domain/utils';
import { isNativeAddress } from '../../services/addresses';
import { divDecimals, mulDecimals } from '../../services/math';
import { MAYAN_MIN_USD_PER_LEG, quoteMayanLegs } from '../../services/mayan';
import { resolveCOT } from '../cot';
import type { BridgeAsset, BridgeQuoteResponse, SourceChainCOT, SwapRoute } from '../types';
import type { RouteOptions } from '../route';

// Decide the bridge provider (Mayan vs Nexus) once, at the start of a route, by asking the
// middleware (which owns the USD threshold + destination mayanEnabled checks) about the
// *bridged* amount — the token that actually crosses chains. A server "mayan" is downgraded
// to "nexus" when any bridged source chain/token is itself mayan-disabled, so the per-source
// quote step can't later reject the route. `forceMayan` skips that downgrade (and
// `resolveBridgeProvider` skips the server call entirely). The return shape is unchanged —
// `minOutputUsdPerSource` set only for a final Mayan pick — so every downstream consumer
// (the per-chain filter, `autoSelectSources`) is untouched.
export const resolveBridgeProviderDecision = async (
  params: {
    context: string; // route path, for diagnostics: 'EXACT_IN' | 'EXACT_OUT' | 'fast-path'
    dstChainId: number;
    dstTokenToCheck: Hex; // COT for COT routes; the same-token for the fast path
    amountRawForRequest: bigint; // raw units of dstTokenToCheck — the bridged amount
    roughSources: { chainID: number; tokenAddress: Hex }[]; // bridged sources, for the gate
  },
  options: Pick<RouteOptions, 'middlewareClient' | 'chainList' | 'forceMayan'>
): Promise<{ provider: BridgeProvider; minOutputUsdPerSource?: Decimal }> => {
  const request = {
    destination: {
      chain_id: toHex(params.dstChainId),
      contract_address: params.dstTokenToCheck,
      amount: params.amountRawForRequest.toString(),
    },
  };
  // The exact getBridgeProvider request (what crosses chains + how much) and the bridged sources
  // the Mayan-eligibility gate will check. forceMayan short-circuits the server call.
  logger.debug('swap.route.provider.requested', {
    mode: params.context,
    forceMayan: options.forceMayan,
    destinationChainId: params.dstChainId,
    destinationToken: params.dstTokenToCheck,
    amountRaw: params.amountRawForRequest.toString(),
    sourceChainIds: params.roughSources.map((source) => source.chainID),
    sourceCount: params.roughSources.length,
  });

  const serverProvider = await resolveBridgeProvider(
    options.middlewareClient,
    request,
    options.forceMayan
  );

  // A "mayan" server pick is viable only if every bridged source is Mayan-enabled, else the
  // per-source quote step would reject it — so we downgrade to Nexus. forceMayan keeps the pick.
  const disabledSource =
    !options.forceMayan && serverProvider === 'mayan'
      ? firstMayanDisabledSource(options.chainList, params.roughSources)
      : null;
  const finalProvider: BridgeProvider = disabledSource ? 'nexus' : serverProvider;

  // The decision and *why* — the single line to read when a route picked Nexus unexpectedly.
  logger.debug('swap.route.provider.decision', {
    mode: params.context,
    requestedProvider: options.forceMayan ? 'mayan' : 'auto',
    serverProvider,
    selectedProvider: finalProvider,
    reason: options.forceMayan
      ? 'forced_mayan'
      : serverProvider !== 'mayan'
        ? 'server_selected_nexus'
        : disabledSource
          ? 'source_not_mayan_enabled'
          : 'mayan_eligible',
    disabledSourceChainId: disabledSource?.chainID,
    disabledSourceReason: disabledSource?.reason,
    minOutputUsdPerSource: finalProvider === 'mayan' ? MAYAN_MIN_USD_PER_LEG : undefined,
  });

  return {
    provider: finalProvider,
    minOutputUsdPerSource:
      finalProvider === 'mayan' ? new Decimal(MAYAN_MIN_USD_PER_LEG) : undefined,
  };
};

// Find the first bridged source that disqualifies a Mayan route — mirrors the (throwing) source
// eligibility checks in `enrichMayanBridge`, but returns the offending source + reason instead
// of throwing so the decision can downgrade to Nexus and log *why*. `null` ⇒ all sources eligible.
// Any lookup miss (e.g. native resolved by zero-address) counts as disqualifying, biasing to Nexus.
const firstMayanDisabledSource = (
  chainList: ChainListType,
  sources: { chainID: number; tokenAddress: Hex }[]
): { chainID: number; tokenAddress: Hex; reason: string } | null => {
  for (const source of sources) {
    try {
      if (!chainList.getChainByID(source.chainID)?.mayanEnabled) {
        return { ...source, reason: 'chain not mayan-enabled' };
      }
      if (!chainList.getTokenByAddress(source.chainID, source.tokenAddress)?.mayanEnabled) {
        return { ...source, reason: 'token not mayan-enabled' };
      }
    } catch {
      return { ...source, reason: 'chain/token lookup failed' };
    }
  }
  return null;
};

// The token a source chain actually bridges on a COT route: the chain's COT (source holdings are
// liquidated to it before bridging), falling back to the holding's own token if the chain has no
// COT. Used so the Mayan-eligibility gate judges the bridged token (e.g. USDC), not the pre-swap
// source token (e.g. USDT) — which never leaves the source chain.
export const bridgedTokenForChain = (
  chainID: number,
  fallbackToken: Hex,
  chainList: ChainListType,
  currencyId: number
): Hex => {
  try {
    return resolveCOT(chainID, chainList, currencyId).address as Hex;
  } catch {
    return fallbackToken;
  }
};

const BRIDGE_FEE_ESTIMATE_OVERSELECT = 0.1;

// Up-front bridge-fee estimate, provider-agnostic, from a rough ~110%-of-requirement source survey
// (an upper bound — a larger rough input yields a larger absolute fee, and same-token COT bridges
// barely move). Folded into the EXACT_OUT *selection* target so the real `autoSelectSources` covers
// the fee in a single pass — mirroring v1's `bridgeOutputWithFees`. The bridge's net delivery target
// is sized off `sourceBufferedRequired` separately and is unaffected.
//   - mayan: quote each per-chain leg and sum `input − minReceived` (the per-leg haircut)
//   - nexus: the backend fee model — fulfilment fee + bridged amount × fulfillmentBps
export const estimateBridgeFees = async (
  params: {
    provider: BridgeProvider;
    holdings: { chainID: number; value: number }[];
    dstUsd: Decimal;
    dstChainId: number;
    dstCOT: { address: string; decimals: number };
    cotCurrencyId: number;
    bridgeQuoteResponse: BridgeQuoteResponse | null | undefined;
  },
  options: Pick<RouteOptions, 'chainList' | 'middlewareClient'>
): Promise<Decimal> => {
  // Rough per-chain bridged COT (≈ USD), over-selected to ~110% of the destination requirement.
  const target = params.dstUsd.mul(1 + BRIDGE_FEE_ESTIMATE_OVERSELECT);
  const usdByChain = new Map<number, Decimal>();
  let accumulated = new Decimal(0);
  for (const holding of params.holdings) {
    if (accumulated.gte(target)) break;
    accumulated = accumulated.plus(holding.value);
    if (holding.chainID === params.dstChainId) continue; // dst-chain COT isn't bridged
    usdByChain.set(
      holding.chainID,
      (usdByChain.get(holding.chainID) ?? new Decimal(0)).plus(holding.value)
    );
  }
  const bridgedUsd = [...usdByChain.values()].reduce((sum, v) => sum.plus(v), new Decimal(0));
  if (bridgedUsd.lte(0)) return new Decimal(0);

  if (params.provider === 'mayan') {
    const legs: { chainId: number; tokenAddress: Hex; amountRaw: bigint }[] = [];
    for (const [chainID, usd] of usdByChain) {
      let cot: ReturnType<typeof resolveCOT>;
      try {
        cot = resolveCOT(chainID, options.chainList, params.cotCurrencyId);
      } catch {
        continue; // a chain with no COT can't be a clean COT Mayan leg; skip from the estimate
      }
      legs.push({
        chainId: chainID,
        tokenAddress: cot.address as Hex,
        amountRaw: mulDecimals(usd, cot.decimals),
      });
    }
    if (legs.length === 0) return new Decimal(0);
    const quotes = await quoteMayanLegs(options.middlewareClient, {
      legs,
      destination: { chainId: params.dstChainId, tokenAddress: params.dstCOT.address as Hex },
    });
    return quotes.reduce((sum, q) => {
      const usd = usdByChain.get(q.chainId);
      if (!usd) return sum;
      return sum.plus(
        Decimal.max(usd.minus(new Decimal(q.quote.minReceived.toString())), new Decimal(0))
      );
    }, new Decimal(0));
  }

  // nexus: fixed fulfilment fee + protocol bps on the bridged amount.
  if (!params.bridgeQuoteResponse) return new Decimal(0);
  const fulfilmentFee = divDecimals(
    params.bridgeQuoteResponse.destination.fulfillmentFeeToken,
    params.dstCOT.decimals
  );
  const protocolFee = bridgedUsd.mul(params.bridgeQuoteResponse.fulfillmentBps).div(10000);
  return fulfilmentFee.plus(protocolFee);
};

// Enriches a Mayan bridge with per-source quotes: validates the destination + every source is
// Mayan-eligible (the mayanEnabled flags, throwing if not — a backstop for the decision-time gate),
// then fetches and attaches the per-source Mayan quotes. The bridge MUST already have
// `provider: 'mayan'`; callers branch with `if (provider === 'mayan')` and invoke this only then, so
// the Mayan-vs-Nexus decision stays at the call site rather than being an internal no-op guard.
//
// TODO(mayan-undershoot): Σ minAmountOut from per-source quotes may be less
// than `bridge.amount`. The swap buffer should absorb that; if not, port the
// 3-attempt convergence loop from `createMayanBridgeIntent` in
// src/bridge/intent/creator.ts.
export const enrichMayanBridge = async (
  bridge: NonNullable<SwapRoute['bridge']>,
  options: Pick<RouteOptions, 'chainList' | 'middlewareClient'>
): Promise<NonNullable<SwapRoute['bridge']>> => {
  // Defensive: destination check is also done up-front in determineSwapRoute when
  // forceMayan is true, but the threshold path can also land us here.
  assertMayanSupportedDestination(options.chainList, bridge.chainID, bridge.tokenAddress);

  for (const asset of bridge.assets) {
    const sourceChain = options.chainList.getChainByID(asset.chainID);
    if (!sourceChain.mayanEnabled) {
      // Backstop: the decision-time gate should have downgraded to Nexus already; reaching here
      // means the rough sources diverged from the final assets.
      logger.warn('swap.mayan:source-chain-disabled', {
        chainID: asset.chainID,
        tokenAddress: asset.contractAddress,
      });
      throw Errors.invalidInput(
        `Mayan bridge selected but source chain ${asset.chainID} is disabled for Mayan`
      );
    }
    const sourceToken = options.chainList.getTokenByAddress(asset.chainID, asset.contractAddress);
    if (!sourceToken.mayanEnabled) {
      logger.warn('swap.mayan:source-token-disabled', {
        chainID: asset.chainID,
        tokenAddress: asset.contractAddress,
      });
      throw Errors.invalidInput(
        `Mayan bridge selected but source token ${asset.contractAddress} on chain ${asset.chainID} is disabled for Mayan`
      );
    }
  }

  // Per-source Mayan legs derived from the bridge assets (what each leg sends and the
  // destination token it must deliver). Swap leaves the leg amounts at the full produced
  // balance — the COT selection upstream already sized them — and only prices them here.
  const legs = bridge.assets.map((asset) => ({
    chainId: asset.chainID,
    tokenAddress: asset.contractAddress,
    amountRaw: mulDecimals(asset.eoaBalance.plus(asset.ephemeralBalance), asset.decimals),
  }));
  logger.debug('swap.route.mayan_quote.requested', {
    legs: legs.map((leg) => ({ ...leg, amountRaw: leg.amountRaw.toString() })),
    destinationChainId: bridge.chainID,
    destinationToken: bridge.tokenAddress,
  });
  const quotes = await quoteMayanLegs(options.middlewareClient, {
    legs,
    destination: { chainId: bridge.chainID, tokenAddress: bridge.tokenAddress },
  });

  const mayanQuotesBySource = new Map<string, (typeof quotes)[number]['quote']>(
    quotes.map((quote) => [`${quote.chainId}:${quote.tokenAddress.toLowerCase()}`, quote.quote])
  );

  // Mayan's fee is the per-leg haircut baked into `minReceived` (gross bridged − Σ minReceived), not
  // the Nexus fulfilment/protocol the call site stubbed via `computeBridgeFees`. Overwrite
  // `estimatedFees` so the route's public fee surface — and `executionTokenAmount` (= totalBridged −
  // fee = Σ minReceived) in `bridge-intent.ts` — are truthful for a Mayan bridge.
  const grossBridged = bridge.assets.reduce(
    (sum, asset) => sum.plus(asset.eoaBalance).plus(asset.ephemeralBalance),
    new Decimal(0)
  );
  const delivered = [...mayanQuotesBySource.values()].reduce(
    (sum, quote) => sum.plus(new Decimal(quote.minReceived.toString())),
    new Decimal(0)
  );
  const haircut = Decimal.max(grossBridged.minus(delivered), new Decimal(0));

  return {
    ...bridge,
    provider: 'mayan',
    mayanQuotesBySource,
    estimatedFees: {
      collection: new Decimal(0),
      fulfilment: new Decimal(0),
      caGas: new Decimal(0),
      protocol: haircut,
      solver: new Decimal(0),
    },
  };
};

export const buildSourceCotByChain = (
  swaps: Array<{ chainID: number }>,
  chainList: ChainListType,
  currencyId?: number
): Map<number, SourceChainCOT> => {
  return new Map(
    [...new Set(swaps.map((swap) => swap.chainID))].map((chainId) => {
      const cot = resolveCOT(chainId, chainList, currencyId);
      return [
        chainId,
        {
          contractAddress: cot.address,
          decimals: cot.decimals,
          currencyId: cot.currencyId,
        },
      ] as const;
    })
  );
};

export const accumulateBridgeAsset = (
  assetsByChain: Map<number, BridgeAsset>,
  input: {
    chainID: number;
    contractAddress: Hex;
    decimals: number;
    balance: 'eoaBalance' | 'ephemeralBalance';
    amount: Decimal;
  }
): void => {
  const existing = assetsByChain.get(input.chainID);
  if (existing) {
    existing[input.balance] = existing[input.balance].plus(input.amount);
    return;
  }

  assetsByChain.set(input.chainID, {
    chainID: input.chainID,
    contractAddress: input.contractAddress,
    decimals: input.decimals,
    eoaBalance: input.balance === 'eoaBalance' ? input.amount : new Decimal(0),
    ephemeralBalance: input.balance === 'ephemeralBalance' ? input.amount : new Decimal(0),
  });
};

// Nexus bridge fees. The protocol bps applies to `grossBridged` — the COT actually sent into the
// bridge (Σ assets) — in BOTH routes, so the fee no longer differs by route (EXACT_IN was already
// gross; EXACT_OUT used to size it off the smaller net delivery). The Mayan branch records its own
// haircut in `enrichMayanBridge` instead.
export const computeBridgeFees = (params: {
  quoteResponse: BridgeQuoteResponse;
  grossBridged: Decimal;
  dstCOTDecimals: number;
}): {
  estimatedFees: NonNullable<SwapRoute['bridge']>['estimatedFees'];
  totalFeeAmount: Decimal;
  deliveredAmount: Decimal;
} => {
  const fulfilment = divDecimals(
    params.quoteResponse.destination.fulfillmentFeeToken,
    params.dstCOTDecimals
  );
  const protocol = params.grossBridged.mul(params.quoteResponse.fulfillmentBps).div(10000);
  // Collection (per-source deposit) fee only applies when the EOA funds the bridge directly,
  // which our smart-account-only model no longer supports — bridge funding always flows
  // through the ephemeral, which the solver covers gas for. Keep the field for the public
  // SwapRoute surface, but stub it at zero.
  const collection = new Decimal(0);
  const estimatedFees = {
    collection,
    fulfilment,
    caGas: collection.plus(fulfilment),
    protocol,
    solver: new Decimal(0),
  };
  const totalFeeAmount = collection.plus(fulfilment).plus(protocol);
  return {
    estimatedFees,
    totalFeeAmount,
    deliveredAmount: params.grossBridged.minus(totalFeeAmount),
  };
};

// Fetch a bridge-fee quote denominated in a specific currency's token on the destination chain.
// Non-COT fast paths call this mid-route because their fees follow the bridged token and reusing the
// preflight COT quote would be a decimal trap. Returns null on any failure (unknown token, getQuote
// reject) so the caller can fall back to the COT flow.
export const fetchBridgeQuoteForCurrency = async (
  dstChainId: number,
  currencyId: number,
  options: Pick<RouteOptions, 'chainList' | 'middlewareClient'>
): Promise<BridgeQuoteResponse | null> => {
  try {
    const token = options.chainList.getTokenByCurrencyId(dstChainId, currencyId);
    const quoteToken = isNativeAddress(token.contractAddress)
      ? options.chainList.getNativeToken(dstChainId)
      : token;
    const request = buildQuoteRequest(options.chainList, quoteToken, dstChainId);
    return await options.middlewareClient.getQuote(request);
  } catch {
    return null;
  }
};
