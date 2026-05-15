import {
  type Aggregator,
  autoSelectSources,
  type Bytes,
  ChaindataMap,
  CurrencyID,
  getDestinationExactInSwap,
  getDestinationExactOutSwap,
  liquidateSourceHoldings,
  OmniversalChainID,
  type QuoteResponse,
  Universe,
} from '@avail-project/ca-common';
import Decimal from 'decimal.js';
import { uniqBy } from 'es-toolkit';
import { type Hex, toBytes } from 'viem';
import {
  type BridgeAsset,
  type Chain,
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
  getBalancesForSwap,
  getFeeStore,
  mulDecimals,
} from '../core/utils';
import { EADDRESS, EADDRESS_32_BYTES } from './constants';
import type { FlatBalance } from './data';
import { createIntent, estimateCollectionFee } from './rff';
import {
  calculateValue,
  convertTo32Bytes,
  convertToEVMAddress,
  getTokenInfo,
  type PublicClientList,
  sortSourcesByPriority,
} from './utils';

const logger = getLogger();

export const requiresSafeAccount = (chain: Chain | undefined): boolean =>
  !!chain && chain.swapSupported && !chain.pectraUpgradeSupport;

export const resolveSourceExecution = async ({
  chain,
  eoaAddress: _eoaAddress,
  ephemeralAddress,
  vscClient,
}: {
  chain: Chain;
  eoaAddress: Hex;
  ephemeralAddress: Hex;
  vscClient: SwapParams['vscClient'];
}): Promise<SourceExecution> => {
  if (!requiresSafeAccount(chain)) {
    return {
      address: ephemeralAddress,
      entryPoint: null,
      mode: '7702',
    };
  }

  const account = await vscClient.vscGetSafeAccountAddress(chain.id, ephemeralAddress);
  return {
    address: account.address,
    entryPoint: null,
    factoryAddress: account.factoryAddress,
    mode: 'safe_account',
  };
};

export const resolveDestinationExecution = async ({
  chain,
  eoaAddress,
  ephemeralAddress,
  needsDestinationExecution,
  vscClient,
}: {
  chain: Chain;
  eoaAddress: Hex;
  ephemeralAddress: Hex;
  needsDestinationExecution: boolean;
  vscClient: SwapParams['vscClient'];
}): Promise<DestinationExecution> => {
  if (!needsDestinationExecution) {
    return {
      address: eoaAddress,
      entryPoint: null,
      mode: 'direct_eoa',
    };
  }

  if (!requiresSafeAccount(chain)) {
    return {
      address: ephemeralAddress,
      entryPoint: null,
      mode: '7702',
    };
  }

  const account = await vscClient.vscGetSafeAccountAddress(chain.id, ephemeralAddress);
  return {
    address: account.address,
    entryPoint: null,
    factoryAddress: account.factoryAddress,
    mode: 'safe_account',
  };
};

type AggregatorInput = ReturnType<typeof toAggregatorInputs>[number];
// Per-holding shape carrying both the swap *taker* (on-chain executor — Calibur ephemeral on
// 7702 chains, Safe contract on non-Pectra chains) and the *receiver* (output recipient). For
// source-side swaps the two are always equal — output stays at the wrapper for the bridge step
// to consume — but they're stored as distinct fields so every call site has to acknowledge
// each role explicitly. Names mirror the ca-common wrapper vocabulary
// (`HoldingWithSwapAddresses`).
type AggregatorInputWithSwapAddresses = AggregatorInput & {
  takerAddress: Bytes;
  receiverAddress: Bytes;
};
type SourceExecutionRecord = Record<number, SourceExecution>;

const resolveSourceExecutions = async ({
  eoaAddress,
  ephemeralAddress,
  sourceBalances,
  params,
}: {
  eoaAddress: Hex;
  ephemeralAddress: Hex;
  sourceBalances: FlatBalance[];
  params: SwapParams & { publicClientList: PublicClientList };
}): Promise<SourceExecutionRecord> => {
  const uniqueSourceChains = uniqBy(sourceBalances, (balance) => balance.chainID);
  const entries = await Promise.all(
    uniqueSourceChains.map(async (balance) => {
      const chain = params.chainList.getChainByID(balance.chainID);
      if (!chain) {
        throw Errors.chainNotFound(balance.chainID);
      }

      const execution = await resolveSourceExecution({
        chain,
        eoaAddress,
        ephemeralAddress,
        vscClient: params.vscClient,
      });
      return [balance.chainID, execution] as const;
    })
  );

  return Object.fromEntries(entries) as SourceExecutionRecord;
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
): Promise<SwapRoute> => {
  logger.debug('determineSwapRoute', {
    input,
    options,
  });
  console.time('swap-route-time');
  const response = await (input.mode === SwapMode.EXACT_OUT
    ? _exactOutRoute(input.data, options)
    : _exactInRoute(input.data, options));
  console.timeEnd('swap-route-time');

  return response;
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
  DESTINATION_SWAP_MAX_IN_USD = 2, // <-- magic number ???
  SOURCE_SWAP_BUFFER_PCT = 2,
  SOURCE_SWAP_MAX_IN_USD = 1, // <-- another magic
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

/** Fetches fee store, balances, oracle prices, and destination token info in parallel. */
const fetchRouteData = async (
  params: SwapParams & { publicClientList: PublicClientList },
  opts: {
    toChainId: number;
    toTokenAddress: Hex;
    dstChain: ReturnType<SwapParams['chainList']['getChainByID']> & {};
    allowedSources?: Source[];
    removeSources?: Source[];
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
          filterWithSupportedTokens: false,
          allowedSources: opts.allowedSources,
          removeSources: opts.removeSources,
          oraclePrices: oraclePricesPromise,
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
 * autoSelectSources results. Skips dst-chain entries from bridgeAssets and
 * tracks dst COT for bridge amount deduction.
 */
const buildExactOutSourceAssets = (
  usedCOTs: Awaited<ReturnType<typeof autoSelectSources>>['usedCOTs'],
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
): Promise<SwapRoute> => {
  const dstChain = params.chainList.getChainByID(input.toChainId);
  if (!dstChain) {
    throw Errors.chainNotFound(input.toChainId);
  }

  // toAmount / toNativeAmount sentinel semantics (same shape for both):
  //   > 0n   : shortfall — bridge this amount. Remove from dst-chain sources entirely.
  //   < -1n  : surplus — reserve abs(value) from dst balance, use the rest as a swap source.
  //   === -1n: exactly enough — remove from dst-chain sources entirely.
  const removeSources: Source[] = [];
  if (input.toAmount === -1n || input.toAmount > 0n) {
    removeSources.push({
      chainId: input.toChainId,
      tokenAddress: input.toTokenAddress,
    });
  }
  const reserveTokenAmount = input.toAmount < -1n ? -input.toAmount : undefined;
  const reserveNativeAmount =
    input.toNativeAmount && input.toNativeAmount < -1n ? -input.toNativeAmount : undefined;
  if (input.toNativeAmount === -1n || (input.toNativeAmount && input.toNativeAmount > 0n)) {
    removeSources.push({
      chainId: input.toChainId,
      tokenAddress: ZERO_ADDRESS,
    });
  }

  const {
    feeStore,
    balances: rawBalances,
    oraclePrices,
    dstTokenInfo,
  } = await fetchRouteData(params, {
    toChainId: input.toChainId,
    toTokenAddress: input.toTokenAddress,
    dstChain,
    allowedSources: input.fromSources,
    removeSources,
  });

  // When using preloaded balances, apply the allowedSources/removeSources filters inline.
  let balances = rawBalances;
  if (params.preloadedBalances) {
    if (input.fromSources?.length) {
      balances = filterAllowedSources(balances, input.fromSources);
    }
    balances = filterRemoveSources(balances, removeSources);
  }

  // Surplus case: reserve the required amount from dst-chain balance so only the
  // surplus is available as a swap source.
  if (reserveTokenAmount) {
    balances = deductReservedBalance(
      balances,
      input.toChainId,
      normalizeToComparisonAddr(input.toTokenAddress),
      reserveTokenAmount,
      dstTokenInfo.decimals
    );
  }
  if (reserveNativeAmount) {
    balances = deductReservedBalance(
      balances,
      input.toChainId,
      normalizeToComparisonAddr(ZERO_ADDRESS),
      reserveNativeAmount,
      dstChain.nativeCurrency.decimals
    );
  }

  const dstOmniversalChainID = new OmniversalChainID(Universe.ETHEREUM, input.toChainId);

  logger.debug('exact-out: fetched balances', { balances, input });

  const { cot: dstChainCOT, address: dstChainCOTAddress } = getCOTForChainId(
    input.toChainId,
    params.cotCurrencyID
  );

  let gasInCOT = new Decimal(0);
  if (input.toNativeAmount && input.toNativeAmount > 0n) {
    // Convert to COT
    gasInCOT = convertGasToToken(
      {
        contractAddress: dstChainCOTAddress,
        decimals: dstChainCOT.decimals,
      },
      oraclePrices,
      dstChain.id,
      dstChain.universe,
      divDecimals(input.toNativeAmount, dstChain.nativeCurrency.decimals)
    ).mul(1.02);
  }

  let buffer = new Decimal(0);

  const needsTokenSwap =
    input.toAmount > 0n && !equalFold(input.toTokenAddress, dstChainCOTAddress);
  const needsGasSwap = !gasInCOT.isZero();
  const destinationExecution = await resolveDestinationExecution({
    chain: dstChain,
    eoaAddress: params.address.eoa,
    ephemeralAddress: params.address.ephemeral,
    needsDestinationExecution: needsTokenSwap || needsGasSwap,
    vscClient: params.vscClient,
  });
  // Aggregator simulation context (taker_address / fromAddress) must be the wrapper — that's
  // the on-chain executor at runtime, so the aggregator's permit/approval routing has to match.
  // Output recipient is the user's EOA so we never need to sweep token or native dust out of
  // the wrapper post-swap. Safe doesn't implement ERC-7914, so the previous
  // wrapper-as-recipient + sweep pattern broke `approveNative`. Splitting these two roles
  // (userAddress vs receiverAddress) lets the aggregator simulate as the wrapper but deliver
  // output to the EOA. Applies uniformly to 7702 (Calibur) and `safe_account` modes.
  const dstSwapTakerInBytes = convertTo32Bytes(destinationExecution.address);
  const dstSwapReceiverInBytes = convertTo32Bytes(params.address.eoa);

  // COT required for direct transfer when toToken IS COT and toAmount is a positive
  // shortfall. Zero when a swap resolves it, or under sentinel toAmount (-1n / <-1n).
  const cotTransferAmount =
    input.toAmount > 0n && !needsTokenSwap
      ? divDecimals(input.toAmount, dstChainCOT.decimals)
      : new Decimal(0);

  const destination = createDestination(
    input.toChainId,
    destinationExecution,
    cotTransferAmount.add(gasInCOT)
  );

  let originalMax: Decimal | null = null;
  const getDstSwap = async (): Promise<DestinationSwap> => {
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
              amountRaw: BigInt(input.toAmount),
              tokenAddress: convertTo32Bytes(input.toTokenAddress),
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

    // Apply min(5%, $2) buffer to destination input amount — leftover is returned in COT.
    const { amountWithBuffer, buffer: dstBuffer } = applyBufferWithCap(
      destination.inputAmount.min,
      BUFFER_EXACT_OUT.DESTINATION_SWAP_BUFFER_PCT,
      BUFFER_EXACT_OUT.DESTINATION_SWAP_MAX_IN_USD
    );
    const rounded = amountWithBuffer.toDP(dstChainCOT.decimals, Decimal.ROUND_CEIL);

    if (originalMax === null) {
      originalMax = rounded;
    } else if (rounded.gt(originalMax)) {
      throw Errors.ratesChangedBeyondTolerance(
        Number(rounded.toFixed()),
        `max budget: ${originalMax.toFixed()}`
      );
    }

    destination.inputAmount.max = rounded;
    buffer = buffer.add(dstBuffer);

    return { creationTime: Date.now(), tokenSwap, gasSwap };
  };

  destination.swap = await getDstSwap();
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
      destinationChainID: Number(input.toChainId),
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

  const sortedBalances = sortSourcesByPriority(balances, {
    tokenAddress: input.toTokenAddress,
    symbol: dstTokenInfo.symbol,
    chainID: dstChain.id,
  });
  const sourceExecutions = await resolveSourceExecutions({
    eoaAddress: params.address.eoa,
    ephemeralAddress: params.address.ephemeral,
    sourceBalances: sortedBalances,
    params,
  });

  const { quoteResponses: sourceSwapQuotes, usedCOTs } = await autoSelectSources({
    holdings: toAggregatorInputsWithSwapAddresses(sortedBalances, sourceExecutions),
    outputRequired: sourceSwapOutputRequired,
    aggregators: params.aggregators,
    commonCurrencyID: params.cotCurrencyID,
  }).catch((e) => {
    if (e instanceof Error && e.message === 'NOT_ENOUGH_SWAP_FOR_REQUIREMENT') {
      throw Errors.quoteError();
    }
    throw e;
  });

  logger.debug('sourceSwap', {
    sourceSwapQuotes,
  });

  const sourceSwapCreationTime = Date.now();

  const { assetsUsed, bridgeAssets, dstTotalCOTAmount, dstEOAToEphTx } = buildExactOutSourceAssets(
    usedCOTs,
    sourceSwapQuotes,
    input.toChainId,
    dstChainCOT.decimals
  );

  destination.eoaToDestinationAccount = dstEOAToEphTx;

  if (
    !needsTokenSwap &&
    !needsGasSwap &&
    hasDestinationChainSourceSwapOutput(
      sourceSwapQuotes,
      sourceExecutions,
      input.toChainId,
      params.address.eoa
    )
  ) {
    destination.execution = await resolveDestinationExecution({
      chain: dstChain,
      eoaAddress: params.address.eoa,
      ephemeralAddress: params.address.ephemeral,
      needsDestinationExecution: true,
      vscClient: params.vscClient,
    });
  }

  const isBridgeRequired = !(
    sourceSwapQuotes.every((q) => q.chainID === input.toChainId) &&
    usedCOTs.every((q) => Number(q.originalHolding.chainID.chainID) === input.toChainId)
  );

  let bridgeInput: BridgeInput = null;
  if (isBridgeRequired) {
    // Deduct dst-chain COT (already on destination, doesn't need bridging)
    const bridgeAmount = bridgeOutput.minus(dstTotalCOTAmount);
    const pendingBridge: PendingBridgeInput = {
      amount: bridgeAmount,
      assets: bridgeAssets,
      chainID: input.toChainId,
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

  logger.debug('exact-out: bridge', { bridgeAssets, bridgeInput, assetsUsed, dstEOAToEphTx });

  return buildSwapRouteResult({
    type: 'EXACT_OUT',
    source: {
      swaps: sourceSwapQuotes,
      creationTime: sourceSwapCreationTime,
      executions: sourceExecutions,
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
    getDstSwap: () => Promise<DestinationSwap | null>;
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

const _exactInRoute = async (
  input: ExactInSwapInput,
  params: SwapParams & {
    aggregators: Aggregator[];
    publicClientList: PublicClientList;
    cotCurrencyID: CurrencyID;
  }
): Promise<SwapRoute> => {
  logger.debug('exactInRoute', {
    input,
    params,
  });

  const dstChain = params.chainList.getChainByID(input.toChainId);
  if (!dstChain) {
    throw Errors.chainNotFound(input.toChainId);
  }

  const { feeStore, balances, oraclePrices, dstTokenInfo } = await fetchRouteData(params, {
    toChainId: input.toChainId,
    toTokenAddress: input.toTokenAddress,
    dstChain,
  });

  if (balances.length === 0) {
    throw Errors.noBalanceForAddress(params.address.eoa);
  }

  logger.debug('exact-in: fetched balances', { balances });

  const { srcBalances, assetsUsed } = resolveSourceBalances(input.from, balances);

  const { cot: dstChainCOT, address: dstChainCOTAddress } = getCOTForChainId(
    input.toChainId,
    params.cotCurrencyID
  );

  const dstOmniversalChainID = new OmniversalChainID(Universe.ETHEREUM, input.toChainId);
  const sourceExecutions = await resolveSourceExecutions({
    eoaAddress: params.address.eoa,
    ephemeralAddress: params.address.ephemeral,
    sourceBalances: srcBalances,
    params,
  });

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
  const isBridgeRequired = !srcBalances.every((b) => b.chainID === input.toChainId);

  logger.debug('exact-in: swap flags', {
    isSrcSwapRequired,
    isBridgeRequired,
  });

  let sourceSwaps: QuoteResponse[] = [];
  if (isSrcSwapRequired) {
    const response = await liquidateSourceHoldings({
      holdings: toAggregatorInputsWithSwapAddresses(srcBalances, sourceExecutions),
      aggregators: params.aggregators,
      commonCurrencyID: params.cotCurrencyID,
    });

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
    const { fee: maxFee } = await calculateMaxBridgeFee({
      assets: toBridgeAssetInputs(bridgeAssets),
      dst: {
        chainId: input.toChainId,
        tokenAddress: dstChainCOTAddress,
        decimals: dstChainCOT.decimals,
      },
      feeStore,
      chainList: params.chainList,
    });

    dstSwapInputAmountInDecimal = dstSwapInputAmountInDecimal.minus(maxFee);
    logger.debug('exact-in: after bridge fee deduction', {
      dstSwapInputAmountInDecimal: dstSwapInputAmountInDecimal.toFixed(),
      maxFee: maxFee.toFixed(),
    });
    if (dstSwapInputAmountInDecimal.isNegative()) {
      throw Errors.internal('bridge fees exceeds source amount');
    }

    bridgeInput = {
      amount: dstSwapInputAmountInDecimal,
      assets: bridgeAssets,
      chainID: input.toChainId,
      decimals: dstChainCOT.decimals,
      recipientAddress: params.address.ephemeral,
      tokenAddress: convertToEVMAddress(dstChainCOT.tokenAddress),
      estimatedFees: createIntent({
        dstChain,
        assets: bridgeAssets,
        feeStore,
        output: {
          chainID: input.toChainId,
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

  const needsDstSwap = !equalFold(input.toTokenAddress, dstChainCOTAddress);
  const hasDestinationChainSourceOutput = hasDestinationChainSourceSwapOutput(
    sourceSwaps,
    sourceExecutions,
    input.toChainId,
    params.address.eoa
  );
  const destinationExecution = await resolveDestinationExecution({
    chain: dstChain,
    eoaAddress: params.address.eoa,
    ephemeralAddress: params.address.ephemeral,
    needsDestinationExecution: needsDstSwap || hasDestinationChainSourceOutput,
    vscClient: params.vscClient,
  });

  // If the source swap(s) and the destination swap collapse to one same-wrapper batch (no
  // bridge in between), the dst aggregator will pull COT from the same wrapper the source
  // swap just deposited it into. Apply headroom on the dst input so per-leg slippage
  // between the two aggregator quotes can't strand the dst transferFrom on an under-supplied
  // wrapper. Leftover COT is swept back to the EOA by the existing dst sweeper.
  const willBeCombined =
    !isBridgeRequired &&
    sourceSwaps.length > 0 &&
    sourceSwaps.every((s) => Number(s.chainID) === input.toChainId) &&
    !!sourceExecutions[input.toChainId] &&
    equalFold(sourceExecutions[input.toChainId].address, destinationExecution.address);
  if (willBeCombined && needsDstSwap) {
    dstSwapInputAmountInDecimal = dstSwapInputAmountInDecimal.mul(
      1 - COMBINED_SAME_CHAIN_BUFFER_PCT / 100
    );
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
    input.toChainId,
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

  const getDstSwap = async () => {
    let tokenSwap = null;
    if (needsDstSwap) {
      tokenSwap = await getDestinationExactInSwap({
        takerAddress: dstSwapTakerInBytes,
        receiverAddress: dstSwapReceiverInBytes,
        chain: dstOmniversalChainID,
        inputAmount: mulDecimals(dstSwapInputAmountInDecimal, dstChainCOT.decimals),
        outputToken: convertTo32Bytes(input.toTokenAddress),
        aggregators: params.aggregators,
        inputCurrency: dstChainCOT.currencyID,
      });

      // Rate guard on requote: check output didn't drop beyond 0.5% tolerance
      if (destination.swap.tokenSwap) {
        const prevAmountRaw = destination.swap.tokenSwap.quote.output.amountRaw;
        const newAmountRaw = tokenSwap.quote.output.amountRaw;
        if (newAmountRaw < (prevAmountRaw * 995n) / 1000n) {
          throw Errors.ratesChangedBeyondTolerance(newAmountRaw, '0.5%');
        }
      }
    }

    return { gasSwap: null, tokenSwap, creationTime: Date.now() };
  };

  destination.swap = await getDstSwap();
  destination.getDstSwap = getDstSwap;

  return buildSwapRouteResult({
    type: 'EXACT_IN',
    source: {
      swaps: sourceSwaps,
      creationTime: sourceSwapCreationTime,
      executions: sourceExecutions,
    },
    bridge: bridgeInput,
    destination,
    dstTokenInfo,
    aggregators: params.aggregators,
    oraclePrices,
    balances,
    assetsUsed,
    buffer: '0',
  });
};
