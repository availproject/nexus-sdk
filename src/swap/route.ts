import {
  type Aggregator,
  ChaindataMap,
  CurrencyID,
  getDestinationExactInSwap,
  getDestinationExactOutSwap,
  liquidateSourceHoldings,
  OmniversalChainID,
  type QuoteResponse,
  type SourceWithValue,
  selectSources,
  Universe,
} from '@avail-project/ca-common';
import Decimal from 'decimal.js';
import { uniqBy } from 'es-toolkit';
import { type Hex, toBytes } from 'viem';
import {
  type BridgeAsset,
  type Chain,
  type ChainListType,
  type DestinationExecution,
  type ExactInSwapInput,
  type ExactOutSwapInput,
  getLogger,
  type OraclePriceResponse,
  type Source,
  type SourceExecution,
  type SwapData,
  SwapMode,
  type SwapParams,
} from '../commons';
import { ZERO_ADDRESS } from '../core/constants';
import { Errors } from '../core/errors';
import {
  calculateMaxBridgeFee,
  convertGasToToken,
  convertTo32BytesHex,
  divDecimals,
  equalFold,
  type FeeStore,
  getBalancesForSwap,
  getFeeStore,
  mulDecimals,
} from '../core/utils';
import { EADDRESS, EADDRESS_32_BYTES } from './constants';
import type { FlatBalance } from './data';
import { createIntent, estimateCollectionFee } from './rff';
import { SAFE_PROXY_FACTORY } from './safe.constants';
import { predictSafeAccountAddress } from './safetx';
import {
  calculateValue,
  convertTo32Bytes,
  convertToEVMAddress,
  getTokenInfo,
  type PublicClientList,
  sortSourcesByPriority,
} from './utils';

const logger = getLogger();

// Collect and print every route-phase `performance.measure` we can find. Called before
// each route returns (initial + every refresh) so timings are visible without having to
// complete the full swap flow — `calculatePerformance` in flows/swap.ts only fires after
// the user approves the intent and execution finishes, which is too late for diagnosing
// route latency in isolation.
//
// Each phase is gated on its start-mark existing so an exact-out path doesn't blow up
// looking for `route-max-bridge-fee-start` (exact-in-only). Marks are NOT cleared here;
// calculatePerformance handles cleanup at end-of-swap. On refresh, each pair is
// overwritten by the new call's marks, so the print reflects the latest run.
const printRouteTimings = () => {
  try {
    const measures: PerformanceMeasure[] = [];
    const entries = performance.getEntries();
    const has = (name: string) => entries.some((e) => e.name === name);

    if (has('route-fetch-start')) {
      measures.push(
        performance.measure('route-fetch-duration', 'route-fetch-start', 'route-fetch-end')
      );
    }
    if (has('route-dst-quote-start')) {
      measures.push(
        performance.measure(
          'route-dst-quote-duration',
          'route-dst-quote-start',
          'route-dst-quote-end'
        )
      );
    }
    if (has('route-source-quote-start')) {
      measures.push(
        performance.measure(
          'route-source-quote-duration',
          'route-source-quote-start',
          'route-source-quote-end'
        )
      );
    }
    if (has('route-max-bridge-fee-start')) {
      measures.push(
        performance.measure(
          'route-max-bridge-fee-duration',
          'route-max-bridge-fee-start',
          'route-max-bridge-fee-end'
        )
      );
    }
    if (has('route-verify-start')) {
      measures.push(
        performance.measure('route-verify-duration', 'route-verify-start', 'route-verify-end')
      );
    }

    logger.debug('Timings for route:');
    for (const measure of measures) {
      logger.debug(`${measure.name}: ${measure.duration}`);
    }
  } catch (e) {
    logger.error('printRouteTimings', e);
  }
};

export const requiresSafeAccount = (chain: Chain | undefined): boolean =>
  !!chain && chain.swapSupported && !chain.pectraUpgradeSupport;

// Source and destination wrappers on the same chain resolve to the same on-chain executor —
// it's purely chain-dependent, not src/dst-dependent. The only divergence is the optional
// `direct_eoa` dst mode applied at the call site via {@link buildDirectEoaDestinationExecution}.
//
// The Safe address is computed locally via CREATE2 (see `predictSafeAccountAddress`). We DO
// still fire `vscGetSafeAccountAddress` per non-pectra chain — but only as a background
// sanity check that catches SDK ↔ server config drift (different salt/init code). The
// returned promise is awaited via `verification` just before the SwapRoute is returned;
// it does NOT block aggregator quotes or any other route step.
type ChainExecution = {
  address: Hex;
  entryPoint: Hex | null;
  factoryAddress?: Hex;
  mode: '7702' | 'safe_account';
};

const buildDirectEoaDestinationExecution = (eoaAddress: Hex): DestinationExecution => ({
  address: eoaAddress,
  entryPoint: null,
  mode: 'direct_eoa',
});

export const resolveChainExecutions = ({
  chainIds,
  ephemeralAddress,
  chainList,
  vscClient,
}: {
  chainIds: Iterable<number>;
  ephemeralAddress: Hex;
  chainList: ChainListType;
  vscClient: SwapParams['vscClient'];
}): {
  executions: Record<number, ChainExecution>;
  verification: Promise<void>;
} => {
  const executions: Record<number, ChainExecution> = {};
  const verificationPromises: Promise<void>[] = [];

  for (const chainId of new Set(chainIds)) {
    const chain = chainList.getChainByID(chainId);
    if (!chain) {
      throw Errors.chainNotFound(chainId);
    }

    if (!requiresSafeAccount(chain)) {
      executions[chainId] = {
        address: ephemeralAddress,
        entryPoint: null,
        mode: '7702',
      };
      continue;
    }

    const safeAddress = predictSafeAccountAddress(ephemeralAddress);
    executions[chainId] = {
      address: safeAddress,
      entryPoint: null,
      factoryAddress: SAFE_PROXY_FACTORY,
      mode: 'safe_account',
    };

    verificationPromises.push(
      vscClient.vscGetSafeAccountAddress(chainId, ephemeralAddress).then((account) => {
        if (account.address.toLowerCase() !== safeAddress.toLowerCase()) {
          throw Errors.internal(
            `Safe address mismatch on chain ${chainId}: local=${safeAddress} server=${account.address}`
          );
        }
      })
    );
  }

  return {
    executions,
    verification: Promise.all(verificationPromises).then(() => {
      // Promise<void[]> → Promise<void>
    }),
  };
};

// Per-holding shape carrying both the swap *taker* (on-chain executor — Calibur ephemeral on
// 7702 chains, Safe contract on non-Pectra chains) and the *receiver* (output recipient). For
// source-side swaps the two are always equal — output stays at the wrapper for the bridge step
// to consume — but they're stored as distinct fields so every call site has to acknowledge
// each role explicitly. Matches ca-common's `SourceWithValue` exactly — re-exported under the
// SDK-flavored name so older test imports keep working.
type AggregatorInputWithSwapAddresses = SourceWithValue;
type SourceExecutionRecord = Record<number, SourceExecution>;

// Source executions are just the per-source-chain slice of the combined chain-execution map.
// Kept as a tiny helper so the call sites stay symmetric with the legacy shape, but no
// async work happens here — everything sources from {@link resolveChainExecutions}.
const pickSourceExecutions = (
  chainExecutions: Record<number, ChainExecution>,
  sourceBalances: FlatBalance[]
): SourceExecutionRecord => {
  const out: SourceExecutionRecord = {};
  for (const chainId of new Set(sourceBalances.map((b) => b.chainID))) {
    const execution = chainExecutions[chainId];
    if (!execution) {
      throw Errors.internal(`source execution not resolved for chain ${chainId}`);
    }
    out[chainId] = execution;
  }
  return out;
};

export const toAggregatorInputsWithSwapAddresses = (
  balances: FlatBalance[],
  sourceExecutions: SourceExecutionRecord
): AggregatorInputWithSwapAddresses[] =>
  toAggregatorInputs(balances).map((holding, index) => {
    const chainId = balances[index].chainID;
    const execution = sourceExecutions[chainId];
    if (!execution) {
      throw Errors.internal(`source execution not resolved for chain ${chainId}`);
    }

    // Source-side: taker == receiver (output stays at the wrapper for the bridge step). Both
    // fields populated explicitly so the wrapper's required-field contract is satisfied at
    // every call site, even though the value is the same today.
    const swapAddress = convertTo32Bytes(execution.address);
    return {
      ...holding,
      takerAddress: swapAddress,
      receiverAddress: swapAddress,
    };
  });

/**
 * Resolves a (chain, token) pair to its canonical bridgeable symbol — `equivalentCurrency`
 * if set, else `symbol`, or the chain's native symbol for ZERO_ADDRESS / EADDRESS. Returns
 * undefined when the token isn't in the chain's `knownTokens` and isn't native. Two tokens
 * are bridgeable as a same-family pair iff their canonical symbols match.
 */
export const getBridgeableSymbol = (
  chainList: ChainListType,
  chainId: number,
  tokenAddress: Hex
): string | undefined => {
  const chain = chainList.getChainByID(chainId);
  if (!chain) return undefined;
  if (equalFold(tokenAddress, ZERO_ADDRESS) || equalFold(tokenAddress, EADDRESS)) {
    return chain.nativeCurrency.symbol;
  }
  const token = chain.custom.knownTokens.find((t) => equalFold(t.contractAddress, tokenAddress));
  if (!token) return undefined;
  return token.equivalentCurrency ?? token.symbol;
};

export const hasDestinationChainSourceSwapOutput = (
  sourceSwaps: Pick<QuoteResponse, 'chainID'>[],
  sourceExecutions: SourceExecutionRecord,
  destinationChainId: number,
  eoaAddress: Hex
) =>
  sourceSwaps.some((swap) => {
    if (Number(swap.chainID) !== destinationChainId) {
      return false;
    }
    const execution = sourceExecutions[destinationChainId];
    return !!execution && !equalFold(execution.address, eoaAddress);
  });

export const determineSwapRoute = async (
  input: SwapData,
  options: SwapParams & {
    publicClientList: PublicClientList;
    aggregators: Aggregator[];
    cotCurrencyID: CurrencyID;
  }
): Promise<{
  route: SwapRoute;
  refresh: (input: SwapData) => Promise<SwapRoute>;
}> => {
  logger.debug('determineSwapRoute', {
    input,
    options,
  });
  console.time('swap-route-time');

  // Each inner route returns { route, refresh } with `refresh` accepting the unwrapped
  // mode-specific data. We wrap that here so the outer refresh accepts the discriminated
  // `SwapData` and rejects mode mismatches at runtime — refresh is a within-session
  // operation, switching modes mid-session is a caller bug.
  if (input.mode === SwapMode.EXACT_OUT) {
    const { route, refresh: innerRefresh } = await _exactOutRoute(input.data, options);
    console.timeEnd('swap-route-time');
    return {
      route,
      // Marked async so the mode-check throw becomes a rejection instead of a synchronous
      // exception (callers `await` the result and expect Promise semantics for errors).
      refresh: async (next: SwapData) => {
        if (next.mode !== SwapMode.EXACT_OUT) {
          throw Errors.internal(
            `refresh cannot switch swap mode (got ${next.mode}, expected EXACT_OUT)`
          );
        }
        return innerRefresh(next.data);
      },
    };
  }

  const { route, refresh: innerRefresh } = await _exactInRoute(input.data, options);
  console.timeEnd('swap-route-time');
  return {
    route,
    refresh: async (next: SwapData) => {
      if (next.mode !== SwapMode.EXACT_IN) {
        throw Errors.internal(
          `refresh cannot switch swap mode (got ${next.mode}, expected EXACT_IN)`
        );
      }
      return innerRefresh(next.data);
    },
  };
};

export const applyBuffer = (amount: Decimal, bufferPercent: number): Decimal =>
  amount.mul(1 + bufferPercent / 100);

const applyBufferWithCap = (
  amount: Decimal,
  bufferPercent: number,
  cap: number
): { amountWithBuffer: Decimal; buffer: Decimal } => {
  const cappedBuffer = Decimal.min(amount.mul(bufferPercent / 100), cap);

  return { amountWithBuffer: amount.plus(cappedBuffer), buffer: cappedBuffer };
};

/*
Exact out:
sF = solver Fee
cF = collection Fee
fF = fulfilment Fee

Destination Swap:
min: 1 USDC
max: 1.05 USDC (5% buffer)

Source Swap:
bFee = 0.07 USDC (cF + fF) (sF should be covered by buffer in source swap)
output: max + 1% max + bFee = 1.05 + 0.01 + 0.07 = 1.08 USDC

Bridge:
use max as output

source amount will be like max + (s1 + s2)sF + (s1 + s2)cF + fF
                                -------------  -----------------
                                  covered by    already included
                                    buffer      during calculation
*/

// COT = currency of transfer
// DEF: The common currency which is supported by bridge on every supported chain and acts as a transient currency for swaps.
// FLOW: Source tokens get converted to COT, COT is bridged across chains to a destination chain,
// COT is then changed to desired destination token
// Currently COT is USDC.

enum BUFFER_EXACT_OUT {
  DESTINATION_SWAP_BUFFER_PCT = 10,
  DESTINATION_SWAP_MAX_IN_USD = 2,
  SOURCE_SWAP_BUFFER_PCT = 2,
  SOURCE_SWAP_MAX_IN_USD = 1,
}

// EXACT_IN: source swaps run with the user's exact input, so we can't oversize them like
// EXACT_OUT does. Instead we under-size the dst-swap input by `srcBuffer` and let leftover
// COT sweep back to the EOA. That keeps the dst swap funded if a source leg reverts and
// re-quotes up to `srcBuffer` lower; `retryWithSlippageCheck` uses the same value as its
// retry tolerance.
enum BUFFER_EXACT_IN {
  SOURCE_SWAP_BUFFER_PCT = 0.5,
  SOURCE_SWAP_MAX_IN_USD = 1,
}

// Headroom on the destination-swap input when source and destination collapse into a single
// same-wrapper batch. Absorbs aggregator slippage between the source quote (which lands COT at
// the wrapper) and the destination quote (which spends that COT) inside one atomic execution.
// Leftover COT is swept back to the EOA by the existing destination sweeper.
export const COMBINED_SAME_CHAIN_BUFFER_PCT = 0.5;

const getCOTForChainId = (chainId: number | bigint, cotCurrencyID = CurrencyID.USDC) => {
  const chainData = ChaindataMap.get(new OmniversalChainID(Universe.ETHEREUM, chainId));
  if (!chainData) {
    throw Errors.internal(`chain data not found for chain ${chainId}`);
  }

  const cot = chainData.Currencies.find((c) => c.currencyID === cotCurrencyID);
  if (!cot) {
    throw Errors.internal(`COT not found for chain ${chainId}`);
  }

  return { cot, address: convertToEVMAddress(cot.tokenAddress) };
};

// Helper to normalize token addresses for comparison (preserves EADDRESS vs ZERO_ADDRESS handling)
const normalizeToComparisonAddr = (tokenHex: Hex) =>
  convertTo32BytesHex(equalFold(tokenHex, ZERO_ADDRESS) ? EADDRESS : tokenHex);

/** Checks if a FlatBalance matches a Source by chain and normalized token address. */
const matchesSource = (b: FlatBalance, s: Source) =>
  s.chainId === b.chainID && equalFold(b.tokenAddress, normalizeToComparisonAddr(s.tokenAddress));

/** Keeps only balances present in the allowedSources list. */
const filterAllowedSources = (balances: FlatBalance[], allowed: Source[]) =>
  balances.filter((b) => allowed.some((s) => matchesSource(b, s)));

/** Removes balances that match any entry in the removeSources list. */
const filterRemoveSources = (balances: FlatBalance[], remove: Source[]) =>
  balances.filter((b) => !remove.some((s) => matchesSource(b, s)));

/**
 * Deducts a reserved raw amount from a specific token balance on a given chain.
 * Returns a new array with the adjusted balance (amount and proportional fiat value).
 */
const deductReservedBalance = (
  balances: FlatBalance[],
  chainId: number,
  tokenAddr32: string,
  reserveRaw: bigint,
  decimals: number
) => {
  const reserved = divDecimals(reserveRaw, decimals);
  return balances.map((b) => {
    if (b.chainID !== chainId || !equalFold(b.tokenAddress, tokenAddr32)) {
      return b;
    }
    const remaining = new Decimal(b.amount).sub(reserved);
    if (remaining.lte(0)) {
      return { ...b, amount: '0', value: 0 };
    }
    const ratio = remaining.div(b.amount);
    return { ...b, amount: remaining.toString(), value: ratio.mul(b.value).toNumber() };
  });
};

/** Fetches fee store, balances, oracle prices, and destination token info in parallel.
 *  Returns the *unfiltered* balance set — `fromSources` / `removeSources` are now
 *  applied by `_exactOutRoute`'s refresh body so a refresh with a different
 *  fromSources doesn't have to refetch. */
const fetchRouteData = async (
  params: SwapParams & { publicClientList: PublicClientList },
  opts: {
    toChainId: number;
    toTokenAddress: Hex;
    dstChain: ReturnType<SwapParams['chainList']['getChainByID']> & {};
  }
) => {
  const oraclePricesPromise = params.cosmosQueryClient.fetchPriceOracle();

  const [feeStore, balances, oraclePrices, dstTokenInfo] = await Promise.all([
    getFeeStore(params.cosmosQueryClient),
    params.preloadedBalances
      ? Promise.resolve(params.preloadedBalances)
      : getBalancesForSwap({
          evmAddress: params.address.eoa,
          chainList: params.chainList,
          vscClient: params.vscClient,
          filterWithSupportedTokens: false,
          publicClientList: params.publicClientList,
        }).then((r) => r.balances),
    oraclePricesPromise,
    getTokenInfo(opts.toTokenAddress, params.publicClientList.get(opts.toChainId), opts.dstChain),
  ]).catch((e) => {
    throw Errors.internal('Error fetching fee, balance or oracle', { cause: e });
  });

  return { feeStore, balances, oraclePrices, dstTokenInfo };
};

// --- shared route helpers ---

/** Merges a source swap's output into the bridgeAssets accumulator (mutates in place). */
const accumulateSwapIntoBridgeAssets = (bridgeAssets: BridgeAsset[], swap: QuoteResponse): void => {
  const existing = bridgeAssets.find(
    (ba) =>
      ba.chainID === Number(swap.chainID) &&
      equalFold(ba.contractAddress, swap.quote.output.contractAddress)
  );
  if (existing) {
    existing.ephemeralBalance = existing.ephemeralBalance.add(swap.quote.output.amount);
  } else {
    bridgeAssets.push({
      chainID: Number(swap.chainID),
      contractAddress: swap.quote.output.contractAddress,
      decimals: swap.quote.output.decimals,
      eoaBalance: new Decimal(0),
      ephemeralBalance: new Decimal(swap.quote.output.amount),
    });
  }
};

/** Maps FlatBalance[] to the common input shape expected by aggregator calls. */
const toAggregatorInputs = (balances: FlatBalance[]) =>
  balances.map((b) => ({
    amountRaw: mulDecimals(b.amount, b.decimals),
    chainID: new OmniversalChainID(b.universe, b.chainID),
    tokenAddress: toBytes(b.tokenAddress),
    value: b.value,
  }));

/** Maps BridgeAsset[] to the shape expected by calculateMaxBridgeFee (chainId, balance, universe). */
const toBridgeAssetInputs = (bridgeAssets: BridgeAsset[]) =>
  bridgeAssets.map((b) => ({
    ...b,
    chainId: b.chainID,
    balance: b.eoaBalance.add(b.ephemeralBalance).toFixed(),
    universe: Universe.ETHEREUM,
  }));

/** Assembles the final SwapRoute return object. */
const buildSwapRouteResult = ({
  type,
  source,
  bridge,
  destination,
  dstTokenInfo,
  aggregators,
  oraclePrices,
  balances,
  assetsUsed,
  buffer,
}: {
  type: SwapRoute['type'];
  source: SwapRoute['source'];
  bridge: SwapRoute['bridge'];
  destination: SwapRoute['destination'];
  dstTokenInfo: SwapRoute['dstTokenInfo'];
  aggregators: Aggregator[];
  oraclePrices: OraclePriceResponse;
  balances: FlatBalance[];
  assetsUsed: AssetUsed;
  buffer: string;
}): SwapRoute => ({
  type,
  source,
  bridge,
  destination,
  combined: isCombinedSameChainRoute({ source, bridge, destination }),
  dstTokenInfo,
  extras: { aggregators, oraclePrices, balances, assetsUsed },
  buffer: { amount: buffer },
});

// A route is "combined" when source and destination resolve to the same wrapper on the same
// chain with no bridge in between: every source swap lands on the dst chain, the dst-chain
// source execution exists, and its address equals the destination execution address.
//
// Pure-COT-source-on-dst (no source swaps) is out of scope for v1 — only one VSC tx today and
// existing dst handler already batches the EOA→wrapper transfer with the dst swap.
const isCombinedSameChainRoute = ({
  source,
  bridge,
  destination,
}: Pick<SwapRoute, 'source' | 'bridge' | 'destination'>): boolean => {
  if (bridge !== null) return false;
  if (source.swaps.length === 0) return false;
  if (!source.swaps.every((s) => Number(s.chainID) === destination.chainId)) return false;
  const srcExec = source.executions[destination.chainId];
  if (!srcExec) return false;
  return equalFold(srcExec.address, destination.execution.address);
};

/** Creates a blank destination object seeded with the given inputAmount for both min and max. */
const createDestination = (
  chainId: number,
  execution: DestinationExecution,
  inputAmount: Decimal
): SwapRoute['destination'] => ({
  chainId,
  eoaToDestinationAccount: null,
  execution,
  getDstSwap: async () => null,
  swap: { creationTime: Date.now(), tokenSwap: null, gasSwap: null },
  inputAmount: { min: inputAmount, max: inputAmount },
});

/**
 * Resolves the user-specified from[] entries against available balances.
 * Returns the source FlatBalance entries to use and the assetsUsed list for the intent.
 * When from[] is empty, all available balances are used as sources.
 */
const resolveSourceBalances = (
  from: ExactInSwapInput['from'],
  balances: FlatBalance[]
): { srcBalances: FlatBalance[]; assetsUsed: AssetUsed } => {
  const assetsUsed: AssetUsed = [];
  let srcBalances: FlatBalance[] = [];

  if (from.length > 0) {
    for (const f of from) {
      const comparison = normalizeToComparisonAddr(f.tokenAddress);
      const srcBalance = balances.find(
        (b) => equalFold(b.tokenAddress, comparison) && f.chainId === b.chainID
      );
      if (!srcBalance) {
        logger.error('ExactIN: no src balance found', {
          token: f.tokenAddress,
          chainId: f.chainId,
        });
        throw Errors.insufficientBalance(
          `available: 0, required: ${f.amount?.toString() ?? 'max'}`
        );
      }

      if (f.amount !== undefined) {
        const requiredBalance = divDecimals(f.amount, srcBalance.decimals);
        if (requiredBalance.gt(srcBalance.amount)) {
          throw Errors.insufficientBalance(
            `available: ${srcBalance.amount} ${srcBalance.symbol}, required: ${requiredBalance.toFixed()} ${srcBalance.symbol}`
          );
        }
        srcBalances.push({
          ...srcBalance,
          amount: requiredBalance.toFixed(),
          value: calculateValue(srcBalance.amount, srcBalance.value, f.amount).toNumber(),
        });
        assetsUsed.push({
          amount: requiredBalance.toFixed(),
          chainID: srcBalance.chainID,
          contractAddress: srcBalance.tokenAddress,
          decimals: srcBalance.decimals,
          symbol: srcBalance.symbol,
        });
      } else {
        // No amount specified — use full available balance
        srcBalances.push(srcBalance);
        assetsUsed.push({
          amount: srcBalance.amount,
          chainID: srcBalance.chainID,
          contractAddress: srcBalance.tokenAddress,
          decimals: srcBalance.decimals,
          symbol: srcBalance.symbol,
        });
      }
    }
  } else {
    srcBalances = balances.slice();
    for (const b of srcBalances) {
      assetsUsed.push({
        amount: b.amount,
        chainID: b.chainID,
        contractAddress: b.tokenAddress,
        decimals: b.decimals,
        symbol: b.symbol,
      });
    }
  }

  return { srcBalances, assetsUsed };
};

/**
 * Builds assetsUsed, bridgeAssets, dstEOAToEphTx, and dstTotalCOTAmount from
 * `selectSources` results. Skips dst-chain entries from bridgeAssets and
 * tracks dst COT for bridge amount deduction.
 */
const buildExactOutSourceAssets = (
  usedCOTs: Awaited<ReturnType<typeof selectSources>>['usedCOTs'],
  sourceSwapQuotes: QuoteResponse[],
  dstChainId: number,
  dstCOTDecimals: number
) => {
  let dstEOAToEphTx: { amount: bigint; contractAddress: Hex } | null = null;

  const dstChainExistingCOT = usedCOTs.find(
    (c) => Number(c.originalHolding.chainID.chainID) === dstChainId
  );
  if (dstChainExistingCOT) {
    dstEOAToEphTx = {
      amount: mulDecimals(dstChainExistingCOT.amountUsed, dstChainExistingCOT.cur.decimals),
      contractAddress: convertToEVMAddress(dstChainExistingCOT.originalHolding.tokenAddress),
    };
  }

  const assetsUsed: AssetUsed = [];
  const bridgeAssets: BridgeAsset[] = [];

  let dstTotalCOTAmount = new Decimal(
    dstEOAToEphTx ? divDecimals(dstEOAToEphTx.amount, dstCOTDecimals) : 0
  );

  for (const cot of usedCOTs) {
    assetsUsed.push({
      amount: cot.amountUsed.toFixed(),
      chainID: Number(cot.originalHolding.chainID.chainID),
      contractAddress: convertToEVMAddress(cot.originalHolding.tokenAddress),
      decimals: cot.cur.decimals,
      symbol: CurrencyID[cot.cur.currencyID],
    });

    if (Number(cot.originalHolding.chainID.chainID) === dstChainId) {
      continue;
    }

    bridgeAssets.push({
      chainID: Number(cot.originalHolding.chainID.chainID),
      contractAddress: convertToEVMAddress(cot.originalHolding.tokenAddress),
      decimals: cot.cur.decimals,
      eoaBalance: cot.amountUsed,
      ephemeralBalance: new Decimal(0),
    });
  }

  for (const swap of sourceSwapQuotes) {
    assetsUsed.push({
      amount: swap.quote.input.amount,
      chainID: swap.chainID,
      contractAddress: swap.quote.input.contractAddress,
      decimals: swap.quote.input.decimals,
      symbol: swap.quote.input.symbol,
    });

    if (swap.chainID === dstChainId) {
      dstTotalCOTAmount = dstTotalCOTAmount.plus(swap.quote.output.amount);
      continue;
    }

    accumulateSwapIntoBridgeAssets(bridgeAssets, swap);
  }

  return { assetsUsed, bridgeAssets, dstTotalCOTAmount, dstEOAToEphTx };
};

const _exactOutRoute = async (
  input: ExactOutSwapInput,
  params: SwapParams & {
    publicClientList: PublicClientList;
    aggregators: Aggregator[];
    cotCurrencyID: CurrencyID;
  }
): Promise<{
  route: SwapRoute;
  refresh: (input: ExactOutSwapInput) => Promise<SwapRoute>;
}> => {
  // === CLOSURE: computed once per swap() session, reused on every refresh ===========
  //
  // Stable across refresh: dst chain identity, oracle prices, fee store, dst-token
  // metadata, the unfiltered raw balance set, and chain-level wrapper executions. The
  // refresh body re-applies fromSources / removeSources filters against `rawBalances`,
  // re-runs the aggregator quotes, and rebuilds the bridge intent. Balances are NOT
  // re-fetched — refresh latency drops by the fetch round-trip + the fanout that
  // getBalancesForSwap incurs on its own (vservice + transfer-fee per native chain).
  //
  // Caveat: a user who moves funds during the intent-approval window will see the
  // pre-move balance set in subsequent refreshes. The aggregator quote at execution
  // time will catch any actual insufficiency; we accept the small stale-state window
  // in exchange for the latency win.

  const dstChain = params.chainList.getChainByID(input.toChainId);
  if (!dstChain) {
    throw Errors.chainNotFound(input.toChainId);
  }

  // Fetch unfiltered balances. allowedSources/removeSources were previously passed
  // here so getBalancesForSwap could pre-filter; we now apply both per-call in refresh
  // (so a refresh with a different fromSources doesn't have to re-fetch).
  performance.mark('route-fetch-start');
  const {
    feeStore,
    balances: rawBalances,
    oraclePrices,
    dstTokenInfo,
  } = await fetchRouteData(params, {
    toChainId: input.toChainId,
    toTokenAddress: input.toTokenAddress,
    dstChain,
  });
  performance.mark('route-fetch-end');

  const { cot: dstChainCOT, address: dstChainCOTAddress } = getCOTForChainId(
    input.toChainId,
    params.cotCurrencyID
  );
  const dstOmniversalChainID = new OmniversalChainID(Universe.ETHEREUM, input.toChainId);

  // Chain-level Safe addresses are deterministic from the ephemeral, so resolve once
  // across the dst chain plus every chain that appears in the unfiltered balance set.
  // Any fromSources used in refresh is necessarily a subset.
  const { executions: chainExecutions, verification: executionsVerification } =
    resolveChainExecutions({
      chainIds: [input.toChainId, ...rawBalances.map((b) => b.chainID)],
      ephemeralAddress: params.address.ephemeral,
      chainList: params.chainList,
      vscClient: params.vscClient,
    });

  // === REFRESH: re-runs per call ===================================================
  //
  // toChainId / toTokenAddress are immutable across refresh (they're the destination
  // identity — refresh re-quoting against a different destination is a different swap).
  // toAmount / toNativeAmount sentinels and fromSources MAY change between calls, so
  // every dependent value (removeSources, gasInCOT, needsTokenSwap, …) is recomputed
  // here from `currentInput`, not closed over the initial input.
  const refresh = async (currentInput: ExactOutSwapInput): Promise<SwapRoute> => {
    // toAmount / toNativeAmount sentinel semantics (same shape for both):
    //   > 0n   : shortfall — bridge this amount. Remove from dst-chain sources entirely.
    //   < -1n  : surplus — reserve abs(value) from dst balance, use the rest as a swap source.
    //   === -1n: exactly enough — remove from dst-chain sources entirely.
    const removeSources: Source[] = [];
    if (currentInput.toAmount === -1n || currentInput.toAmount > 0n) {
      removeSources.push({
        chainId: currentInput.toChainId,
        tokenAddress: currentInput.toTokenAddress,
      });
    }
    const reserveTokenAmount = currentInput.toAmount < -1n ? -currentInput.toAmount : undefined;
    const reserveNativeAmount =
      currentInput.toNativeAmount && currentInput.toNativeAmount < -1n
        ? -currentInput.toNativeAmount
        : undefined;
    if (
      currentInput.toNativeAmount === -1n ||
      (currentInput.toNativeAmount && currentInput.toNativeAmount > 0n)
    ) {
      removeSources.push({
        chainId: currentInput.toChainId,
        tokenAddress: ZERO_ADDRESS,
      });
    }

    // Always apply filters against the closure's unfiltered set so a refresh with a
    // different fromSources doesn't carry over a previous filter.
    let balances = rawBalances;
    if (currentInput.fromSources?.length) {
      balances = filterAllowedSources(balances, currentInput.fromSources);
    }
    balances = filterRemoveSources(balances, removeSources);

    // Surplus case: reserve the required amount from dst-chain balance so only the
    // surplus is available as a swap source.
    if (reserveTokenAmount) {
      balances = deductReservedBalance(
        balances,
        currentInput.toChainId,
        normalizeToComparisonAddr(currentInput.toTokenAddress),
        reserveTokenAmount,
        dstTokenInfo.decimals
      );
    }
    if (reserveNativeAmount) {
      balances = deductReservedBalance(
        balances,
        currentInput.toChainId,
        normalizeToComparisonAddr(ZERO_ADDRESS),
        reserveNativeAmount,
        dstChain.nativeCurrency.decimals
      );
    }

    logger.debug('exact-out: fetched balances', { balances, input: currentInput });

    let gasInCOT = new Decimal(0);
    if (currentInput.toNativeAmount && currentInput.toNativeAmount > 0n) {
      // Convert to COT
      gasInCOT = convertGasToToken(
        {
          contractAddress: dstChainCOTAddress,
          decimals: dstChainCOT.decimals,
        },
        oraclePrices,
        dstChain.id,
        dstChain.universe,
        divDecimals(currentInput.toNativeAmount, dstChain.nativeCurrency.decimals)
      ).mul(1.02);
    }

    let buffer = new Decimal(0);

    const needsTokenSwap =
      currentInput.toAmount > 0n && !equalFold(currentInput.toTokenAddress, dstChainCOTAddress);
    const needsGasSwap = !gasInCOT.isZero();

    const sortedBalances = sortSourcesByPriority(balances, {
      tokenAddress: currentInput.toTokenAddress,
      symbol: dstTokenInfo.symbol,
      chainID: dstChain.id,
    });
    let destinationExecution: DestinationExecution =
      needsTokenSwap || needsGasSwap
        ? chainExecutions[currentInput.toChainId]
        : buildDirectEoaDestinationExecution(params.address.eoa);
    // Aggregator simulation context (taker_address / fromAddress) must be the wrapper —
    // that's the on-chain executor at runtime, so the aggregator's permit/approval routing
    // has to match. Output recipient is the user's EOA so we never need to sweep token or
    // native dust out of the wrapper post-swap. Safe doesn't implement ERC-7914, so the
    // previous wrapper-as-recipient + sweep pattern broke `approveNative`. Splitting these
    // two roles (userAddress vs receiverAddress) lets the aggregator simulate as the wrapper
    // but deliver output to the EOA. Applies uniformly to 7702 (Calibur) and `safe_account`.
    const dstSwapTakerInBytes = convertTo32Bytes(destinationExecution.address);
    const dstSwapReceiverInBytes = convertTo32Bytes(params.address.eoa);

    // COT required for direct transfer when toToken IS COT and toAmount is a positive
    // shortfall. Zero when a swap resolves it, or under sentinel toAmount (-1n / <-1n).
    const cotTransferAmount =
      currentInput.toAmount > 0n && !needsTokenSwap
        ? divDecimals(currentInput.toAmount, dstChainCOT.decimals)
        : new Decimal(0);

    const destination = createDestination(
      currentInput.toChainId,
      destinationExecution,
      cotTransferAmount.add(gasInCOT)
    );

    let originalMax: Decimal | null = null;
    // `skipRateGuard` is set by combined retries (CombinedSwapHandler.requoteBothLegs).
    // The originalMax rate-tolerance check exists to protect bridge flows where the bridge
    // was already sized against the first dst quote — a requote whose input requirement
    // outgrows that fixed budget cannot be funded. Combined batches are atomic on a single
    // wrapper: src outputs and dst inputs balance in the same tx, with no pre-committed
    // bridge to underfund. The combined handler enforces its own funding invariant
    // (`availableCOT ≥ dst.input`, where `availableCOT = src.output + eoaToDestinationAccount`)
    // instead, so this guard must not fire there.
    const getDstSwap = async (opts: { skipRateGuard?: boolean } = {}): Promise<DestinationSwap> => {
      if (!needsTokenSwap && !needsGasSwap) {
        return { creationTime: Date.now(), tokenSwap: null, gasSwap: null };
      }

      const [tokenSwap, gasSwap] = await Promise.all([
        needsTokenSwap
          ? getDestinationExactOutSwap({
              takerAddress: dstSwapTakerInBytes,
              receiverAddress: dstSwapReceiverInBytes,
              requirement: {
                chainID: dstOmniversalChainID,
                amountRaw: BigInt(currentInput.toAmount),
                tokenAddress: convertTo32Bytes(currentInput.toTokenAddress),
              },
              aggregators: params.aggregators,
            })
          : null,
        needsGasSwap
          ? getDestinationExactInSwap({
              takerAddress: dstSwapTakerInBytes,
              receiverAddress: dstSwapReceiverInBytes,
              chain: dstOmniversalChainID,
              inputAmount: mulDecimals(gasInCOT, dstChainCOT.decimals),
              outputToken: EADDRESS_32_BYTES,
              aggregators: params.aggregators,
            })
          : null,
      ]);

      // COT input = swap quote input (or direct COT transfer) + gas
      destination.inputAmount.min = new Decimal(
        tokenSwap?.quote.input.amount ?? cotTransferAmount
      ).add(gasInCOT);

      if (originalMax === null) {
        // First call: size the bridge by adding the destination buffer (min(10%, $2)).
        // Leftover COT at the wrapper post-swap is swept back to the EOA.
        const { amountWithBuffer, buffer: dstBuffer } = applyBufferWithCap(
          destination.inputAmount.min,
          BUFFER_EXACT_OUT.DESTINATION_SWAP_BUFFER_PCT,
          BUFFER_EXACT_OUT.DESTINATION_SWAP_MAX_IN_USD
        );
        const rounded = amountWithBuffer.toDP(dstChainCOT.decimals, Decimal.ROUND_CEIL);
        originalMax = rounded;
        destination.inputAmount.max = rounded;
        buffer = buffer.add(dstBuffer);
      } else if (destination.inputAmount.min.gt(originalMax) && !opts.skipRateGuard) {
        // Requote: the bridge has already been sized for `originalMax`. A requote whose
        // input requirement still fits inside that budget is fine — leftover gets swept.
        // Only reject when the requote genuinely outgrows what the bridge funded; do NOT
        // re-add the buffer on top of newInputMin (that would shrink the usable budget
        // and reject valid requotes that actually fit). inputAmount.max stays pinned at
        // originalMax — the bridge already happened, the budget is fixed.
        throw Errors.ratesChangedBeyondTolerance(
          Number(destination.inputAmount.min.toFixed()),
          `max budget: ${originalMax.toFixed()}`
        );
      }

      return { creationTime: Date.now(), tokenSwap, gasSwap };
    };

    performance.mark('route-dst-quote-start');
    destination.swap = await getDstSwap();
    performance.mark('route-dst-quote-end');
    destination.getDstSwap = getDstSwap;

    logger.debug('destination swaps', destination.swap);

    // One balance per chain, mapped to its COT for collection fee estimation
    const cotBalancesPerChain = uniqBy(
      balances.filter((b) => new Decimal(b.amount).gt(0)),
      (b) => b.chainID
    ).map((b) => {
      const { cot: chainCOT, address: cotAddress } = getCOTForChainId(
        b.chainID,
        params.cotCurrencyID
      );
      return {
        value: b.value,
        chainID: b.chainID,
        contractAddress: cotAddress,
        decimals: chainCOT.decimals,
      };
    });

    const estimatedCollectionFee = estimateCollectionFee(
      cotBalancesPerChain,
      destination.inputAmount.max,
      feeStore
    );
    const estimatedBridgeFees = feeStore
      .calculateFulfilmentFee({
        decimals: dstChainCOT.decimals,
        destinationChainID: Number(currentInput.toChainId),
        destinationTokenAddress: dstChainCOTAddress,
      })
      .add(estimatedCollectionFee);

    const bridgeOutput = destination.inputAmount.max;
    const bridgeOutputWithFees = bridgeOutput.add(estimatedBridgeFees);

    const { amountWithBuffer: sourceSwapOutputRequired, buffer: srcBuffer } = applyBufferWithCap(
      bridgeOutputWithFees,
      BUFFER_EXACT_OUT.SOURCE_SWAP_BUFFER_PCT,
      BUFFER_EXACT_OUT.SOURCE_SWAP_MAX_IN_USD
    );

    buffer = buffer.add(srcBuffer);

    logger.debug('exact-out: source swap requirements', {
      dstChainCOTAddress,
      srcBuffer: srcBuffer.toFixed(),
      buffer: buffer.toFixed(),
      estimatedBridgeFees: estimatedBridgeFees.toFixed(),
      bridgeOutput: bridgeOutput.toFixed(),
      sourceSwapOutputRequired: sourceSwapOutputRequired.toFixed(),
    });

    const sourceExecutions = pickSourceExecutions(chainExecutions, sortedBalances);

    // Hands the priority-ordered holdings (each carrying `value` in USD) to ca-common's
    // `selectSources`. That implementation only surveys the priority-ordered prefix whose
    // cumulative USD value covers `outputRequired × prefixHeadroom` (default 1.25), and
    // expands to additional holdings only if the prefix under-delivers — so the typical
    // route surveys a handful of holdings instead of every dust balance across 10+
    // chains.
    performance.mark('route-source-quote-start');
    const { quoteResponses: rawSourceSwapQuotes, usedCOTs: rawUsedCOTs } = await selectSources({
      sources: toAggregatorInputsWithSwapAddresses(sortedBalances, sourceExecutions),
      outputRequired: sourceSwapOutputRequired,
      aggregators: params.aggregators,
      commonCurrencyID: params.cotCurrencyID,
    }).catch((e) => {
      if (e instanceof Error && e.message === 'NOT_ENOUGH_SWAP_FOR_REQUIREMENT') {
        throw Errors.quoteError();
      }
      throw e;
    });
    performance.mark('route-source-quote-end');

    // autoSelectSources is sized against sourceSwapOutputRequired (= bridgeOutput +
    // bridgeFees + srcBuffer). When dst-chain holdings sit in the
    // (bridgeOutput, sourceSwapOutputRequired) window, they get fully consumed and a tiny
    // non-dst source is selected to cover the fee/buffer headroom. That non-dst contribution
    // isn't actually needed — dst-chain alone already covers bridgeOutput — and if left in
    // place it both drives `bridgeAmount` negative below and strands the non-dst source-swap
    // output at the source-chain wrapper (no bridge step would pick it up). Drop non-dst
    // selections in that case; the existing isBridgeRequired check then naturally evaluates
    // to false.
    const dstContribution = rawUsedCOTs
      .reduce(
        (sum, c) =>
          Number(c.originalHolding.chainID.chainID) === currentInput.toChainId
            ? sum.plus(c.amountUsed)
            : sum,
        new Decimal(0)
      )
      .plus(
        rawSourceSwapQuotes.reduce(
          (sum, q) =>
            q.chainID === currentInput.toChainId ? sum.plus(q.quote.output.amount) : sum,
          new Decimal(0)
        )
      );

    const dropNonDst = dstContribution.gte(bridgeOutput);
    const sourceSwapQuotes = dropNonDst
      ? rawSourceSwapQuotes.filter((q) => q.chainID === currentInput.toChainId)
      : rawSourceSwapQuotes;
    const usedCOTs = dropNonDst
      ? rawUsedCOTs.filter(
          (c) => Number(c.originalHolding.chainID.chainID) === currentInput.toChainId
        )
      : rawUsedCOTs;
    if (dropNonDst) {
      logger.debug('exact-out: dst-chain covers bridgeOutput, dropping non-dst selections', {
        dstContribution: dstContribution.toFixed(),
        bridgeOutput: bridgeOutput.toFixed(),
        droppedQuotes: rawSourceSwapQuotes.length - sourceSwapQuotes.length,
        droppedCOTs: rawUsedCOTs.length - usedCOTs.length,
      });
    }

    logger.debug('sourceSwap', {
      sourceSwapQuotes,
    });

    // selectSources' partial-quote loop overshoots by ~2.5%+ (safetyMultiplier=1.025 then
    // accepts the first quote where output ≥ remainder), so the final source-swap quote
    // typically delivers more COT than the target sourceSwapOutputRequired. The overshoot
    // lands at the wrapper / bridged forward and ultimately sweeps back to the user, so
    // surface it as additional buffer alongside srcBuffer / dstBuffer. Clamped at 0 because
    // the dropNonDst branch above may legitimately under-deliver vs sourceSwapOutputRequired
    // (dst-chain alone covers bridgeOutput, fees/srcBuffer are no longer needed).
    const actualSourceOutput = usedCOTs
      .reduce((sum, c) => sum.plus(c.amountUsed), new Decimal(0))
      .plus(sourceSwapQuotes.reduce((sum, q) => sum.plus(q.quote.output.amount), new Decimal(0)));
    const convergenceExcess = Decimal.max(0, actualSourceOutput.minus(sourceSwapOutputRequired));
    buffer = buffer.add(convergenceExcess);

    logger.debug('exact-out: loose-convergence excess', {
      actualSourceOutput: actualSourceOutput.toFixed(),
      sourceSwapOutputRequired: sourceSwapOutputRequired.toFixed(),
      convergenceExcess: convergenceExcess.toFixed(),
      buffer: buffer.toFixed(),
    });

    const sourceSwapCreationTime = Date.now();

    const { assetsUsed, bridgeAssets, dstTotalCOTAmount, dstEOAToEphTx } =
      buildExactOutSourceAssets(
        usedCOTs,
        sourceSwapQuotes,
        currentInput.toChainId,
        dstChainCOT.decimals
      );

    destination.eoaToDestinationAccount = dstEOAToEphTx;

    if (
      !needsTokenSwap &&
      !needsGasSwap &&
      hasDestinationChainSourceSwapOutput(
        sourceSwapQuotes,
        sourceExecutions,
        currentInput.toChainId,
        params.address.eoa
      )
    ) {
      // Source swaps land COT on the dst chain at a non-EOA wrapper, so the dst leg can't
      // stay as `direct_eoa` after all. The wrapper was already resolved up-front (same
      // chain, same ephemeral) — flip is a sync lookup, no extra VSC roundtrip.
      destinationExecution = chainExecutions[currentInput.toChainId];
      destination.execution = destinationExecution;
    }

    const isBridgeRequired = !(
      sourceSwapQuotes.every((q) => q.chainID === currentInput.toChainId) &&
      usedCOTs.every((q) => Number(q.originalHolding.chainID.chainID) === currentInput.toChainId)
    );

    let bridgeInput: BridgeInput = null;
    if (isBridgeRequired) {
      // Deduct dst-chain COT (already on destination, doesn't need bridging).
      const bridgeAmount = bridgeOutput.minus(dstTotalCOTAmount);
      if (bridgeAmount.lte(0)) {
        // Invariant: the dst-chain drop above guarantees dstTotalCOTAmount ≤ bridgeOutput
        // whenever isBridgeRequired is true. Reaching this branch means the invariant was
        // violated (e.g. a future change to autoSelectSources or buildExactOutSourceAssets
        // breaks the accounting). Log so the regression is visible, but skip the bridge
        // rather than build a degenerate zero/negative-amount intent.
        logger.warn('exact-out: non-positive bridgeAmount after dst-chain drop, skipping bridge', {
          bridgeAmount: bridgeAmount.toFixed(),
          bridgeOutput: bridgeOutput.toFixed(),
          dstTotalCOTAmount: dstTotalCOTAmount.toFixed(),
        });
      } else {
        const pendingBridge: PendingBridgeInput = {
          amount: bridgeAmount,
          assets: bridgeAssets,
          chainID: currentInput.toChainId,
          decimals: dstChainCOT.decimals,
          recipientAddress: destination.execution.address,
          tokenAddress: convertToEVMAddress(dstChainCOT.tokenAddress),
        };
        const intentResponse = createIntent({
          dstChain,
          assets: bridgeAssets,
          feeStore,
          output: pendingBridge,
          address: pendingBridge.recipientAddress,
        });
        bridgeInput = { ...pendingBridge, estimatedFees: intentResponse.intent.fees };
      }
    }

    logger.debug('exact-out: bridge', { bridgeAssets, bridgeInput, assetsUsed, dstEOAToEphTx });

    // VSC verification is fire-and-forget during the rest of route calc; resolve it now
    // before returning so any SDK ↔ server config drift surfaces here instead of mid-execution.
    // After the first refresh resolves it, subsequent refreshes just hit the already-settled
    // microtask.
    performance.mark('route-verify-start');
    await executionsVerification;
    performance.mark('route-verify-end');

    printRouteTimings();

    return buildSwapRouteResult({
      type: 'EXACT_OUT',
      source: {
        swaps: sourceSwapQuotes,
        creationTime: sourceSwapCreationTime,
        executions: sourceExecutions,
        srcBuffer,
      },
      bridge: bridgeInput,
      destination,
      dstTokenInfo,
      aggregators: params.aggregators,
      oraclePrices,
      balances,
      assetsUsed,
      buffer: buffer.toFixed(),
    });
  };

  return { route: await refresh(input), refresh };
};

type DestinationSwap = {
  creationTime: number;
  tokenSwap: QuoteResponse | null;
  gasSwap: QuoteResponse | null;
};

export type SwapRoute = {
  type: 'EXACT_IN' | 'EXACT_OUT';
  source: {
    swaps: QuoteResponse[];
    creationTime: number;
    executions: SourceExecutionRecord;
    // Headroom in COT units that source swaps are allowed to lose on a re-quote when one
    // or more source legs revert. EXACT_OUT carries `min(2%, $1)` of bridgeOutputWithFees
    // (see BUFFER_EXACT_OUT). EXACT_IN carries `min(0.5%, $1)` of swapCombinedBalance
    // (see BUFFER_EXACT_IN). Non-combined EXACT_IN also subtracts this from the dst-swap
    // input so the dst swap stays funded if a source leg re-quotes lower; combined routes
    // under-size the dst-swap input by `COMBINED_SAME_CHAIN_BUFFER_PCT` instead.
    //
    // Consumed by SourceSwapsHandler.retryWithSlippageCheck (via `liquidateAndCheckSrcBuffer`)
    // on bridge-flow retries. NOT consumed by CombinedSwapHandler — combined retries enforce
    // `availableCOT ≥ dst.input` inline instead, where `availableCOT = src.output +
    // eoaToDestinationAccount`.
    srcBuffer: Decimal;
  };
  bridge: BridgeInput;
  destination: {
    chainId: number;
    eoaToDestinationAccount: {
      amount: bigint;
      contractAddress: Hex;
    } | null;
    execution: DestinationExecution;
    inputAmount: { min: Decimal; max: Decimal }; // This is input of tokenSwap + gasSwap + buffer
    swap: DestinationSwap;
    getDstSwap: (opts?: { skipRateGuard?: boolean }) => Promise<DestinationSwap | null>;
  };
  // True when the route's source legs and destination leg can be executed as a single batched
  // transaction on one same-chain wrapper (no bridge, every source swap lands on the dst chain,
  // and the source wrapper IS the destination wrapper).
  combined: boolean;
  buffer: {
    amount: string;
  };
  dstTokenInfo: Awaited<ReturnType<typeof getTokenInfo>>;
  extras: {
    assetsUsed: {
      amount: string;
      chainID: number;
      contractAddress: Hex;
      decimals: number;
      symbol: string;
    }[];
    aggregators: Aggregator[];
    oraclePrices: OraclePriceResponse;
    balances: FlatBalance[];
  };
};

type AssetUsed = {
  amount: string;
  chainID: number;
  contractAddress: Hex;
  decimals: number;
  symbol: string;
}[];

type PendingBridgeInput = {
  amount: Decimal;
  assets: BridgeAsset[];
  chainID: number;
  decimals: number;
  recipientAddress: Hex;
  tokenAddress: `0x${string}`;
};

type BridgeInput =
  | (PendingBridgeInput & {
      estimatedFees: {
        caGas: string;
        gasSupplied: string;
        protocol: string;
        solver: string;
        // total: string;
      };
    })
  | null;

/**
 * Builds an EXACT_IN SwapRoute for the same-token bridgeable family case (USDT → USDT,
 * ETH → ETH, etc.). No source swap, no destination swap; the bridge moves the token directly
 * from non-dst sources to the user's EOA on the destination chain. Dst-chain sources stay at
 * the EOA (nothing to bridge for them).
 */
const buildSameTokenBridgeRoute = async ({
  currentInput,
  srcBalances,
  sourceExecutions,
  assetsUsed,
  dstChain,
  dstTokenInfo,
  feeStore,
  rawBalances,
  oraclePrices,
  executionsVerification,
  aggregators,
  eoaAddress,
  chainList,
}: {
  currentInput: ExactInSwapInput;
  srcBalances: FlatBalance[];
  sourceExecutions: SourceExecutionRecord;
  assetsUsed: AssetUsed;
  dstChain: Chain;
  dstTokenInfo: Awaited<ReturnType<typeof getTokenInfo>>;
  feeStore: FeeStore;
  rawBalances: FlatBalance[];
  oraclePrices: OraclePriceResponse;
  executionsVerification: Promise<void>;
  aggregators: Aggregator[];
  eoaAddress: Hex;
  chainList: ChainListType;
}): Promise<SwapRoute> => {
  const dstTokenIsNative =
    equalFold(currentInput.toTokenAddress, ZERO_ADDRESS) ||
    equalFold(currentInput.toTokenAddress, EADDRESS);
  const dstTokenAddress: Hex = dstTokenIsNative ? ZERO_ADDRESS : currentInput.toTokenAddress;
  const dstTokenDecimals = dstTokenInfo.decimals;

  const bridgeAssets: BridgeAsset[] = [];
  let bridgeBalance = new Decimal(0);
  let dstChainBalance = new Decimal(0);
  for (const source of srcBalances) {
    if (source.chainID === currentInput.toChainId) {
      dstChainBalance = dstChainBalance.add(source.amount);
      continue;
    }
    // Normalize EADDRESS → ZERO_ADDRESS. Swap internals carry native as EADDRESS (see
    // swap/sort.ts), but the bridge intent's `chainList.getTokenByAddress` lookup only
    // resolves ZERO_ADDRESS as native — passing EADDRESS through causes the RFF builder
    // to throw `Token/Asset … is not supported on chain`.
    const evmAddress = convertToEVMAddress(source.tokenAddress);
    const sourceContractAddress: Hex = equalFold(evmAddress, EADDRESS) ? ZERO_ADDRESS : evmAddress;
    bridgeAssets.push({
      chainID: source.chainID,
      contractAddress: sourceContractAddress,
      decimals: source.decimals,
      eoaBalance: new Decimal(source.amount),
      ephemeralBalance: new Decimal(0),
    });
    bridgeBalance = bridgeBalance.add(source.amount);
  }

  logger.debug('same-token bridge: route inputs', {
    dstChainId: currentInput.toChainId,
    dstTokenAddress,
    dstTokenIsNative,
    dstTokenDecimals,
    bridgeAssets: bridgeAssets.map((a) => ({
      ...a,
      eoaBalance: a.eoaBalance.toFixed(),
      ephemeralBalance: a.ephemeralBalance.toFixed(),
    })),
    bridgeBalance: bridgeBalance.toFixed(),
    dstChainBalance: dstChainBalance.toFixed(),
  });

  let bridgeInput: BridgeInput = null;
  if (bridgeAssets.length > 0) {
    // Known sources → `maxAmount` IS the exact destination amount. Skip the deposit-gas
    // haircut: deposits go through the ephemeral pipeline (Calibur / Safe via VSC), so
    // gas is sponsored — the user's full native balance is bridgeable.
    const { maxAmount } = await calculateMaxBridgeFee({
      assets: toBridgeAssetInputs(bridgeAssets),
      dst: {
        chainId: currentInput.toChainId,
        tokenAddress: dstTokenAddress,
        decimals: dstTokenDecimals,
      },
      feeStore,
      chainList,
      skipDepositGasDeduction: true,
    });
    const bridgeAmount = new Decimal(maxAmount);
    logger.debug('same-token bridge: maxAmount computed', {
      bridgeBalance: bridgeBalance.toFixed(),
      maxAmount,
      bridgeAmount: bridgeAmount.toFixed(),
      impliedFee: bridgeBalance.minus(bridgeAmount).toFixed(),
    });
    if (bridgeAmount.lte(0)) {
      throw Errors.internal(
        `same-token bridge: bridge amount non-positive after fees: ${bridgeAmount.toFixed()}`
      );
    }
    bridgeInput = {
      amount: bridgeAmount,
      assets: bridgeAssets,
      chainID: currentInput.toChainId,
      decimals: dstTokenDecimals,
      recipientAddress: eoaAddress,
      tokenAddress: dstTokenAddress,
      estimatedFees: createIntent({
        dstChain,
        assets: bridgeAssets,
        feeStore,
        output: {
          chainID: currentInput.toChainId,
          tokenAddress: dstTokenAddress,
          decimals: dstTokenDecimals,
          amount: bridgeAmount,
        },
        address: eoaAddress,
      }).intent.fees,
    };
  }

  const destinationExecution = buildDirectEoaDestinationExecution(eoaAddress);
  const finalAmount = (bridgeInput?.amount ?? new Decimal(0)).plus(dstChainBalance);
  const destination = createDestination(currentInput.toChainId, destinationExecution, finalAmount);

  logger.debug('same-token bridge: route built', {
    bridgeAmount: bridgeInput?.amount.toFixed() ?? '0',
    bridgeTokenAddress: bridgeInput?.tokenAddress,
    bridgeRecipient: bridgeInput?.recipientAddress,
    dstChainBalance: dstChainBalance.toFixed(),
    finalAmount: finalAmount.toFixed(),
    destinationExecutionMode: destinationExecution.mode,
    bridgeNull: bridgeInput === null,
  });

  await executionsVerification;
  printRouteTimings();

  return buildSwapRouteResult({
    type: 'EXACT_IN',
    source: {
      swaps: [],
      creationTime: Date.now(),
      executions: sourceExecutions,
      srcBuffer: new Decimal(0),
    },
    bridge: bridgeInput,
    destination,
    dstTokenInfo,
    aggregators,
    oraclePrices,
    balances: rawBalances,
    assetsUsed,
    buffer: '0',
  });
};

const _exactInRoute = async (
  input: ExactInSwapInput,
  params: SwapParams & {
    aggregators: Aggregator[];
    publicClientList: PublicClientList;
    cotCurrencyID: CurrencyID;
  }
): Promise<{
  route: SwapRoute;
  refresh: (input: ExactInSwapInput) => Promise<SwapRoute>;
}> => {
  // === CLOSURE: computed once per swap() session, reused on every refresh ===========
  //
  // Stable: dst chain identity, raw balance set, oracle prices, fee store, dst token
  // metadata, and chain-level wrapper executions. The closure does NOT pre-apply
  // `input.from` filtering — that may change across refresh and is recomputed per call
  // via `resolveSourceBalances` inside refresh.

  logger.debug('exactInRoute', {
    input,
    params,
  });

  const dstChain = params.chainList.getChainByID(input.toChainId);
  if (!dstChain) {
    throw Errors.chainNotFound(input.toChainId);
  }

  performance.mark('route-fetch-start');
  const {
    feeStore,
    balances: rawBalances,
    oraclePrices,
    dstTokenInfo,
  } = await fetchRouteData(params, {
    toChainId: input.toChainId,
    toTokenAddress: input.toTokenAddress,
    dstChain,
  });
  performance.mark('route-fetch-end');

  if (rawBalances.length === 0) {
    throw Errors.noBalanceForAddress(params.address.eoa);
  }

  const { cot: dstChainCOT, address: dstChainCOTAddress } = getCOTForChainId(
    input.toChainId,
    params.cotCurrencyID
  );
  const dstOmniversalChainID = new OmniversalChainID(Universe.ETHEREUM, input.toChainId);

  // Resolve every chain we'll need a wrapper on across the full unfiltered balance set
  // (any refresh `from` is necessarily a subset). VSC verification fires in the
  // background and is awaited inside refresh just before the route returns.
  const { executions: chainExecutions, verification: executionsVerification } =
    resolveChainExecutions({
      chainIds: [input.toChainId, ...rawBalances.map((b) => b.chainID)],
      ephemeralAddress: params.address.ephemeral,
      chainList: params.chainList,
      vscClient: params.vscClient,
    });

  // === REFRESH: re-runs per call ===================================================
  const refresh = async (currentInput: ExactInSwapInput): Promise<SwapRoute> => {
    logger.debug('exact-in: refresh start', {
      from: currentInput.from,
      toChainId: currentInput.toChainId,
      toTokenAddress: currentInput.toTokenAddress,
      rawBalanceCount: rawBalances.length,
    });

    const { srcBalances, assetsUsed } = resolveSourceBalances(currentInput.from, rawBalances);
    const sourceExecutions = pickSourceExecutions(chainExecutions, srcBalances);

    logger.debug('exact-in: resolved srcBalances', {
      srcBalances: srcBalances.map((b) => ({
        chainID: b.chainID,
        tokenAddress: b.tokenAddress,
        symbol: b.symbol,
        amount: b.amount,
      })),
    });

    // Same-token bridgeable fast-path: when dst is a non-COT knownToken/native AND every
    // source resolves to the same canonical symbol, skip the COT round-trip and bridge the
    // token directly EOA → EOA. USDC family stays in the existing path (the COT === USDC
    // bridge already handles it efficiently).
    const cotSymbol = CurrencyID[params.cotCurrencyID];
    const dstSymbol = getBridgeableSymbol(
      params.chainList,
      currentInput.toChainId,
      currentInput.toTokenAddress
    );
    const sourceSymbols = srcBalances.map((b) => ({
      chainID: b.chainID,
      tokenAddress: convertToEVMAddress(b.tokenAddress),
      symbol: getBridgeableSymbol(params.chainList, b.chainID, convertToEVMAddress(b.tokenAddress)),
    }));
    const dstSymbolMissing = !dstSymbol;
    const dstIsCot = !!dstSymbol && equalFold(dstSymbol, cotSymbol);
    const sourcesMatchDst =
      !!dstSymbol && sourceSymbols.every((s) => !!s.symbol && equalFold(s.symbol, dstSymbol));
    const sameTokenEligible = !dstSymbolMissing && !dstIsCot && sourcesMatchDst;
    logger.debug('exact-in: same-token bridgeable check', {
      dstChainId: currentInput.toChainId,
      dstTokenAddress: currentInput.toTokenAddress,
      dstSymbol,
      cotSymbol,
      sourceSymbols,
      reason: sameTokenEligible
        ? 'taking same-token fast-path'
        : dstSymbolMissing
          ? 'dst token not in knownTokens / not native — falling back to COT'
          : dstIsCot
            ? 'dst symbol matches COT — existing COT path handles this efficiently'
            : 'one or more sources do not match dst symbol — falling back to COT',
    });
    if (sameTokenEligible) {
      return await buildSameTokenBridgeRoute({
        currentInput,
        srcBalances,
        sourceExecutions,
        assetsUsed,
        dstChain,
        dstTokenInfo,
        feeStore,
        rawBalances,
        oraclePrices,
        executionsVerification,
        aggregators: params.aggregators,
        eoaAddress: params.address.eoa,
        chainList: params.chainList,
      });
    }

    const bridgeAssets: BridgeAsset[] = [];

    // Filter out COT's in sources
    const cotSources: FlatBalance[] = [];
    let cotCombinedBalance = new Decimal(0);

    for (const source of srcBalances) {
      const { address: cotAddress } = getCOTForChainId(source.chainID, params.cotCurrencyID);
      if (equalFold(convertToEVMAddress(source.tokenAddress), cotAddress)) {
        cotSources.push(source);
        cotCombinedBalance = cotCombinedBalance.add(source.amount);

        bridgeAssets.push({
          chainID: source.chainID,
          contractAddress: convertToEVMAddress(source.tokenAddress),
          decimals: source.decimals,
          eoaBalance: new Decimal(source.amount),
          ephemeralBalance: new Decimal(0),
        });
      }
    }

    logger.debug('exact-in: cot sources', {
      cotCombinedBalance,
      cotSources,
      bridgeAssets,
    });

    // Check if source swap is required (if all source balances are not COT currencyID)
    const isSrcSwapRequired = cotSources.length !== srcBalances.length;
    // Check if bridge is required (if all source balances are not on destination chain)
    const isBridgeRequired = !srcBalances.every((b) => b.chainID === currentInput.toChainId);

    logger.debug('exact-in: swap flags', {
      isSrcSwapRequired,
      isBridgeRequired,
    });

    let sourceSwaps: QuoteResponse[] = [];
    if (isSrcSwapRequired) {
      performance.mark('route-source-quote-start');
      const response = await liquidateSourceHoldings({
        holdings: toAggregatorInputsWithSwapAddresses(srcBalances, sourceExecutions),
        aggregators: params.aggregators,
        commonCurrencyID: params.cotCurrencyID,
      });
      performance.mark('route-source-quote-end');

      if (!response.length) {
        throw Errors.quoteFailed('source swap returned no quotes');
      }

      sourceSwaps = response;
    }
    const sourceSwapCreationTime = Date.now();

    let swapCombinedBalance = new Decimal(0);
    for (const swap of sourceSwaps) {
      accumulateSwapIntoBridgeAssets(bridgeAssets, swap);
      swapCombinedBalance = swapCombinedBalance.add(swap.quote.output.amount);
    }

    let dstSwapInputAmountInDecimal = Decimal.add(cotCombinedBalance, swapCombinedBalance);

    logger.debug('exact-in: combined cot after source swaps', {
      dstSwapInputAmountInDecimal: dstSwapInputAmountInDecimal.toFixed(),
      bridgeAssets,
    });

    let bridgeInput: BridgeInput = null;
    if (isBridgeRequired) {
      performance.mark('route-max-bridge-fee-start');
      const { fee: maxFee } = await calculateMaxBridgeFee({
        assets: toBridgeAssetInputs(bridgeAssets),
        dst: {
          chainId: currentInput.toChainId,
          tokenAddress: dstChainCOTAddress,
          decimals: dstChainCOT.decimals,
        },
        feeStore,
        chainList: params.chainList,
      });
      performance.mark('route-max-bridge-fee-end');

      dstSwapInputAmountInDecimal = dstSwapInputAmountInDecimal.minus(maxFee);
      logger.debug('exact-in: after bridge fee deduction', {
        dstSwapInputAmountInDecimal: dstSwapInputAmountInDecimal.toFixed(),
        maxFee: maxFee.toFixed(),
      });
      if (dstSwapInputAmountInDecimal.isNegative()) {
        throw Errors.internal('bridge fees exceeds source amount');
      }

      // Deduct dst-chain COT from the bridge output target. The user's dst-chain COT lands
      // at the destination wrapper via `eoaToDestinationAccount`, and any source swap whose
      // output sits on the dst chain is already at the wrapper (source wrapper == dst wrapper
      // on the same chain). The bridge only sources non-dst chains — including the dst-chain
      // portion in `bridgeInput.amount` makes createBridgeRFF try to borrow more than the
      // non-dst sources can supply and throws "Insufficient balance to proceed" at execution
      // time. Mirrors `_exactOutRoute`'s `bridgeAmount = bridgeOutput.minus(dstTotalCOTAmount)`.
      const dstChainCotAmount = cotSources
        .filter((s) => s.chainID === currentInput.toChainId)
        .reduce((sum, s) => sum.plus(s.amount), new Decimal(0));
      const dstChainSrcSwapAmount = sourceSwaps
        .filter((s) => Number(s.chainID) === currentInput.toChainId)
        .reduce((sum, s) => sum.plus(s.quote.output.amount), new Decimal(0));
      const bridgeAmount = dstSwapInputAmountInDecimal
        .minus(dstChainCotAmount)
        .minus(dstChainSrcSwapAmount);
      if (bridgeAmount.lte(0)) {
        throw Errors.internal(
          `bridge amount non-positive after dst-chain COT deduction: ${bridgeAmount.toFixed()}`
        );
      }

      bridgeInput = {
        amount: bridgeAmount,
        assets: bridgeAssets,
        chainID: currentInput.toChainId,
        decimals: dstChainCOT.decimals,
        recipientAddress: params.address.ephemeral,
        tokenAddress: convertToEVMAddress(dstChainCOT.tokenAddress),
        estimatedFees: createIntent({
          dstChain,
          assets: bridgeAssets,
          feeStore,
          output: {
            chainID: currentInput.toChainId,
            tokenAddress: dstChainCOTAddress,
            decimals: dstChainCOT.decimals,
            amount: new Decimal(0),
          },
          address: params.address.ephemeral,
        }).intent.fees,
      };
    }

    logger.debug('exact-in: before destination swap', {
      dstSwapInputAmountInDecimal: dstSwapInputAmountInDecimal.toFixed(),
    });

    const needsDstSwap = !equalFold(currentInput.toTokenAddress, dstChainCOTAddress);
    const hasDestinationChainSourceOutput = hasDestinationChainSourceSwapOutput(
      sourceSwaps,
      sourceExecutions,
      currentInput.toChainId,
      params.address.eoa
    );
    // Same chain executions resolved up-front; just pick (or downgrade to direct_eoa).
    const destinationExecution: DestinationExecution =
      needsDstSwap || hasDestinationChainSourceOutput
        ? chainExecutions[currentInput.toChainId]
        : buildDirectEoaDestinationExecution(params.address.eoa);

    // If the source swap(s) and the destination swap collapse to one same-wrapper batch (no
    // bridge in between), the dst aggregator will pull COT from the same wrapper the source
    // swap just deposited it into. Apply headroom on the dst input so per-leg slippage
    // between the two aggregator quotes can't strand the dst transferFrom on an under-supplied
    // wrapper. Leftover COT is swept back to the EOA by the existing dst sweeper.
    const willBeCombined =
      !isBridgeRequired &&
      sourceSwaps.length > 0 &&
      sourceSwaps.every((s) => Number(s.chainID) === currentInput.toChainId) &&
      !!sourceExecutions[currentInput.toChainId] &&
      equalFold(sourceExecutions[currentInput.toChainId].address, destinationExecution.address);

    // Source-retry headroom in COT units. Consumed by SourceSwapsHandler /
    // CombinedSwapHandler on revert+re-quote as the absolute amount of source-output drop
    // they tolerate. Combined routes use COMBINED_SAME_CHAIN_BUFFER_PCT for the dst-input
    // under-sizing (via the `willBeCombined` branch below); srcBuffer here is only the
    // retry tolerance.
    const srcBuffer = isSrcSwapRequired
      ? Decimal.min(
          swapCombinedBalance.mul(BUFFER_EXACT_IN.SOURCE_SWAP_BUFFER_PCT / 100),
          BUFFER_EXACT_IN.SOURCE_SWAP_MAX_IN_USD
        )
      : new Decimal(0);

    if (willBeCombined && needsDstSwap) {
      dstSwapInputAmountInDecimal = dstSwapInputAmountInDecimal.mul(
        1 - COMBINED_SAME_CHAIN_BUFFER_PCT / 100
      );
    } else if (srcBuffer.gt(0) && needsDstSwap) {
      // Under-size the dst-swap input by srcBuffer so a source re-quote drop up to that
      // amount doesn't strand the dst-swap transferFrom on an under-supplied wrapper.
      // Leftover COT post-swap is swept back to the EOA by the existing dst sweeper.
      dstSwapInputAmountInDecimal = dstSwapInputAmountInDecimal.minus(srcBuffer);
    }

    dstSwapInputAmountInDecimal = dstSwapInputAmountInDecimal.toDP(
      dstChainCOT.decimals,
      Decimal.ROUND_FLOOR
    );
    // See exact-out path: aggregator simulates as the wrapper (it's the on-chain executor) but
    // delivers swap output directly to the user's EOA. Wrapper holds the COT input; the EOA
    // receives the output. Splitting userAddress (taker) and receiverAddress prevents simulation
    // mismatches that previously caused GS013 reverts on Safe-mode chains.
    const dstSwapTakerInBytes = convertTo32Bytes(destinationExecution.address);
    const dstSwapReceiverInBytes = convertTo32Bytes(params.address.eoa);
    const destination = createDestination(
      currentInput.toChainId,
      destinationExecution,
      dstSwapInputAmountInDecimal
    );

    if (bridgeInput) {
      bridgeInput.recipientAddress = destinationExecution.address;
    }

    // If dst token isn't COT and user holds COT on the dst chain,
    // that COT must be moved from EOA → destination execution account for the destination swap.
    const dstChainCOTSource = cotSources.find((c) =>
      equalFold(convertToEVMAddress(c.tokenAddress), dstChainCOTAddress)
    );
    if (needsDstSwap && dstChainCOTSource) {
      destination.eoaToDestinationAccount = {
        amount: mulDecimals(dstChainCOTSource.amount, dstChainCOTSource.decimals),
        contractAddress: dstChainCOTAddress,
      };
    }

    // `skipRateGuard` is set by combined retries (CombinedSwapHandler.requoteBothLegs).
    // The 0.5% output-drop rate guard exists to protect bridge flows that committed an
    // input budget at quote time. Combined batches re-quote both legs together and enforce
    // their own funding invariant (`availableCOT ≥ dst.input`, where `availableCOT =
    // src.output + eoaToDestinationAccount`), so the guard must not fire there.
    const getDstSwap = async (opts: { skipRateGuard?: boolean } = {}) => {
      let tokenSwap = null;
      if (needsDstSwap) {
        tokenSwap = await getDestinationExactInSwap({
          takerAddress: dstSwapTakerInBytes,
          receiverAddress: dstSwapReceiverInBytes,
          chain: dstOmniversalChainID,
          inputAmount: mulDecimals(dstSwapInputAmountInDecimal, dstChainCOT.decimals),
          outputToken: convertTo32Bytes(currentInput.toTokenAddress),
          aggregators: params.aggregators,
          inputCurrency: dstChainCOT.currencyID,
        });

        // Rate guard on requote: check output didn't drop beyond 0.5% tolerance
        if (destination.swap.tokenSwap && !opts.skipRateGuard) {
          const prevAmountRaw = destination.swap.tokenSwap.quote.output.amountRaw;
          const newAmountRaw = tokenSwap.quote.output.amountRaw;
          if (newAmountRaw < (prevAmountRaw * 995n) / 1000n) {
            throw Errors.ratesChangedBeyondTolerance(newAmountRaw, '0.5%');
          }
        }
      }

      return { gasSwap: null, tokenSwap, creationTime: Date.now() };
    };

    performance.mark('route-dst-quote-start');
    destination.swap = await getDstSwap();
    performance.mark('route-dst-quote-end');
    destination.getDstSwap = getDstSwap;

    // VSC verification fired in the background while quotes ran; resolve it before returning.
    // After the first refresh resolves it, subsequent refreshes just hit the already-settled
    // microtask.
    performance.mark('route-verify-start');
    await executionsVerification;
    performance.mark('route-verify-end');

    printRouteTimings();

    return buildSwapRouteResult({
      type: 'EXACT_IN',
      source: {
        swaps: sourceSwaps,
        creationTime: sourceSwapCreationTime,
        executions: sourceExecutions,
        srcBuffer,
      },
      bridge: bridgeInput,
      destination,
      dstTokenInfo,
      aggregators: params.aggregators,
      oraclePrices,
      balances: rawBalances,
      assetsUsed,
      buffer: '0',
    });
  };

  return { route: await refresh(input), refresh };
};
