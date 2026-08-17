import type { Hex, PublicClient, WalletClient } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import type { ChainListType, TimingSpanHooks } from '../domain';
import { getLogger } from '../domain';
import { isNativeAddress } from '../services/addresses';
import { mulDecimals } from '../services/math';
import { parseQuote } from '../services/quote-parser';
import { requireSafeDeployment } from '../services/safe';
import { withTimingSpan } from '../services/timing';
import type { QuoteResponse } from './aggregators/types';
import type {
  ExecutionContext,
  PreparedEoaToEphemeralTransfer,
  PreparedSwapExecution,
  PublicClientList,
  SwapRoute,
} from './types';
import { isDirectBridgeRoute } from './types';
import { SwapCache } from './wallet/cache';
import { buildPreparedTransfer } from './wallet/prepared-transfer';

const logger = getLogger();

type PrepareSwapExecutionInput = {
  chainList: ChainListType;
  route: SwapRoute;
  source: SwapRoute['source'];
  destination: SwapRoute['destination'];
  eoaAddress: Hex;
  eoaWallet: WalletClient;
  ephemeralWallet: PrivateKeyAccount;
  publicClientList: PublicClientList;
  cacheWarmup: SwapCacheWarmup;
  safeDeploymentPromises: NonNullable<ExecutionContext['safeDeploymentPromises']>;
  timing?: TimingSpanHooks;
};

type SwapCacheInput = Pick<
  PrepareSwapExecutionInput,
  | 'chainList'
  | 'route'
  | 'source'
  | 'destination'
  | 'eoaAddress'
  | 'ephemeralWallet'
  | 'publicClientList'
  | 'timing'
>;

type SwapCacheWarmupInput = SwapCacheInput & {
  safeAccount: { address: Hex; factoryAddress: Hex };
};

export type SwapCacheWarmup = {
  cache: SwapCache;
  key: string;
  process: Promise<void>;
  chainIds: readonly number[];
  safeChainIds: readonly number[];
  safeAddress: Hex;
};

type DeterministicTransferSpec = {
  reason: PreparedEoaToEphemeralTransfer['reason'];
  chainId: number;
  tokenAddress: Hex;
  tokenDecimals?: number;
  amount: bigint;
  eagerPermit: boolean;
  targetAddress: Hex;
  recipientAddress?: Hex;
};

const getPublicClientMap = (
  chainIds: Set<number>,
  publicClientList: PublicClientList
): Record<number, Pick<PublicClient, 'multicall' | 'getCode' | 'readContract'>> => {
  return Object.fromEntries(
    [...chainIds].map((chainId) => [chainId, publicClientList.get(chainId)])
  );
};

const queueParsedQuoteQueries = (
  cache: SwapCache,
  quotes: QuoteResponse[],
  owner: Hex,
  requiredChainIds: Set<number>
) => {
  for (const quote of quotes) {
    requiredChainIds.add(quote.chainID);
    const isNativeInput = isNativeAddress(quote.quote.input.contractAddress);

    if (!isNativeInput) {
      cache.addAllowanceQuery(
        quote.quote.input.contractAddress,
        owner,
        quote.quote.txData.approvalAddress,
        quote.chainID
      );
    }
  }
};

const queueDeterministicTransferQueries = (
  cache: SwapCache,
  transfers: Array<{ chainId: number; tokenAddress: Hex; spender: Hex }>,
  eoaAddress: Hex,
  requiredChainIds: Set<number>
) => {
  for (const transfer of transfers) {
    requiredChainIds.add(transfer.chainId);
    if (isNativeAddress(transfer.tokenAddress)) {
      continue;
    }
    cache.addPermitQuery(transfer.tokenAddress, transfer.chainId);
    cache.addAllowanceQuery(transfer.tokenAddress, eoaAddress, transfer.spender, transfer.chainId);
  }
};

const getPreparationDetails = (
  input: Pick<
    PrepareSwapExecutionInput,
    'route' | 'source' | 'destination' | 'eoaAddress' | 'ephemeralWallet'
  > & { safeAddress: Hex }
) => {
  const directDestinationExtras =
    input.route.directDestination === true ? input.route.extras.directDestination : undefined;
  const directDestinationExactOut = directDestinationExtras !== undefined;
  const { safeAddress } = input;
  // The Safe owns swap inputs and pulls bridge funding from the EOA directly to the ephemeral
  // bridge holder, so every funding allowance names the Safe as spender.
  const destinationQuotes = [
    input.destination.swap.tokenSwap,
    input.destination.swap.gasSwap,
  ].filter((quote): quote is QuoteResponse => quote !== null);
  const sourceTransferSpecs: DeterministicTransferSpec[] = directDestinationExactOut
    ? []
    : input.source.swaps.flatMap((swap) => {
        if (isNativeAddress(swap.quote.input.contractAddress)) {
          return [];
        }
        return [
          {
            reason: 'source',
            chainId: swap.chainID,
            tokenAddress: swap.quote.input.contractAddress,
            tokenDecimals: swap.quote.input.decimals,
            amount: swap.quote.input.amountRaw,
            eagerPermit: false,
            targetAddress: safeAddress,
          },
        ];
      });
  const destinationTransferSpecs: DeterministicTransferSpec[] = input.destination.eoaToEphemeral
    ? [
        {
          reason: 'destination',
          chainId: input.destination.chainId,
          tokenAddress: input.destination.eoaToEphemeral.contractAddress,
          amount: input.destination.eoaToEphemeral.amount,
          eagerPermit: true,
          targetAddress: safeAddress,
        },
      ]
    : [];
  const bridgeTransferSpecs: DeterministicTransferSpec[] = isDirectBridgeRoute(input.route)
    ? []
    : (input.route.bridge?.assets.flatMap((asset) => {
        if (asset.eoaBalance.isZero() || isNativeAddress(asset.contractAddress)) return [];
        return [
          {
            reason: 'bridge',
            chainId: asset.chainID,
            tokenAddress: asset.contractAddress,
            tokenDecimals: asset.decimals,
            amount: mulDecimals(asset.eoaBalance, asset.decimals),
            eagerPermit: false,
            targetAddress: safeAddress,
            recipientAddress: input.ephemeralWallet.address,
          },
        ];
      }) ?? []);

  return {
    directDestinationExtras,
    directDestinationExactOut,
    destinationQuotes,
    deterministicTransferSpecs: [
      ...sourceTransferSpecs,
      ...destinationTransferSpecs,
      ...bridgeTransferSpecs,
    ],
    safeAddress,
  };
};

const queueSwapCacheQueries = (
  input: SwapCacheInput & { cache: SwapCache },
  details: ReturnType<typeof getPreparationDetails>
): Set<number> => {
  const requiredChainIds = new Set<number>();

  for (const chainId of getSafeExecutionChainIds(input.route)) {
    requiredChainIds.add(chainId);
    input.cache.addSafeAccountQuery(chainId);
  }

  queueParsedQuoteQueries(input.cache, input.source.swaps, details.safeAddress, requiredChainIds);
  queueParsedQuoteQueries(
    input.cache,
    details.destinationQuotes,
    details.safeAddress,
    requiredChainIds
  );
  queueDeterministicTransferQueries(
    input.cache,
    details.directDestinationExtras
      ? details.directDestinationExtras.dstHoldings
          .filter((holding) => !isNativeAddress(holding.tokenAddress))
          .map((holding) => ({
            chainId: holding.chainID,
            tokenAddress: holding.tokenAddress,
            spender: details.safeAddress,
          }))
      : details.deterministicTransferSpecs.map((transfer) => ({
          chainId: transfer.chainId,
          tokenAddress: transfer.tokenAddress,
          spender: transfer.targetAddress,
        })),
    input.eoaAddress,
    requiredChainIds
  );

  if (details.directDestinationExactOut && details.deterministicTransferSpecs.length > 0) {
    queueDeterministicTransferQueries(
      input.cache,
      details.deterministicTransferSpecs.map((transfer) => ({
        chainId: transfer.chainId,
        tokenAddress: transfer.tokenAddress,
        spender: transfer.targetAddress,
      })),
      input.eoaAddress,
      requiredChainIds
    );
  }

  return requiredChainIds;
};

const getSafeExecutionChainIds = (route: SwapRoute): number[] => {
  const directBridge = isDirectBridgeRoute(route);
  const chainIds = new Set(directBridge ? [] : route.sourceExecutionPaths.keys());
  if (!directBridge) {
    for (const asset of route.bridge?.assets ?? []) {
      chainIds.add(asset.chainID);
    }
  }
  if (route.destination.swap.tokenSwap || route.destination.swap.gasSwap) {
    chainIds.add(route.destination.chainId);
  }
  return [...chainIds];
};

const startSwapCacheProcess = (
  input: SwapCacheInput & { cache: SwapCache },
  requiredChainIds: Set<number>
): Promise<void> =>
  withTimingSpan(
    input.timing,
    'flow.swap.prepare.cache_start',
    async () => input.cache.process(getPublicClientMap(requiredChainIds, input.publicClientList)),
    { tags: { chain_count: requiredChainIds.size } }
  );

export const startSwapCacheWarmup = (
  input: SwapCacheWarmupInput,
  previous?: SwapCacheWarmup
): SwapCacheWarmup => {
  const cache = new SwapCache(input.chainList, input.safeAccount);
  const safeChainIds = getSafeExecutionChainIds(input.route);
  for (const chainId of safeChainIds) {
    if (previous?.cache.getSafeAccount(chainId)?.deployed) {
      cache.setSafeDeployed(chainId, true);
    }
  }
  const details = getPreparationDetails({ ...input, safeAddress: input.safeAccount.address });
  const requiredChainIds = queueSwapCacheQueries({ ...input, cache }, details);
  const key = cache.getPendingQueryKey();

  if (previous?.key === key) {
    return previous;
  }
  const process = startSwapCacheProcess({ ...input, cache }, requiredChainIds);
  // The user may deny or refresh while this runs. Observe early rejection now; awaiting the
  // original promise after acceptance still preserves its failure.
  void process.catch(() => undefined);

  return {
    cache,
    key,
    process,
    chainIds: [...requiredChainIds],
    safeChainIds,
    safeAddress: input.safeAccount.address,
  };
};

const getDestinationFundingTokenDecimals = (
  input: PrepareSwapExecutionInput,
  destinationQuotes: QuoteResponse[],
  eoaToEphemeralContractAddress: Hex
) =>
  destinationQuotes[0]?.quote.input.decimals ??
  input.chainList.getTokenByAddress(input.destination.chainId, eoaToEphemeralContractAddress)
    .decimals;

export const prepareSwapExecution = async (
  input: PrepareSwapExecutionInput
): Promise<PreparedSwapExecution> => {
  logger.debug('swap.prepare.execution.started', {
    sourceSwaps: input.source.swaps.length,
    hasBridge: input.route.bridge !== null,
    destinationChainId: input.destination.chainId,
  });

  const { cache, process, chainIds, safeAddress } = input.cacheWarmup;
  const details = getPreparationDetails({ ...input, safeAddress });
  const { destinationQuotes, deterministicTransferSpecs } = details;

  await withTimingSpan(input.timing, 'flow.swap.prepare.cache_wait', async () => process, {
    tags: { chain_count: chainIds.length, pending_at_first_use: true },
  });

  const parsedQuotes = await withTimingSpan(
    input.timing,
    'flow.swap.prepare.parse_quotes',
    async () => [
      ...input.source.swaps.map((quoteResponse) => ({
        ...parseQuote(quoteResponse.quote),
        chainId: quoteResponse.chainID,
        quote: quoteResponse.quote,
      })),
      ...destinationQuotes.map((quoteResponse) => ({
        ...parseQuote(quoteResponse.quote),
        chainId: quoteResponse.chainID,
        quote: quoteResponse.quote,
      })),
    ],
    { tags: { quote_count: input.source.swaps.length + destinationQuotes.length } }
  );

  const eoaToEphemeralTransfers = await withTimingSpan(
    input.timing,
    'flow.swap.prepare.build_transfers',
    async () => {
      const transfers: PreparedEoaToEphemeralTransfer[] = [];
      for (const transfer of deterministicTransferSpecs) {
        if (transfer.eagerPermit) {
          await requireSafeDeployment(input.safeDeploymentPromises, transfer.chainId);
        }
        const tokenDecimals =
          transfer.tokenDecimals ??
          getDestinationFundingTokenDecimals(input, destinationQuotes, transfer.tokenAddress);
        transfers.push(
          await buildPreparedTransfer({ ...transfer, tokenDecimals, ...input, cache })
        );
      }

      return transfers;
    },
    { tags: { source_leg_count: input.source.swaps.length } }
  );

  logger.debug('swap.prepare.execution.completed', {
    parsedQuotes: parsedQuotes.length,
    transfers: eoaToEphemeralTransfers.length,
    queriedChains: chainIds,
  });

  return {
    parsedQuotes,
    eoaToEphemeralTransfers,
  };
};
