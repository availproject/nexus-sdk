import Decimal from 'decimal.js';
import { maxUint256, type Hex } from 'viem';
import { getLogger } from '../../domain';
import { ZERO_ADDRESS } from '../../domain/constants/addresses';
import {
  ERROR_CODES,
  Errors,
  ExternalServiceError,
  formatUnknownError,
  NexusError,
} from '../../domain/errors';
import { PermitVariant } from '../../domain/permits';
import { isNativeAddress } from '../../services/addresses';
import { createExplorerTxURL } from '../../services/explorer';
import { isUserRejectedRequest } from '../../services/is-user-rejected-request';
import { mulDecimals } from '../../services/math';
import type { SBCCall } from '../../services/sbc';
import { createSourceSwapStepId } from '../../services/step-ids';
import { equalFold } from '../../services/strings';
import { withTimingSpan } from '../../services/timing';
import {
  makeConvergenceExtraRaw,
  sizeDirectDestinationExactOut,
} from '../algorithms/direct-destination-size';
import { aggregatorService } from '../aggregators';
import type { QuoteResponse } from '../aggregators/types';
import { DIRECT_DST_QUOTE_TTL_MS, SRC_BUFFER_MAX_USD, SRC_BUFFER_PCT } from '../constants';
import { predictSafeAccountAddress } from '../safe/predict';
import type {
  ExecutionContext,
  PreparedAuthorizationCall,
  PreparedEoaToEphemeralTransfer,
  SwapMetadata,
  SwapRoute,
  OraclePriceResponse,
} from '../types';
import { buildPreparedTransfer } from '../wallet/prepared-transfer';
import { resolvePreparedFundingTransferCalls } from './eoa-to-ephemeral';
import { getParsedQuote } from './parsed-quote';
import { dispatchSourceChainBatch, type DispatchedSourceBatch } from './source-swaps';

const logger = getLogger();

const MAX_DISPATCH_ATTEMPTS = 3;

type FundingAuthorization = {
  authorization: PreparedAuthorizationCall | null;
  capacityRaw: bigint;
  approvalMined: boolean;
};

const isNativeInput = (swap: QuoteResponse) => isNativeAddress(swap.quote.input.contractAddress);

const sortSwaps = (swaps: QuoteResponse[]) =>
  [...swaps].sort((left, right) => Number(isNativeInput(right)) - Number(isNativeInput(left)));

const toMetadataSwap = (swap: QuoteResponse) => ({
  inputAmount: swap.quote.input.amountRaw,
  inputContract: swap.quote.input.contractAddress,
  inputDecimals: swap.quote.input.decimals,
  outputAmount: swap.quote.output.amountRaw,
  outputContract: swap.quote.output.contractAddress,
  outputDecimals: swap.quote.output.decimals,
});

const authorizationCapacity = (
  authorization: PreparedAuthorizationCall | null,
  currentAllowance: bigint,
  neededRaw: bigint
): bigint => {
  if (!authorization) return currentAllowance;
  if (
    authorization.kind === 'permit' &&
    (authorization.permit.permitVariant === PermitVariant.DAI ||
      authorization.permit.permitVariant === PermitVariant.Polygon2612)
  ) {
    return maxUint256;
  }
  return neededRaw;
};

const assertSilentGrowthWithinCap = (input: {
  chainId: number;
  swap: QuoteResponse;
  neededRaw: bigint;
  baselineRaw: bigint;
  oraclePrices: OraclePriceResponse;
}) => {
  if (input.neededRaw <= input.baselineRaw) return;
  const pctCapRaw = BigInt(
    new Decimal(input.baselineRaw.toString()).mul(SRC_BUFFER_PCT).toFixed(0, Decimal.ROUND_CEIL)
  );
  const price = input.oraclePrices.find(
    (entry) =>
      entry.chainId === input.chainId &&
      equalFold(
        entry.tokenAddress,
        isNativeAddress(input.swap.quote.input.contractAddress)
          ? ZERO_ADDRESS
          : input.swap.quote.input.contractAddress
      )
  )?.priceUsd;
  const tokenPrice = price?.gt(0) ? price : new Decimal(1);
  const usdCapRaw = mulDecimals(
    new Decimal(SRC_BUFFER_MAX_USD).div(tokenPrice),
    input.swap.quote.input.decimals
  );
  const growthCapRaw = pctCapRaw < usdCapRaw ? pctCapRaw : usdCapRaw;
  if (input.neededRaw <= input.baselineRaw + growthCapRaw) return;

  throw new ExternalServiceError(
    ERROR_CODES.EXTERNAL_RATES_DRIFT_EXCEEDED,
    `Direct-destination silent input growth exceeded its route-time cap for ${input.swap.quote.input.contractAddress}`,
    {
      context: {
        service: aggregatorService(input.swap.aggregator),
        stepId: createSourceSwapStepId(input.chainId),
        stepType: 'source_swap',
        chainId: input.chainId,
      },
      details: {
        baselineRaw: input.baselineRaw.toString(),
        neededRaw: input.neededRaw.toString(),
        growthCapRaw: growthCapRaw.toString(),
      },
    }
  );
};

const buildCalls = async (input: {
  swaps: QuoteResponse[];
  chainId: number;
  targetAddress: Hex;
  ctx: ExecutionContext & { cache: NonNullable<ExecutionContext['cache']> };
  authorizations: Map<string, FundingAuthorization>;
  routeTimeInputs: Map<string, bigint>;
  oraclePrices: OraclePriceResponse;
}): Promise<SBCCall[]> => {
  const { swaps, chainId, targetAddress, ctx, authorizations, routeTimeInputs, oraclePrices } =
    input;
  const orderedSwaps = sortSwaps(swaps);
  const chain = ctx.chainList.getChainByID(chainId);
  const publicClient = ctx.publicClientList.get(chainId);
  const tokenTotals = new Map<
    string,
    { tokenAddress: Hex; tokenDecimals: number; amount: bigint }
  >();

  for (const swap of orderedSwaps) {
    if (isNativeInput(swap)) continue;
    const tokenAddress = swap.quote.input.contractAddress;
    const key = tokenAddress.toLowerCase();
    const existing = tokenTotals.get(key);
    tokenTotals.set(key, {
      tokenAddress,
      tokenDecimals: swap.quote.input.decimals,
      amount: (existing?.amount ?? 0n) + swap.quote.input.amountRaw,
    });
  }

  const calls: SBCCall[] = [];
  const fundedTokens = new Set<string>();
  for (const swap of orderedSwaps) {
    const nativeInput = isNativeInput(swap);
    if (!nativeInput) {
      const tokenKey = swap.quote.input.contractAddress.toLowerCase();
      if (!fundedTokens.has(tokenKey)) {
        const funding = tokenTotals.get(tokenKey);
        if (!funding) throw Errors.internal('Missing direct-destination funding total');
        const cacheKey = `${chainId}:${tokenKey}:${targetAddress.toLowerCase()}`;
        let cached = authorizations.get(cacheKey);
        let transfer: PreparedEoaToEphemeralTransfer;
        let reusedAuthorization = true;

        if (!cached || funding.amount > cached.capacityRaw) {
          reusedAuthorization = false;
          const currentAllowance = ctx.cache.getAllowance(
            funding.tokenAddress,
            ctx.eoaAddress,
            targetAddress,
            chainId
          );
          transfer = await buildPreparedTransfer({
            reason: 'source',
            chainId,
            tokenAddress: funding.tokenAddress,
            tokenDecimals: funding.tokenDecimals,
            amount: funding.amount,
            eagerPermit: false,
            targetAddress,
            chainList: ctx.chainList,
            eoaAddress: ctx.eoaAddress,
            eoaWallet: ctx.eoaWallet,
            publicClientList: ctx.publicClientList,
            cache: ctx.cache,
          });
          cached = {
            authorization: transfer.authorization,
            capacityRaw: authorizationCapacity(
              transfer.authorization,
              currentAllowance,
              funding.amount
            ),
            approvalMined: false,
          };
          authorizations.set(cacheKey, cached);
        } else {
          transfer = await buildPreparedTransfer({
            reason: 'source',
            chainId,
            tokenAddress: funding.tokenAddress,
            tokenDecimals: funding.tokenDecimals,
            amount: funding.amount,
            eagerPermit: false,
            targetAddress,
            chainList: ctx.chainList,
            eoaAddress: ctx.eoaAddress,
            eoaWallet: ctx.eoaWallet,
            publicClientList: ctx.publicClientList,
            cache: ctx.cache,
            authorization:
              cached.authorization?.kind === 'approve' && cached.approvalMined
                ? null
                : cached.authorization,
          });
        }

        if (reusedAuthorization || transfer.authorization === null) {
          assertSilentGrowthWithinCap({
            chainId,
            swap,
            neededRaw: funding.amount,
            baselineRaw: routeTimeInputs.get(tokenKey) ?? 0n,
            oraclePrices,
          });
        }

        calls.push(
          ...(await resolvePreparedFundingTransferCalls({
            transfer,
            tokenDecimals: funding.tokenDecimals,
            chain,
            eoaAddress: ctx.eoaAddress,
            eoaWallet: ctx.eoaWallet,
            publicClient,
          }))
        );
        if (cached.authorization?.kind === 'approve') cached.approvalMined = true;
        fundedTokens.add(tokenKey);
      }
    }

    const parsedQuote = getParsedQuote(swap, ctx.preparedExecution?.parsedQuotes);
    if (parsedQuote.approval && !nativeInput) calls.push(parsedQuote.approval);
    calls.push(parsedQuote.swap);
  }

  return calls;
};

const isDefinitiveFailure = (error: unknown): boolean =>
  error instanceof NexusError &&
  (error.code === ERROR_CODES.EXEC_TX_ONCHAIN_REVERTED ||
    error.code === ERROR_CODES.EXEC_TX_SUBMISSION_REVERTED);

const normalizeDispatchFailure = (
  error: unknown,
  chainId: number,
  dispatched?: DispatchedSourceBatch
): unknown => {
  if (isUserRejectedRequest(error)) return Errors.userRejectedTxSend();
  if (error instanceof NexusError) return error;
  return Errors.execution(`Direct-destination execution failed: ${formatUnknownError(error)}`, {
    service: dispatched ? 'rpc' : 'wallet',
    stepId: createSourceSwapStepId(chainId),
    stepType: 'source_swap',
    chainId,
  });
};

const emitFailed = (
  ctx: ExecutionContext,
  chainId: number,
  error: unknown,
  dispatched?: DispatchedSourceBatch
) => {
  ctx.onProgress?.({
    stepType: 'source_swap',
    chainId,
    state: 'failed',
    error: formatUnknownError(error),
    txHash: dispatched?.submittedTxHash,
    explorerUrl: dispatched?.submittedExplorerUrl,
  });
};

const normalizeRequoteFailure = (
  error: unknown,
  swaps: QuoteResponse[],
  chainId: number
): unknown => {
  if (
    !(error instanceof NexusError) ||
    error.code !== ERROR_CODES.EXTERNAL_DESTINATION_SWAP_QUOTE_FAILED
  ) {
    return error;
  }
  const firstSwap = swaps[0];
  if (!firstSwap) return error;
  return new ExternalServiceError(
    ERROR_CODES.EXTERNAL_RATES_DRIFT_EXCEEDED,
    `Direct-destination requote no longer covers the exact output: ${formatUnknownError(error)}`,
    {
      context: {
        service: aggregatorService(firstSwap.aggregator),
        stepId: createSourceSwapStepId(chainId),
        stepType: 'source_swap',
        chainId,
      },
    }
  );
};

export const executeDirectDestinationExactOut = async (
  route: SwapRoute,
  ctx: ExecutionContext,
  metadata: SwapMetadata
): Promise<void> => {
  const direct = route.extras.directDestination;
  if (!direct || !ctx.cache) {
    throw Errors.internal('Missing direct-destination execution state');
  }

  const chainId = route.destination.chainId;
  const chain = ctx.chainList.getChainByID(chainId);
  const targetAddress: Hex =
    ctx.sourceExecutionPaths.get(chainId) === 'safe'
      ? predictSafeAccountAddress(ctx.ephemeralWallet.address).address
      : ctx.ephemeralWallet.address;
  const executorCtx = { ...ctx, cache: ctx.cache };
  const authorizations = new Map<string, FundingAuthorization>();
  const routeTimeInputs = new Map<string, bigint>();
  for (const swap of route.source.swaps) {
    if (isNativeInput(swap)) continue;
    const key = swap.quote.input.contractAddress.toLowerCase();
    routeTimeInputs.set(key, (routeTimeInputs.get(key) ?? 0n) + swap.quote.input.amountRaw);
  }
  let swaps = route.source.swaps;
  const currentTimeMs = Date.now();
  const quoteAgeMs = currentTimeMs - route.source.creationTime;
  let forceRequote = quoteAgeMs > DIRECT_DST_QUOTE_TTL_MS;
  logger.debug('swap.execute.source.quote_freshness.decision', {
    chainId,
    routePath: 'direct_destination',
    quoteCreationTimeMs: route.source.creationTime,
    currentTimeMs,
    quoteAgeMs,
    quoteTtlMs: DIRECT_DST_QUOTE_TTL_MS,
    forceRequote,
  });
  let dispatchAttempts = 0;

  while (dispatchAttempts < MAX_DISPATCH_ATTEMPTS) {
    if (forceRequote) {
      try {
        swaps = await withTimingSpan(
          ctx.timing,
          'flow.swap.execute.source.requote',
          async () =>
            sizeDirectDestinationExactOut({
              holdings: direct.dstHoldings,
              tokenAddress: route.dstTokenInfo.contractAddress,
              tokenDecimals: route.dstTokenInfo.decimals,
              tokenTargetRaw: direct.toAmountRaw,
              nativeDecimals: chain.nativeCurrency?.decimals ?? 18,
              gasTargetRaw: direct.toNativeAmountRaw,
              aggregators: route.extras.aggregators,
              userAddressByChain: new Map([[chainId, targetAddress]]),
              recipientAddressByChain: new Map([[chainId, ctx.eoaAddress]]),
              convergenceExtraRaw: makeConvergenceExtraRaw(route.extras.oraclePrices, chainId),
            }),
          { tags: { attempt: dispatchAttempts + 1, route_path: 'direct_destination' } }
        );
        forceRequote = false;
      } catch (error) {
        const normalized = normalizeRequoteFailure(error, swaps, chainId);
        emitFailed(ctx, chainId, normalized);
        throw normalized;
      }
    }

    let calls: SBCCall[];
    try {
      calls = await withTimingSpan(
        ctx.timing,
        'flow.swap.execute.source.build_calls',
        async () =>
          buildCalls({
            swaps,
            chainId,
            targetAddress,
            ctx: executorCtx,
            authorizations,
            routeTimeInputs,
            oraclePrices: route.extras.oraclePrices,
          }),
        {
          tags: {
            attempt: dispatchAttempts + 1,
            route_path: 'direct_destination',
            source_leg_count: swaps.length,
          },
        }
      );
    } catch (error) {
      const normalized = isUserRejectedRequest(error) ? Errors.userRejectedAllowance() : error;
      emitFailed(ctx, chainId, normalized);
      throw normalized;
    }

    let dispatched: DispatchedSourceBatch | undefined;
    try {
      dispatchAttempts += 1;
      const submitted = await withTimingSpan(
        ctx.timing,
        'flow.swap.execute.source.dispatch',
        async () =>
          dispatchSourceChainBatch({
            chainId,
            calls,
            nativeValue: calls.reduce((total, call) => total + call.value, 0n),
            ctx,
        }),
        { tags: { attempt: dispatchAttempts, route_path: 'direct_destination' } }
      );
      dispatched = submitted;
      const txHash = await withTimingSpan(
        ctx.timing,
        'flow.swap.execute.source.wait_receipt',
        async () => submitted.waitForReceipt(),
        { tags: { attempt: dispatchAttempts, route_path: 'direct_destination' } }
      );
      const explorerUrl =
        txHash === submitted.submittedTxHash && submitted.submittedExplorerUrl !== undefined
          ? submitted.submittedExplorerUrl
          : createExplorerTxURL(txHash, submitted.explorerBaseUrl);
      ctx.onProgress?.({
        stepType: 'source_swap',
        chainId,
        state: 'confirmed',
        txHash,
        explorerUrl,
      });
      metadata.src.push({
        chid: chainId,
        swaps: swaps.map(toMetadataSwap),
        tx_hash: txHash,
      });
      return;
    } catch (error) {
      const normalized = normalizeDispatchFailure(error, chainId, dispatched);
      if (isDefinitiveFailure(normalized) && dispatchAttempts < MAX_DISPATCH_ATTEMPTS) {
        forceRequote = true;
        continue;
      }
      emitFailed(ctx, chainId, normalized, dispatched);
      throw normalized;
    }
  }
};
