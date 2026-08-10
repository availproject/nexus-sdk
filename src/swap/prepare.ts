import type { Hex, PublicClient, WalletClient } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import type { ChainListType, TimingSpanHooks } from '../domain';
import { getLogger } from '../domain';
import { isNativeAddress } from '../services/addresses';
import { mulDecimals } from '../services/math';
import { parseQuote } from '../services/quote-parser';
import { withTimingSpan } from '../services/timing';
import type { QuoteResponse } from './aggregators/types';
import { predictSafeAccountAddressV2 } from './safe/predict';
import type {
  ExecutionContext,
  PreparedEoaToEphemeralTransfer,
  PreparedSwapExecution,
  PublicClientList,
  SwapRoute,
} from './types';
import type { SwapCache } from './wallet/cache';
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
  cache: SwapCache;
  safeDeploymentPromises?: ExecutionContext['safeDeploymentPromises'];
  timing?: TimingSpanHooks;
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
  ownerForChain: (chainId: number) => Hex,
  requiredChainIds: Set<number>
) => {
  for (const quote of quotes) {
    requiredChainIds.add(quote.chainID);
    const isNativeInput = isNativeAddress(quote.quote.input.contractAddress);

    if (!isNativeInput) {
      cache.addAllowanceQuery(
        quote.quote.input.contractAddress,
        ownerForChain(quote.chainID),
        quote.quote.txData.approvalAddress,
        quote.chainID
      );
    }
  }
};

const queueDeterministicTransferQueries = (
  cache: SwapCache,
  transfers: Array<{ chainId: number; tokenAddress: Hex; amount: bigint; spender: Hex }>,
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

  const requiredChainIds = new Set<number>();
  const directDestinationExtras =
    input.route.directDestination === true ? input.route.extras.directDestination : undefined;
  const directDestinationExactOut = directDestinationExtras !== undefined;
  const safeAddress = predictSafeAccountAddressV2(
    input.eoaAddress,
    input.ephemeralWallet.address
  ).address;
  const ownerForSourceChain = (_chainId: number) => safeAddress;
  // Destination quote owner / funding target is the Safe. The bridge funding spender is also the
  // Safe, while the recipient remains the ephemeral bridge holder; the Safe calls
  // transferFrom(EOA, ephemeral, amount) without taking intermediate custody.
  const destinationOwner = safeAddress;
  const ownerForBridgeChain = (_chainId: number) => safeAddress;

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
            targetAddress: ownerForSourceChain(swap.chainID),
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
          targetAddress: destinationOwner,
        },
      ]
    : [];
  const bridgeTransferSpecs: DeterministicTransferSpec[] =
    input.route.bridge?.assets.flatMap((asset) => {
      if (asset.eoaBalance.isZero() || isNativeAddress(asset.contractAddress)) return [];
      return [
        {
          reason: 'bridge',
          chainId: asset.chainID,
          tokenAddress: asset.contractAddress,
          tokenDecimals: asset.decimals,
          amount: mulDecimals(asset.eoaBalance, asset.decimals),
          eagerPermit: false,
          targetAddress: ownerForBridgeChain(asset.chainID),
          recipientAddress: input.ephemeralWallet.address,
        },
      ];
    }) ?? [];
  const deterministicTransferSpecs = [
    ...sourceTransferSpecs,
    ...destinationTransferSpecs,
    ...bridgeTransferSpecs,
  ];
  await withTimingSpan(
    input.timing,
    'flow.swap.prepare.queue_cache',
    async () => {
      queueParsedQuoteQueries(
        input.cache,
        input.source.swaps,
        ownerForSourceChain,
        requiredChainIds
      );
      queueParsedQuoteQueries(
        input.cache,
        destinationQuotes,
        () => destinationOwner,
        requiredChainIds
      );

      queueDeterministicTransferQueries(
        input.cache,
        directDestinationExtras
          ? directDestinationExtras.dstHoldings
              .filter((holding) => !isNativeAddress(holding.tokenAddress))
              .map((holding) => ({
                chainId: holding.chainID,
                tokenAddress: holding.tokenAddress,
                amount: holding.amountRaw,
                spender: ownerForSourceChain(holding.chainID),
              }))
          : deterministicTransferSpecs.map((transfer) => ({
              chainId: transfer.chainId,
              tokenAddress: transfer.tokenAddress,
              amount: transfer.amount,
              spender: transfer.targetAddress,
            })),
        input.eoaAddress,
        requiredChainIds
      );

      // Direct-destination Exact Out authorizations are prepared by its dedicated executor, but a
      // defensive route carrying later-stage transfers still needs those cache queries here.
      if (directDestinationExactOut && deterministicTransferSpecs.length > 0) {
        queueDeterministicTransferQueries(
          input.cache,
          deterministicTransferSpecs.map((transfer) => ({
            chainId: transfer.chainId,
            tokenAddress: transfer.tokenAddress,
            amount: transfer.amount,
            spender: transfer.targetAddress,
          })),
          input.eoaAddress,
          requiredChainIds
        );
      }
    },
    {
      tags: {
        source_leg_count: input.source.swaps.length,
        destination_leg_count: destinationQuotes.length,
      },
    }
  );

  const cacheProcess = withTimingSpan(
    input.timing,
    'flow.swap.prepare.cache_start',
    async () => input.cache.process(getPublicClientMap(requiredChainIds, input.publicClientList)),
    { tags: { chain_count: requiredChainIds.size } }
  );
  await withTimingSpan(input.timing, 'flow.swap.prepare.cache_wait', async () => cacheProcess, {
    tags: { chain_count: requiredChainIds.size, pending_at_first_use: true },
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
          await input.safeDeploymentPromises?.get(transfer.chainId);
        }
        const tokenDecimals =
          transfer.tokenDecimals ??
          getDestinationFundingTokenDecimals(input, destinationQuotes, transfer.tokenAddress);
        transfers.push(await buildPreparedTransfer({ ...transfer, tokenDecimals, ...input }));
      }

      return transfers;
    },
    { tags: { source_leg_count: input.source.swaps.length } }
  );

  logger.debug('swap.prepare.execution.completed', {
    parsedQuotes: parsedQuotes.length,
    transfers: eoaToEphemeralTransfers.length,
    queriedChains: [...requiredChainIds],
  });

  return {
    parsedQuotes,
    eoaToEphemeralTransfers,
  };
};
