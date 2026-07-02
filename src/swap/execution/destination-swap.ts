import { erc20Abi, type Hex } from 'viem';
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
import { isNativeAddress } from '../../services/addresses';
import { confirmStepReceipt } from '../../services/evm';
import { createExplorerTxURL } from '../../services/explorer';
import { buildRefundSweepCall } from '../../services/init-refund-sweep';
import {
  createSafeExecuteTxFromCalls,
  ensureSafeForEphemeral,
  type SafeCall,
} from '../../services/safe';
import { createSBCTxFromCalls, requireSuccessfulSbcResult, type SBCCall } from '../../services/sbc';
import { createDestinationSwapStepId } from '../../services/step-ids';
import { aggregatorService } from '../aggregators';
import { predictSafeAccountAddress } from '../safe/predict';
import { createSweeperTxs } from '../sweep';
import {
  type ExecutionContext,
  type PreparedEoaToEphemeralTransfer,
  type SwapMetadata,
  SwapMode,
  type SwapRoute,
  type WalletPath,
} from '../types';
import { chainSupports7702 } from '../wallet/capabilities';
import { resolvePreparedFundingTransferCalls } from './eoa-to-ephemeral';
import { getParsedQuote } from './parsed-quote';

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

// Read the COT held at the destination wrapper (ephemeral on 7702, predicted Safe otherwise).
// Shared by the EXACT_IN reclaim (size the swap up) and the EXACT_OUT surplus return (size the
// transfer). Mirrors the targeted read in failure-cleanup.
const readWrapperCotBalance = async (
  cotAddress: Hex,
  wrapper: WalletPath,
  ctx: Pick<ExecutionContext, 'ephemeralWallet' | 'publicClientList'>,
  chainId: number
): Promise<bigint> => {
  const holder =
    wrapper === 'safe'
      ? predictSafeAccountAddress(ctx.ephemeralWallet.address).address
      : ctx.ephemeralWallet.address;
  const publicClient = ctx.publicClientList.get(chainId);
  return isNativeAddress(cotAddress)
    ? publicClient.getBalance({ address: holder })
    : publicClient.readContract({
        address: cotAddress,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [holder],
      });
};

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
  >,
  wrapper: WalletPath,
  // The COT actually at the wrapper (balanceOf + in-batch direct COT), or null if the read failed.
  // When present, the leftover `B − consumed` is returned by one direct transfer (both modes); only a
  // failed read falls back to the blind Sweeper drain.
  wrapperCotBalance: bigint | null
) => {
  const calls: SBCCall[] = [];
  const sweepTokens: Hex[] = [];

  // Direct COT held at the EOA is moved EOA → executor (the predicted Safe on non-7702 chains, the
  // ephemeral on 7702 chains) so the dst swap can pull from it. The prepared transfer's
  // targetAddress is that executor.
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
    // Output-token dust sweep only on the 7702 ephemeral path — aggregator delivers output
    // direct to the EOA on Safe paths.
    if (wrapper === 'ephemeral') {
      sweepTokens.push(currentSwap.tokenSwap.quote.output.contractAddress);
    }
  } else if (!currentSwap.gasSwap) {
    sweepTokens.push(dstTokenInfo.contractAddress);
  }

  // Gas swap (COT → native, receiver = EOA). Push after the token swap to match v1's
  // combined-batch ordering. Native goes direct to the EOA, so we never sweep EADDRESS
  // at the wrapper — that's what removed Calibur's approveNative/sweepERC7914 path and
  // the Safe value-send forwarder.
  if (currentSwap.gasSwap) {
    const parsedGasSwap = getParsedQuote(currentSwap.gasSwap, ctx.preparedExecution?.parsedQuotes);
    if (parsedGasSwap.approval) {
      calls.push(parsedGasSwap.approval);
    }
    calls.push(parsedGasSwap.swap);
  }

  // Leftover COT input → ONE direct transfer back to the EOA: `B − consumed` (EXACT_IN grew the input
  // so this is ~nothing; EXACT_OUT leaves the real surplus). Both modes use the same transfer; getDstSwap
  // already applied any margin (EXACT_IN's grow deduction), and the swap pulls ≤ its quoted input so the
  // leftover is guaranteed available. Only when the balance read failed do we fall back to the blind
  // Sweeper (size unknown).
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

  // Sweeper sender = wrapper (msg.sender at Sweeper after Safe.execTransaction →
  // MultiSendCallOnly DELEGATECALL → CALL Sweeper resolves to Safe; on Calibur it's the
  // ephemeral itself).
  const senderAddress =
    wrapper === 'safe'
      ? predictSafeAccountAddress(ctx.ephemeralWallet.address).address
      : ctx.ephemeralWallet.address;
  const uniqueSweepTokens = [
    ...new Map(sweepTokens.map((token) => [token.toLowerCase(), token] as const)).values(),
  ];
  const publicClient = ctx.publicClientList.get(destination.chainId);
  for (const tokenAddress of uniqueSweepTokens) {
    // Skip a dust sweep we can confirm is empty (saves the approve + external Sweeper CALL). The
    // output token usually lands at the EOA, leaving 0 at the wrapper. Best-effort: on a read failure
    // sweep anyway, so we never strand funds.
    try {
      const balance = isNativeAddress(tokenAddress)
        ? await publicClient.getBalance({ address: senderAddress })
        : await publicClient.readContract({
            address: tokenAddress,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [senderAddress],
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
 * - 7702 destination → Calibur SBC executes approve + dst-aggregator swap + sweepers.
 * - non-7702 destination → Safe.execTransaction wraps the same call sequence.
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
    | 'onProgress'
    | 'slippage'
  >,
  metadata: SwapMetadata
): Promise<void> => {
  const chain = ctx.chainList.getChainByID(destination.chainId);
  let currentSwap = destination.swap;
  let lastError: unknown;

  if (!currentSwap.tokenSwap && !currentSwap.gasSwap) {
    logger.debug('executeDestinationSwap:skip_noop_no_swap', {
      chainId: destination.chainId,
    });
    return;
  }

  const wrapper: WalletPath = chainSupports7702(chain) ? 'ephemeral' : 'safe';

  logger.debug('executeDestinationSwap:start', {
    chainId: destination.chainId,
    walletPath: wrapper,
  });

  // Read the COT at the dst wrapper once. Execution just measures and hands the balance to the route's
  // getDstSwap — each mode's closure decides what to do with it (EXACT_IN grows the input toward it,
  // EXACT_OUT lifts its max-input budget to it). Includes the in-batch direct dst COT (eoaToEphemeral),
  // which rides the swap batch and isn't at the wrapper yet. Best-effort: a failed read passes 0 (→ the
  // route-time quote) and the leftover falls back to the Sweeper.
  let wrapperCotBalance: bigint | null = null;
  try {
    const cotAddress =
      currentSwap.tokenSwap?.quote.input.contractAddress ??
      currentSwap.gasSwap?.quote.input.contractAddress;
    if (cotAddress) {
      const balance = await readWrapperCotBalance(cotAddress, wrapper, ctx, destination.chainId);
      wrapperCotBalance = balance + (destination.eoaToEphemeral?.amount ?? 0n);
    }
  } catch (error) {
    logger.debug('executeDestinationSwap:balance_read_skipped', {
      chainId: destination.chainId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // EXACT_IN grows the dst input to swallow the surplus into more output, so requote up-front when the
  // actual balance exceeds the route-time estimate. EXACT_OUT keeps the output fixed — it tries the
  // existing quote first and only re-prices (at the lifted budget) on a retry/expiry below.
  if (
    mode === SwapMode.EXACT_IN &&
    wrapperCotBalance !== null &&
    currentSwap.tokenSwap &&
    wrapperCotBalance > currentSwap.tokenSwap.quote.input.amountRaw
  ) {
    try {
      const grown = await destination.getDstSwap(wrapperCotBalance);
      if (grown?.tokenSwap) {
        currentSwap = grown;
        logger.debug('executeDestinationSwap:grow', {
          chainId: destination.chainId,
          actual: wrapperCotBalance.toString(),
          input: grown.tokenSwap.quote.input.amountRaw.toString(),
        });
      }
    } catch (error) {
      logger.debug('executeDestinationSwap:grow_skipped', {
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
    try {
      // Try the current quote first; only requote on a forced retry or an expired quote. The requote
      // re-prices against the actual balance (EXACT_OUT lifts its budget to it; an EXACT_IN retry
      // re-grows).
      if (attempt > 0 || isQuoteExpired(currentSwap)) {
        const requoted = await destination.getDstSwap(wrapperCotBalance ?? 0n);
        if (requoted?.tokenSwap || requoted?.gasSwap) {
          currentSwap = requoted;
        } else if (attempt > 0) {
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

      const calls = await buildDestinationCalls(
        currentSwap,
        destination,
        dstTokenInfo,
        ctx,
        wrapper,
        wrapperCotBalance
      );
      let txHash: Hex;
      const explorerBaseUrl = chain?.blockExplorers?.default?.url;

      if (wrapper === 'safe') {
        // Non-7702 destination: Safe.execTransaction wraps approve+swap+sweepers. Bridge fill
        // already landed at the Safe (route sets bridge recipient = Safe). The Safe pulls the
        // COT into the aggregator, runs the swap with receiver=EOA, and the sweeper drains
        // residual COT back to the EOA in the same execTransaction.
        ctx.onProgress?.({
          stepType: 'destination_swap',
          chainId: destination.chainId,
          state: 'started',
        });
        const publicClient = ctx.publicClientList.get(destination.chainId);
        const { address: safeAddress } = predictSafeAccountAddress(ctx.ephemeralWallet.address);
        await ensureSafeForEphemeral({
          chainId: destination.chainId,
          ephemeralWallet: ctx.ephemeralWallet,
          publicClient,
          middleware: ctx.middlewareClient,
        });
        const safeCalls: SafeCall[] = calls.map((c) => ({
          to: c.to,
          value: c.value,
          data: c.data,
        }));
        const request = await createSafeExecuteTxFromCalls({
          calls: safeCalls,
          chainId: destination.chainId,
          ephemeralWallet: ctx.ephemeralWallet,
          publicClient,
          safeAddress,
        });
        const result = await ctx.middlewareClient.createSafeExecuteTx(request);
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
        await confirmStepReceipt(
          publicClient,
          txHash,
          destination.chainId,
          destinationSwapStep(destination.chainId)
        );
        ctx.onProgress?.({
          stepType: 'destination_swap',
          chainId: destination.chainId,
          state: 'confirmed',
          txHash,
          explorerUrl,
        });
      } else {
        ctx.onProgress?.({
          stepType: 'destination_swap',
          chainId: destination.chainId,
          state: 'started',
        });
        const sbcTx = await createSBCTxFromCalls({
          calls,
          chainID: destination.chainId,
          ephemeralAddress: ctx.ephemeralWallet.address,
          ephemeralWallet: ctx.ephemeralWallet,
          publicClient: ctx.publicClientList.get(destination.chainId),
        });

        const results = await ctx.middlewareClient.submitSBCs([sbcTx]);
        txHash = requireSuccessfulSbcResult(
          results,
          destination.chainId,
          'Destination swap SBC submission'
        );
        const explorerUrl = createExplorerTxURL(txHash, explorerBaseUrl);
        lastSubmitted = {
          txHash,
          explorerUrl,
        };
        ctx.onProgress?.({
          stepType: 'destination_swap',
          chainId: destination.chainId,
          state: 'submitted',
          txHash,
          explorerUrl,
        });
        await confirmStepReceipt(
          ctx.publicClientList.get(destination.chainId),
          txHash,
          destination.chainId,
          destinationSwapStep(destination.chainId)
        );
        ctx.onProgress?.({
          stepType: 'destination_swap',
          chainId: destination.chainId,
          state: 'confirmed',
          txHash,
          explorerUrl,
        });
      }

      updateDestinationMetadata(currentSwap, destination.chainId, txHash, metadata);
      logger.debug('executeDestinationSwap:complete', {
        chainId: destination.chainId,
        txHash,
        swapCount: metadata.dst?.swaps.length ?? 0,
      });
      return;
    } catch (error) {
      lastError = error;
      logger.debug('executeDestinationSwap:attempt_failed', {
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
