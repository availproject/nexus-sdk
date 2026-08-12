import type { Hex } from 'viem';
import { getLogger, type TokenInfo } from '../../domain';
import {
  BackendError,
  ERROR_CODES,
  ExecutionError,
  ExternalServiceError,
  formatUnknownError,
  NexusError,
  SimulationError,
  UserActionError,
} from '../../domain/errors';
import { confirmStepReceipt } from '../../services/evm';
import { createExplorerTxURL } from '../../services/explorer';
import { buildRefundSweepCall } from '../../services/init-refund-sweep';
import {
  createSafeExecuteTxFromCalls,
  requireSafeDeployment,
  type SafeCall,
} from '../../services/safe';
import { createDestinationSwapStepId } from '../../services/step-ids';
import { withTimingSpan } from '../../services/timing';
import { aggregatorService, type RouterExclusions } from '../aggregators';
import { createSweeperTxs } from '../sweep';
import {
  type ExecutionContext,
  type PreparedEoaToEphemeralTransfer,
  type SwapMetadata,
  SwapMode,
  type SwapRoute,
} from '../types';
import { resolvePreparedFundingTransferCalls } from './eoa-to-ephemeral';
import { getParsedQuote } from './parsed-quote';
import { addRouterExclusions } from './router-exclusions';
import { readSettlementBalanceRaw } from './settlement-balance';

const logger = getLogger();

const destinationSwapStep = (chainId: number) => ({
  stepId: createDestinationSwapStepId(chainId),
  stepType: 'destination_swap',
  label: 'Destination swap',
});

const getPreparedDestinationTransfer = (transfers: PreparedEoaToEphemeralTransfer[] | undefined) =>
  transfers?.find((entry) => entry.reason === 'destination');

// Requote a quote that's gone stale (expired). A forced retry always requotes; otherwise we try the
// existing quote first and only requote if its deadline has passed.
const isQuoteExpired = (swap: SwapRoute['destination']['swap']) => {
  const now = Date.now();
  const tokenExpiry = swap.tokenSwap?.quote.expiry;
  const gasExpiry = swap.gasSwap?.quote.expiry;
  return (
    (tokenExpiry !== undefined && tokenExpiry * 1000 < now) ||
    (gasExpiry !== undefined && gasExpiry * 1000 < now)
  );
};

// Read the COT held at the destination Safe.
// Shared by the EXACT_IN reclaim (size the swap up) and the EXACT_OUT surplus return (size the
// transfer). Mirrors the targeted read in failure-cleanup.
const buildDestinationCalls = async (
  currentSwap: SwapRoute['destination']['swap'],
  destination: SwapRoute['destination'],
  dstTokenInfo: Pick<TokenInfo, 'symbol' | 'decimals' | 'contractAddress'>,
  ctx: Pick<
    ExecutionContext,
    | 'chainList'
    | 'eoaAddress'
    | 'eoaWallet'
    | 'ephemeralWallet'
    | 'publicClientList'
    | 'cache'
    | 'preparedExecution'
    | 'safeAddress'
    | 'safeDeploymentPromises'
  >,
  // The COT actually at the wrapper (balanceOf + in-batch direct COT), or null if the read failed.
  // When present, the leftover `B − consumed` is returned by one direct transfer (both modes); only a
  // failed read falls back to the blind Sweeper drain.
  wrapperCotBalance: bigint | null
) => {
  const calls: SafeCall[] = [];
  const sweepTokens: Hex[] = [];

  // Direct COT held at the EOA is moved EOA → Safe so the destination swap can pull from it.
  {
    const transfer = getPreparedDestinationTransfer(ctx.preparedExecution?.eoaToEphemeralTransfers);
    if (transfer) {
      calls.push(
        ...(await resolvePreparedFundingTransferCalls({
          transfer,
          tokenDecimals:
            currentSwap.tokenSwap?.quote.input.decimals ??
            ctx.chainList.getTokenByAddress(destination.chainId, transfer.tokenAddress).decimals,
          chain: ctx.chainList.getChainByID(destination.chainId),
          eoaAddress: ctx.eoaAddress,
          eoaWallet: ctx.eoaWallet,
          publicClient: ctx.publicClientList.get(destination.chainId),
          safeDeploymentPromise: requireSafeDeployment(
            ctx.safeDeploymentPromises,
            destination.chainId
          ),
        }))
      );
    }
  }

  if (currentSwap.tokenSwap) {
    const parsedTokenSwap = getParsedQuote(
      currentSwap.tokenSwap,
      ctx.preparedExecution?.parsedQuotes
    );
    if (parsedTokenSwap.approval) {
      calls.push(parsedTokenSwap.approval);
    }
    calls.push(parsedTokenSwap.swap);
    // The aggregator delivers output directly to the EOA, so the Safe has no output-token dust.
  } else if (!currentSwap.gasSwap) {
    sweepTokens.push(dstTokenInfo.contractAddress);
  }

  // Gas swap (COT → native, receiver = EOA). Push after the token swap to match v1's
  // combined-batch ordering. Native goes direct to the EOA, so we never sweep EADDRESS
  // at the Safe, so it needs no native-token sweep.
  if (currentSwap.gasSwap) {
    const parsedGasSwap = getParsedQuote(currentSwap.gasSwap, ctx.preparedExecution?.parsedQuotes);
    if (parsedGasSwap.approval) {
      calls.push(parsedGasSwap.approval);
    }
    calls.push(parsedGasSwap.swap);
  }

  // Leftover COT input → ONE direct transfer back to the EOA: `B − consumed`. Exact In execution
  // requires its resized quote to consume the complete measured balance, so only Exact Out should
  // produce a positive surplus here. When the Exact Out balance read failed, fall back to the blind
  // Sweeper because the surplus size is unknown.
  if (wrapperCotBalance !== null) {
    const cotAddress =
      currentSwap.tokenSwap?.quote.input.contractAddress ??
      currentSwap.gasSwap?.quote.input.contractAddress;
    const consumed =
      (currentSwap.tokenSwap?.quote.input.amountRaw ?? 0n) +
      (currentSwap.gasSwap?.quote.input.amountRaw ?? 0n);
    const leftover = wrapperCotBalance - consumed;
    if (cotAddress && leftover > 0n) {
      calls.push(buildRefundSweepCall(cotAddress, leftover, ctx.eoaAddress));
    }
  } else {
    if (currentSwap.tokenSwap) {
      sweepTokens.push(currentSwap.tokenSwap.quote.input.contractAddress);
    }
    if (currentSwap.gasSwap) {
      sweepTokens.push(currentSwap.gasSwap.quote.input.contractAddress);
    }
  }

  // MultiSendCallOnly DELEGATECALL → CALL Sweeper resolves msg.sender to the Safe.
  const senderAddress = ctx.safeAddress;
  const uniqueSweepTokens = [
    ...new Map(sweepTokens.map((token) => [token.toLowerCase(), token] as const)).values(),
  ];
  for (const tokenAddress of uniqueSweepTokens) {
    // Skip a dust sweep we can confirm is empty (saves the approve + external Sweeper CALL). The
    // output token usually lands at the EOA, leaving 0 at the wrapper. Best-effort: on a read failure
    // sweep anyway, so we never strand funds.
    try {
      const balance = await readSettlementBalanceRaw({
        chainId: destination.chainId,
        tokenAddress,
        holderAddress: senderAddress,
        publicClientList: ctx.publicClientList,
      });
      if (balance === 0n) continue;
    } catch {
      // read failed — fall through and sweep
    }
    calls.push(
      ...createSweeperTxs(
        tokenAddress,
        ctx.eoaAddress,
        destination.chainId,
        ctx.cache,
        senderAddress
      )
    );
  }

  return calls;
};

const updateDestinationMetadata = (
  swap: SwapRoute['destination']['swap'],
  chainId: number,
  txHash: Hex,
  metadata: SwapMetadata
) => {
  const swaps = [];
  if (swap.tokenSwap) {
    swaps.push({
      inputAmount: swap.tokenSwap.quote.input.amountRaw,
      inputContract: swap.tokenSwap.quote.input.contractAddress,
      inputDecimals: swap.tokenSwap.quote.input.decimals,
      outputAmount: swap.tokenSwap.quote.output.amountRaw,
      outputContract: swap.tokenSwap.quote.output.contractAddress,
      outputDecimals: swap.tokenSwap.quote.output.decimals,
    });
  }
  if (swap.gasSwap) {
    swaps.push({
      inputAmount: swap.gasSwap.quote.input.amountRaw,
      inputContract: swap.gasSwap.quote.input.contractAddress,
      inputDecimals: swap.gasSwap.quote.input.decimals,
      outputAmount: swap.gasSwap.quote.output.amountRaw,
      outputContract: swap.gasSwap.quote.output.contractAddress,
      outputDecimals: swap.gasSwap.quote.output.decimals,
    });
  }

  metadata.dst = {
    chid: chainId,
    swaps,
    tx_hash: txHash,
  };
};

// ---------------------------------------------------------------------------
// executeDestinationSwap
// ---------------------------------------------------------------------------

/**
 * Executes the destination swap step.
 *
 * - No destination swap step (COT destination) → no-op; the bridge fill already delivered to
 *   the EOA.
 * - Safe.execTransaction wraps approve + destination-aggregator swap + sweepers.
 */
export const executeDestinationSwap = async (
  destination: SwapRoute['destination'],
  mode: SwapMode,
  dstTokenInfo: Pick<TokenInfo, 'decimals' | 'contractAddress' | 'symbol'>,
  ctx: Pick<
    ExecutionContext,
    | 'chainList'
    | 'eoaAddress'
    | 'eoaWallet'
    | 'ephemeralWallet'
    | 'publicClientList'
    | 'middlewareClient'
    | 'cache'
    | 'preparedExecution'
    | 'safeAddress'
    | 'safeDeploymentPromises'
    | 'onProgress'
    | 'timing'
    | 'slippage'
  >,
  metadata: SwapMetadata
): Promise<void> => {
  const chain = ctx.chainList.getChainByID(destination.chainId);
  let currentSwap = destination.swap;
  const requiresTokenSwap = Boolean(destination.swap.tokenSwap);
  const requiresGasSwap = Boolean(destination.swap.gasSwap);
  const routerExclusions: RouterExclusions = new Map();
  let lastError: unknown;

  const getDstSwap = (actualCotRaw: bigint) =>
    routerExclusions.size > 0
      ? destination.getDstSwap(actualCotRaw, routerExclusions)
      : destination.getDstSwap(actualCotRaw);

  if (!currentSwap.tokenSwap && !currentSwap.gasSwap) {
    logger.debug('swap.execute.destination.noop.skipped', {
      chainId: destination.chainId,
    });
    return;
  }

  const wrapper = 'safe' as const;

  logger.debug('swap.execute.destination.operation.started', {
    chainId: destination.chainId,
    walletPath: wrapper,
  });

  const readWrapperCotBalance = async (): Promise<bigint> => {
    const cotAddress =
      currentSwap.tokenSwap?.quote.input.contractAddress ??
      currentSwap.gasSwap?.quote.input.contractAddress;
    if (!cotAddress) {
      throw new Error('Destination settlement token is unavailable');
    }
    const holderAddress = ctx.safeAddress;
    const balance = await withTimingSpan(
      ctx.timing,
      'flow.swap.execute.destination.read_balance',
      async () =>
        readSettlementBalanceRaw({
          chainId: destination.chainId,
          tokenAddress: cotAddress,
          holderAddress,
          publicClientList: ctx.publicClientList,
        }),
      { tags: { mode, wallet_path: wrapper } }
    );
    return balance + (destination.eoaToEphemeral?.amount ?? 0n);
  };

  // EXACT_OUT keeps its best-effort read: it can safely execute the protected fixed-output quote
  // without measuring surplus. EXACT_IN must measure and resize before dispatch, so its read lives
  // inside the retry loop below and a read failure consumes an attempt.
  let wrapperCotBalance: bigint | null = null;
  if (mode === SwapMode.EXACT_OUT) {
    try {
      wrapperCotBalance = await readWrapperCotBalance();
    } catch (error) {
      logger.debug('swap.execute.destination.balance_read.skipped', {
        chainId: destination.chainId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const MAX_RETRIES = 2;
  let lastSubmitted:
    | {
        txHash: Hex;
        explorerUrl: string;
      }
    | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let attemptedDispatch = false;
    try {
      if (mode === SwapMode.EXACT_IN) {
        if (wrapperCotBalance === null) {
          wrapperCotBalance = await readWrapperCotBalance();
        }
        const actualCotBalance = wrapperCotBalance;
        const resized = await withTimingSpan(
          ctx.timing,
          'flow.swap.execute.destination.resize_or_requote',
          async () => getDstSwap(actualCotBalance),
          { tags: { mode, wallet_path: wrapper, attempt } }
        );
        const hasEveryRequiredLeg =
          resized != null &&
          (!requiresTokenSwap || Boolean(resized.tokenSwap)) &&
          (!requiresGasSwap || Boolean(resized.gasSwap));
        const resizedInputRaw =
          (resized?.tokenSwap?.quote.input.amountRaw ?? 0n) +
          (resized?.gasSwap?.quote.input.amountRaw ?? 0n);
        const consumesFullBalance = resizedInputRaw === actualCotBalance;
        if (
          !resized ||
          (!resized.tokenSwap && !resized.gasSwap) ||
          !hasEveryRequiredLeg ||
          !consumesFullBalance
        ) {
          const previousAggregator =
            currentSwap.tokenSwap?.aggregator ?? currentSwap.gasSwap?.aggregator;
          throw new ExternalServiceError(
            ERROR_CODES.EXTERNAL_DESTINATION_SWAP_QUOTE_FAILED,
            'Quote failed: Failed to resize destination swap.',
            {
              context: {
                service: previousAggregator ? aggregatorService(previousAggregator) : 'lifi',
                stepId: createDestinationSwapStepId(destination.chainId),
                stepType: 'destination_swap',
                chainId: destination.chainId,
              },
            }
          );
        }
        currentSwap = resized;
        logger.debug('swap.execute.destination.resize.completed', {
          chainId: destination.chainId,
          actualBalanceRaw: actualCotBalance.toString(),
          inputAmountRaw: resized.tokenSwap?.quote.input.amountRaw.toString(),
        });
      }

      // Try the current quote first; only requote on a forced retry or an expired quote. The requote
      // re-prices against the actual balance (EXACT_OUT lifts its budget to it; an EXACT_IN retry
      // re-grows).
      if (mode === SwapMode.EXACT_OUT && (attempt > 0 || isQuoteExpired(currentSwap))) {
        const requoted = await withTimingSpan(
          ctx.timing,
          'flow.swap.execute.destination.resize_or_requote',
          async () => getDstSwap(wrapperCotBalance ?? 0n),
          { tags: { mode, wallet_path: wrapper, attempt } }
        );
        const hasEveryRequiredLeg =
          requoted != null &&
          (!requiresTokenSwap || Boolean(requoted.tokenSwap)) &&
          (!requiresGasSwap || Boolean(requoted.gasSwap));
        if ((requoted?.tokenSwap || requoted?.gasSwap) && hasEveryRequiredLeg) {
          currentSwap = requoted;
        } else if (attempt > 0 || (requoted != null && !hasEveryRequiredLeg)) {
          const previousAggregator =
            currentSwap.tokenSwap?.aggregator ?? currentSwap.gasSwap?.aggregator;
          throw new ExternalServiceError(
            ERROR_CODES.EXTERNAL_DESTINATION_SWAP_QUOTE_FAILED,
            'Quote failed: Failed to requote destination swap.',
            {
              context: {
                service: previousAggregator ? aggregatorService(previousAggregator) : 'lifi',
                stepId: createDestinationSwapStepId(destination.chainId),
                stepType: 'destination_swap',
                chainId: destination.chainId,
              },
            }
          );
        }
      }

      const calls = await withTimingSpan(
        ctx.timing,
        'flow.swap.execute.destination.build_calls',
        async () =>
          buildDestinationCalls(currentSwap, destination, dstTokenInfo, ctx, wrapperCotBalance),
        { tags: { mode, wallet_path: wrapper, attempt } }
      );
      let txHash: Hex;
      const explorerBaseUrl = chain?.blockExplorers?.default?.url;

      // Safe.execTransaction wraps approve+swap+sweepers. Bridge fill already landed at the Safe.
      // The Safe pulls COT into the aggregator, runs the swap with receiver=EOA, and drains any
      // residual COT back to the EOA in the same transaction.
      ctx.onProgress?.({
        stepType: 'destination_swap',
        chainId: destination.chainId,
        state: 'started',
      });
      const publicClient = ctx.publicClientList.get(destination.chainId);
      const result = await withTimingSpan(
        ctx.timing,
        'flow.swap.execute.destination.dispatch',
        async () => {
          await requireSafeDeployment(ctx.safeDeploymentPromises, destination.chainId);
          const safeCalls: SafeCall[] = calls.map((c) => ({
            to: c.to,
            value: c.value,
            data: c.data,
          }));
          const request = await createSafeExecuteTxFromCalls({
            calls: safeCalls,
            chainId: destination.chainId,
            eoaAddress: ctx.eoaAddress,
            ephemeralWallet: ctx.ephemeralWallet,
            publicClient,
            safeAddress: ctx.safeAddress,
          });
          attemptedDispatch = true;
          return ctx.middlewareClient.createSafeExecuteTx(request);
        },
        { tags: { mode, wallet_path: wrapper, attempt } }
      );
      txHash = result.txHash;
      const explorerUrl = createExplorerTxURL(txHash, explorerBaseUrl);
      lastSubmitted = { txHash, explorerUrl };
      ctx.onProgress?.({
        stepType: 'destination_swap',
        chainId: destination.chainId,
        state: 'submitted',
        txHash,
        explorerUrl,
      });
      await withTimingSpan(
        ctx.timing,
        'flow.swap.execute.destination.wait_receipt',
        async () =>
          confirmStepReceipt(
            publicClient,
            txHash,
            destination.chainId,
            destinationSwapStep(destination.chainId)
          ),
        { tags: { mode, wallet_path: wrapper, attempt } }
      );
      ctx.onProgress?.({
        stepType: 'destination_swap',
        chainId: destination.chainId,
        state: 'confirmed',
        txHash,
        explorerUrl,
      });

      updateDestinationMetadata(currentSwap, destination.chainId, txHash, metadata);
      logger.debug('swap.execute.destination.operation.completed', {
        chainId: destination.chainId,
        txHash,
        swapCount: metadata.dst?.swaps.length ?? 0,
      });
      return;
    } catch (error) {
      if (attemptedDispatch) {
        addRouterExclusions(routerExclusions, [currentSwap.tokenSwap, currentSwap.gasSwap]);
      }
      lastError = error;
      logger.debug('swap.execute.destination.attempt.failed', {
        chainId: destination.chainId,
        attempt,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const formattedError = formatUnknownError(lastError);
  ctx.onProgress?.({
    stepType: 'destination_swap',
    chainId: destination.chainId,
    state: 'failed',
    ...(lastSubmitted ? lastSubmitted : {}),
    error: formattedError,
  });
  // Preserve categorized errors (e.g. ExternalServiceError from a destination requote) as-is,
  // but make sure the outer `destination_swap` step metadata is attached so progress
  // consumers can dispatch correctly. We don't downgrade the subclass or leaf code.
  if (lastError instanceof NexusError) {
    throw rewrapDestinationStep(lastError, destination.chainId);
  }
  throw new ExecutionError(ERROR_CODES.EXECUTION_ERROR, formattedError, {
    context: {
      service: 'wallet',
      stepId: createDestinationSwapStepId(destination.chainId),
      stepType: 'destination_swap',
      chainId: destination.chainId,
    },
  });
};

/**
 * If the categorized error already carries `destination_swap` step metadata, return it.
 * Otherwise clone with the step metadata stamped on, preserving the original subclass,
 * leaf code, and service. Each branch threads its own narrowed context type so TS's
 * per-category `service` constraint stays satisfied.
 */
const rewrapDestinationStep = (error: NexusError, chainId: number): NexusError => {
  if (error.context.stepId !== undefined && error.context.stepType === 'destination_swap') {
    return error;
  }
  const stepId = createDestinationSwapStepId(chainId);
  const baseContext = {
    operation: error.context.operation,
    chainId,
    stepId,
    stepType: 'destination_swap' as const,
  };
  if (error instanceof ExternalServiceError) {
    return new ExternalServiceError(error.code, error.message, {
      details: error.details,
      context: { ...baseContext, service: error.context.service },
    });
  }
  if (error instanceof BackendError) {
    return new BackendError(error.code, error.message, {
      details: error.details,
      context: { ...baseContext, service: error.context.service },
    });
  }
  if (error instanceof ExecutionError) {
    return new ExecutionError(error.code, error.message, {
      details: error.details,
      context: { ...baseContext, service: error.context.service },
    });
  }
  if (error instanceof UserActionError) {
    return new UserActionError(error.code, error.message, {
      details: error.details,
      context: { ...baseContext, service: error.context.service },
    });
  }
  if (error instanceof SimulationError) {
    return new SimulationError(error.code, error.message, {
      details: error.details,
      context: { ...baseContext, service: error.context.service },
    });
  }
  // ValidationError / InternalError reaching here would be unusual; preserve as-is.
  return error;
};
