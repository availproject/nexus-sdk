import Decimal from 'decimal.js';
import type { Hex } from 'viem';
import { getLogger } from '../../domain';
import {
  ERROR_CODES,
  Errors,
  ExecutionError,
  ExternalServiceError,
  formatUnknownError,
  NexusError,
  UserActionError,
} from '../../domain/errors';
import { isNativeAddress } from '../../services/addresses';
import { confirmStepReceipt } from '../../services/evm';
import { createExplorerTxURL } from '../../services/explorer';
import { isUserRejectedRequest } from '../../services/is-user-rejected-request';
import { divDecimals } from '../../services/math';
import type { SafeCall } from '../../services/safe';
import { createSourceSwapStepId } from '../../services/step-ids';
import { equalFold } from '../../services/strings';
import { withTimingSpan } from '../../services/timing';
import { aggregatorService } from '../aggregators';
import { type QuoteResponse, QuoteSeriousness, QuoteType } from '../aggregators/types';
import { predictSafeAccountAddressV2 } from '../safe/predict';
import type {
  BridgeAsset,
  ExecutionContext,
  PreparedEoaToEphemeralTransfer,
  SourceChainCOT,
  SwapMetadata,
  WalletPath,
} from '../types';
import { resolvePreparedFundingTransferCalls } from './eoa-to-ephemeral';
import { getParsedQuote } from './parsed-quote';
import { dispatchSafeSource } from './safe-dispatch';
import { readSettlementBalanceRaw } from './settlement-balance';

const logger = getLogger();

export type DispatchedSourceBatch = {
  chainId: number;
  chainName?: string;
  walletPath: WalletPath;
  explorerBaseUrl?: string;
  submittedTxHash?: Hex;
  submittedExplorerUrl?: string;
  waitForReceipt: () => Promise<Hex>;
};

type DispatchedSourceChain = DispatchedSourceBatch & {
  chainSwaps: QuoteResponse[];
};

type ConfirmedSourceChain = DispatchedSourceChain & {
  txHash: Hex;
};

const isNativeInput = (swap: QuoteResponse) => isNativeAddress(swap.quote.input.contractAddress);

const sortSourceSwaps = (swaps: QuoteResponse[]) =>
  [...swaps].sort((left, right) => Number(isNativeInput(left)) * -1 + Number(isNativeInput(right)));

const getPreparedSourceTransfer = (
  swap: QuoteResponse,
  transfers: PreparedEoaToEphemeralTransfer[] | undefined
) =>
  transfers?.find(
    (entry) =>
      entry.reason === 'source' &&
      entry.chainId === swap.chainID &&
      equalFold(entry.tokenAddress, swap.quote.input.contractAddress) &&
      entry.amount === swap.quote.input.amountRaw
  );

const buildSourceCalls = async (
  chainSwaps: QuoteResponse[],
  ctx: Pick<
    ExecutionContext,
    | 'chainList'
    | 'preparedExecution'
    | 'cache'
    | 'ephemeralWallet'
    | 'eoaAddress'
    | 'eoaWallet'
    | 'publicClientList'
    | 'safeDeploymentPromises'
  >,
  chainId: number
): Promise<SafeCall[]> => {
  const calls: SafeCall[] = [];
  const usedTransfers = new Set<string>();
  const publicClient = ctx.publicClientList.get(chainId);
  const chain = ctx.chainList.getChainByID(chainId);

  for (const swap of sortSourceSwaps(chainSwaps)) {
    const parsedQuote = getParsedQuote(swap, ctx.preparedExecution?.parsedQuotes);
    const nativeInput = isNativeInput(swap);

    // ERC20 inputs are funded EOA → Safe inside the same batch, so the Safe holds the token before
    // it approves the aggregator router and swaps. Native inputs carry their value through the
    // Safe execTransaction, so they need no funding transfer.
    if (!nativeInput) {
      const transfer = getPreparedSourceTransfer(
        swap,
        ctx.preparedExecution?.eoaToEphemeralTransfers
      );
      const transferKey = transfer
        ? `${transfer.chainId}:${transfer.tokenAddress.toLowerCase()}:${transfer.amount.toString()}`
        : null;
      if (transfer && transferKey && !usedTransfers.has(transferKey)) {
        calls.push(
          ...(await resolvePreparedFundingTransferCalls({
            transfer,
            tokenDecimals: swap.quote.input.decimals,
            chain,
            eoaAddress: ctx.eoaAddress,
            eoaWallet: ctx.eoaWallet,
            publicClient,
            cache: ctx.cache,
            safeDeploymentPromise: ctx.safeDeploymentPromises?.get(chainId),
          }))
        );
        usedTransfers.add(transferKey);
      }
    }

    if (parsedQuote.approval && !nativeInput) {
      calls.push(parsedQuote.approval);
    }
    calls.push(parsedQuote.swap);
  }

  return calls;
};

const buildBridgeAsset = (
  chainId: number,
  chainSwaps: QuoteResponse[],
  cot: SourceChainCOT | undefined,
  // EXACT_IN reclaim: when set, the COT that actually landed at the wrapper (raw), bridged instead
  // of the quote's `minReceived` floor so positive source slippage reaches the destination.
  overrideBalanceRaw?: bigint
): BridgeAsset => {
  const decimals = cot?.decimals ?? chainSwaps[0].quote.output.decimals;
  const ephemeralBalance =
    overrideBalanceRaw !== undefined
      ? divDecimals(overrideBalanceRaw, decimals)
      : chainSwaps.reduce((sum, swap) => sum.plus(swap.quote.output.amount), new Decimal(0));

  // Remote swap output already lands at the ephemeral bridge holder on both wallet paths. The
  // asset is therefore always carried as the ephemeral identity for the RFF.
  return {
    chainID: chainId,
    contractAddress: cot?.contractAddress ?? chainSwaps[0].quote.output.contractAddress,
    decimals,
    eoaBalance: new Decimal(0),
    ephemeralBalance,
  };
};

// Read the COT that actually landed after the source swaps confirmed. Remote outputs that bridge
// land directly at the ephemeral bridge holder. A destination-chain Safe keeps local COT for its
// later destination swap.
const readSourceCotBalanceRaw = async (
  chainId: number,
  cotAddress: Hex,
  ctx: Pick<
    ExecutionContext,
    'chainList' | 'eoaAddress' | 'ephemeralWallet' | 'publicClientList'
  > & {
    destinationChainId: number;
  }
): Promise<bigint> => {
  const holder =
    chainId !== ctx.destinationChainId
      ? ctx.ephemeralWallet.address
      : predictSafeAccountAddressV2(ctx.eoaAddress, ctx.ephemeralWallet.address).address;
  return readSettlementBalanceRaw({
    chainId,
    tokenAddress: cotAddress,
    holderAddress: holder,
    publicClientList: ctx.publicClientList,
  });
};

const sourceSwapStep = (chainId: number) => ({
  stepId: createSourceSwapStepId(chainId),
  stepType: 'source_swap',
  label: 'Source swap',
});

type SourceDispatchContext = Pick<
  ExecutionContext,
  | 'chainList'
  | 'sourceExecutionPaths'
  | 'safeDeploymentPromises'
  | 'eoaAddress'
  | 'eoaWallet'
  | 'ephemeralWallet'
  | 'publicClientList'
  | 'middlewareClient'
  | 'onProgress'
>;

export const dispatchSourceChainBatch = async (input: {
  chainId: number;
  calls: SafeCall[];
  nativeValue: bigint;
  ctx: SourceDispatchContext;
}): Promise<DispatchedSourceBatch> => {
  const { chainId, calls, nativeValue, ctx } = input;
  const walletPath: WalletPath = 'safe';
  const chain = ctx.chainList.getChainByID(chainId);
  const publicClient = ctx.publicClientList.get(chainId);

  if (nativeValue === 0n) {
    ctx.onProgress?.({
      stepType: 'source_swap',
      chainId,
      state: 'started',
    });
  }
  const { txHash } = await dispatchSafeSource({
    chain,
    calls,
    chainId,
    nativeValue,
    ephemeralWallet: ctx.ephemeralWallet,
    eoaWallet: ctx.eoaWallet,
    eoaAddress: ctx.eoaAddress,
    publicClient,
    middleware: ctx.middlewareClient,
    safeDeploymentPromise: ctx.safeDeploymentPromises?.get(chainId),
    onWalletPrompt:
      nativeValue > 0n
        ? () => ctx.onProgress?.({ stepType: 'source_swap', chainId, state: 'wallet_prompted' })
        : undefined,
    simulationStep: sourceSwapStep(chainId),
  });
  const explorerUrl = createExplorerTxURL(txHash, chain.blockExplorers?.default?.url);
  ctx.onProgress?.({
    stepType: 'source_swap',
    chainId,
    state: 'submitted',
    txHash,
    explorerUrl,
  });
  return {
    chainId,
    chainName: chain.name,
    walletPath,
    explorerBaseUrl: chain.blockExplorers?.default?.url,
    submittedTxHash: txHash,
    submittedExplorerUrl: explorerUrl,
    waitForReceipt: () =>
      confirmStepReceipt(publicClient, txHash, chainId, sourceSwapStep(chainId)),
  };
};

// Re-quote source legs that reverted. For EXACT_OUT (`srcBuffer` non-null, COT units sizing
// `min(SRC_BUFFER_PCT, SRC_BUFFER_MAX_USD)` of the destination-buffered input) the combined
// output drop must fit inside that budget. EXACT_IN passes `null`: re-quote and proceed with
// no drift guard — Seam 2 re-sizes the dst swap to whatever COT actually lands.
const requoteFailedChains = async (
  failedChains: Array<{ chainId: number; chainSwaps: QuoteResponse[] }>,
  srcBuffer: Decimal | null,
  ctx: Pick<
    ExecutionContext,
    'sourceExecutionPaths' | 'eoaAddress' | 'ephemeralWallet' | 'destinationDirectEoa'
  > & { destinationChainId: number }
) => {
  // Per-chain recipient: remote output always lands at the ephemeral bridge holder. On the
  // destination chain, direct delivery uses the EOA and a later Safe destination swap keeps COT
  // at that Safe.
  const recipientForChain = (chainId: number): Hex => {
    if (chainId === ctx.destinationChainId && ctx.destinationDirectEoa) return ctx.eoaAddress;
    if (chainId !== ctx.destinationChainId) return ctx.ephemeralWallet.address;
    return predictSafeAccountAddressV2(ctx.eoaAddress, ctx.ephemeralWallet.address).address;
  };

  const perChainResults = await Promise.all(
    failedChains.map(async ({ chainId, chainSwaps }) => {
      const userAddress = predictSafeAccountAddressV2(
        ctx.eoaAddress,
        ctx.ephemeralWallet.address
      ).address;
      const sourceRecipient = recipientForChain(chainId);

      const requoted = await Promise.all(
        chainSwaps.map(async (swap) => {
          const requests = [
            {
              type: QuoteType.EXACT_IN as const,
              seriousness: QuoteSeriousness.SERIOUS,
              chainId: swap.chainID,
              inputToken: swap.quote.input.contractAddress,
              outputToken: swap.quote.output.contractAddress,
              inputAmount: swap.holding.amountRaw,
              userAddress,
              recipientAddress: sourceRecipient,
            },
          ];
          const [requote] = swap.quote.routerId
            ? await swap.aggregator.getQuotes(requests, [swap.quote.routerId])
            : await swap.aggregator.getQuotes(requests);

          if (!requote) {
            throw new ExternalServiceError(
              ERROR_CODES.EXTERNAL_SOURCE_SWAP_QUOTE_FAILED,
              `Source requote failed on chain ${swap.chainID}`,
              {
                context: {
                  service: aggregatorService(swap.aggregator),
                  stepId: createSourceSwapStepId(chainId),
                  stepType: 'source_swap',
                  chainId: swap.chainID,
                },
              }
            );
          }

          return {
            ...swap,
            quote: requote,
          };
        })
      );

      return [chainId, requoted] as const;
    })
  );

  // EXACT_IN (null buffer): accept the re-quote unconditionally — no pooled drift check.
  if (srcBuffer === null) return perChainResults;

  // All routes that reach this executor liquidate into one settlement currency. Path A's tagged
  // token/gas legs use the direct-destination executor and never reach this pooled drift check.
  const sumOutputs = (groups: Iterable<QuoteResponse[]>): Decimal => {
    let total = new Decimal(0);
    for (const swaps of groups) {
      for (const swap of swaps) {
        total = total.add(divDecimals(swap.quote.output.amountRaw, swap.quote.output.decimals));
      }
    }
    return total;
  };

  const oldTotal = sumOutputs(failedChains.map((chain) => chain.chainSwaps));
  const newTotal = sumOutputs(perChainResults.map(([, requoted]) => requoted));
  const minAcceptable = oldTotal.minus(srcBuffer);
  const firstFailedChain = failedChains[0];
  const firstSwap = firstFailedChain?.chainSwaps[0];
  const contractAddress = firstSwap?.quote.output.contractAddress;
  logger.debug('swap.execute.source.requote_buffer.checked', {
    outputToken: contractAddress,
    oldTotal: oldTotal.toFixed(),
    newTotal: newTotal.toFixed(),
    buffer: srcBuffer.toFixed(),
    minAcceptable: minAcceptable.toFixed(),
  });
  if (newTotal.lt(minAcceptable)) {
    throw new ExternalServiceError(
      ERROR_CODES.EXTERNAL_RATES_DRIFT_EXCEEDED,
      `Source requote exceeded the drift budget for ${contractAddress}: dropped from ${oldTotal.toFixed()} to ${newTotal.toFixed()} (buffer ${srcBuffer.toFixed()})`,
      {
        context: {
          service: firstSwap ? aggregatorService(firstSwap.aggregator) : 'lifi',
          stepId: createSourceSwapStepId(firstFailedChain?.chainId ?? 0),
          stepType: 'source_swap',
          chainId: firstFailedChain?.chainId,
        },
        details: {
          outputToken: contractAddress,
          oldTotalOutput: oldTotal.toFixed(),
          newTotalOutput: newTotal.toFixed(),
          srcBuffer: srcBuffer.toFixed(),
          minAcceptable: minAcceptable.toFixed(),
          failedChainIds: failedChains.map((f) => f.chainId).join(','),
        },
      }
    );
  }

  return perChainResults;
};

// ---------------------------------------------------------------------------
// executeSourceSwaps
// ---------------------------------------------------------------------------

/**
 * Executes source swaps across all chains.
 *
 * Every chain executes through the deterministic V2 Safe.
 *
 * Returns BridgeAsset[] tagged as ephemeral balance — bridge funding always flows through the
 * ephemeral identity, regardless of the per-chain wrapper that produced the output.
 */
export const executeSourceSwaps = async (
  source: {
    swaps: QuoteResponse[];
    creationTime: number;
    cotByChain?: Map<number, SourceChainCOT>;
    srcBuffer: Decimal | null;
    reclaimFromActualBalance?: boolean;
  },
  ctx: Pick<
    ExecutionContext,
    | 'chainList'
    | 'sourceExecutionPaths'
    | 'destinationDirectEoa'
    | 'eoaAddress'
    | 'eoaWallet'
    | 'ephemeralWallet'
    | 'publicClientList'
    | 'middlewareClient'
    | 'cache'
    | 'preparedExecution'
    | 'onProgress'
    | 'timing'
    | 'slippage'
  > & { destinationChainId: number },
  metadata: SwapMetadata
): Promise<BridgeAsset[]> => {
  if (source.swaps.length === 0) return [];

  // Group swaps by chainId
  const byChain = new Map<number, QuoteResponse[]>();
  for (const swap of source.swaps) {
    let bucket = byChain.get(swap.chainID);
    if (!bucket) {
      bucket = [];
      byChain.set(swap.chainID, bucket);
    }
    bucket.push(swap);
  }

  const confirmedResults = new Map<number, ConfirmedSourceChain>();
  let pendingChains = new Map(
    [...byChain.entries()].map(([chainId, chainSwaps]) => [chainId, sortSourceSwaps(chainSwaps)])
  );
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 2 && pendingChains.size > 0; attempt++) {
    logger.debug('swap.execute.source.attempt.started', {
      attempt,
      chains: [...pendingChains.keys()],
    });

    const pendingEntries = [...pendingChains.entries()];
    const dispatchResults: PromiseSettledResult<DispatchedSourceChain>[] = [];

    for (const [chainId, chainSwaps] of pendingEntries) {
      let phase: 'authorization' | 'dispatch' = 'authorization';
      try {
        const walletPath: WalletPath = 'safe';
        const calls = await withTimingSpan(
          ctx.timing,
          'flow.swap.execute.source.build_calls',
          async () => buildSourceCalls(chainSwaps, ctx, chainId),
          {
            tags: {
              attempt,
              wallet_path: walletPath,
              source_leg_count: chainSwaps.length,
            },
          }
        );
        phase = 'dispatch';
        const nativeValue = calls.reduce((sum, call) => sum + call.value, 0n);
        const dispatched = await withTimingSpan(
          ctx.timing,
          'flow.swap.execute.source.dispatch',
          async () => dispatchSourceChainBatch({ chainId, calls, nativeValue, ctx }),
          { tags: { attempt, wallet_path: walletPath } }
        );
        dispatchResults.push({
          status: 'fulfilled',
          value: { ...dispatched, chainSwaps },
        });
      } catch (error) {
        const normalized = isUserRejectedRequest(error)
          ? phase === 'authorization'
            ? Errors.userRejectedAllowance()
            : Errors.userRejectedTxSend()
          : error;
        dispatchResults.push({
          status: 'rejected',
          reason: normalized,
        });
      }
    }

    const dispatchedChains: DispatchedSourceChain[] = [];
    const failedChains: Array<{ chainId: number; chainSwaps: QuoteResponse[]; error: Error }> = [];

    dispatchResults.forEach((result, index) => {
      const [chainId, chainSwaps] = pendingEntries[index];
      if (result.status === 'fulfilled') {
        dispatchedChains.push(result.value);
        return;
      }
      failedChains.push({
        chainId,
        chainSwaps,
        error: result.reason instanceof Error ? result.reason : new Error(String(result.reason)),
      });
    });

    const receiptResults = await withTimingSpan(
      ctx.timing,
      'flow.swap.execute.source.wait_receipt',
      async () =>
        Promise.allSettled(
          dispatchedChains.map(async (entry) => ({
            ...entry,
            txHash: await entry.waitForReceipt(),
          }))
        ),
      { tags: { attempt, source_chain_count: dispatchedChains.length } }
    );

    receiptResults.forEach((result, index) => {
      const dispatched = dispatchedChains[index];
      if (result.status === 'fulfilled') {
        const txHash = result.value.txHash;
        const explorerUrl =
          dispatched.submittedExplorerUrl ??
          createExplorerTxURL(txHash, dispatched.explorerBaseUrl);

        if (!dispatched.submittedTxHash) {
          ctx.onProgress?.({
            stepType: 'source_swap',
            chainId: dispatched.chainId,
            state: 'submitted',
            txHash,
            explorerUrl,
          });
        }

        ctx.onProgress?.({
          stepType: 'source_swap',
          chainId: dispatched.chainId,
          state: 'confirmed',
          txHash,
          explorerUrl,
        });

        confirmedResults.set(dispatched.chainId, {
          ...result.value,
          explorerBaseUrl: dispatched.explorerBaseUrl,
          submittedExplorerUrl: explorerUrl,
          submittedTxHash: txHash,
        });
        return;
      }
      failedChains.push({
        chainId: dispatched.chainId,
        chainSwaps: dispatched.chainSwaps,
        error: result.reason instanceof Error ? result.reason : new Error(String(result.reason)),
      });
    });

    if (failedChains.length === 0) {
      pendingChains = new Map();
      break;
    }

    const terminalFailure = failedChains.find(({ error }) => error instanceof UserActionError);
    if (terminalFailure) {
      ctx.onProgress?.({
        stepType: 'source_swap',
        chainId: terminalFailure.chainId,
        state: 'failed',
        error: formatUnknownError(terminalFailure.error),
      });
      throw terminalFailure.error;
    }

    lastError = failedChains[0].error;

    if (attempt === 0) {
      const requoted = await withTimingSpan(
        ctx.timing,
        'flow.swap.execute.source.requote',
        async () =>
          requoteFailedChains(
            failedChains.map(({ chainId, chainSwaps }) => ({ chainId, chainSwaps })),
            source.srcBuffer,
            ctx
          ),
        { tags: { attempt, source_chain_count: failedChains.length } }
      );
      pendingChains = new Map(requoted);
      continue;
    }

    const failedChain = failedChains[0];
    if (!failedChain) {
      throw lastError ?? new Error('Source execution failed');
    }
    const formattedError = formatUnknownError(failedChain.error);
    ctx.onProgress?.({
      stepType: 'source_swap',
      chainId: failedChain.chainId,
      state: 'failed',
      error: formattedError,
    });
    // Categorized requote/quote failures from requoteFailedChains keep their identity.
    // Only synthesize a generic execution wrapper for genuinely uncategorized causes.
    if (failedChain.error instanceof NexusError) {
      throw failedChain.error;
    }
    throw new ExecutionError(ERROR_CODES.EXECUTION_ERROR, formattedError, {
      context: {
        service: 'wallet',
        stepId: createSourceSwapStepId(failedChain.chainId),
        stepType: 'source_swap',
        chainId: failedChain.chainId,
      },
    });
  }

  if (pendingChains.size > 0) {
    const [chainId] = [...pendingChains.keys()];
    const finalError = lastError ?? new Error('Source execution failed');
    const formattedError = formatUnknownError(finalError);
    ctx.onProgress?.({
      stepType: 'source_swap',
      chainId,
      state: 'failed',
      error: formattedError,
    });
    if (finalError instanceof NexusError) {
      throw finalError;
    }
    throw new ExecutionError(ERROR_CODES.EXECUTION_ERROR, formattedError, {
      context: {
        service: 'wallet',
        stepId: createSourceSwapStepId(chainId),
        stepType: 'source_swap',
        chainId,
      },
    });
  }

  const sortedEntries = [...confirmedResults.values()].sort(
    (left, right) => left.chainId - right.chainId
  );

  for (const entry of sortedEntries) {
    metadata.src.push({
      chid: entry.chainId,
      swaps: entry.chainSwaps.map((swap) => ({
        inputAmount: swap.quote.input.amountRaw,
        inputContract: swap.quote.input.contractAddress,
        inputDecimals: swap.quote.input.decimals,
        outputAmount: swap.quote.output.amountRaw,
        outputContract: swap.quote.output.contractAddress,
        outputDecimals: swap.quote.output.decimals,
      })),
      tx_hash: entry.txHash,
    });
  }

  // Bridge funding flows through the ephemeral identity regardless of the source executor; the
  // asset is always tagged ephemeral here. EXACT_IN reclaim reads the actual source COT holder so
  // positive source slippage bridges through instead of being swept at the source.
  return Promise.all(
    sortedEntries.map(async (entry) => {
      const cot = source.cotByChain?.get(entry.chainId);
      // Best-effort: a failed balance read falls back to the quote floor — loses the slippage
      // reclaim but never fails the swap, symmetric with the destination reclaim.
      let overrideBalanceRaw: bigint | undefined;
      if (source.reclaimFromActualBalance) {
        try {
          overrideBalanceRaw = await withTimingSpan(
            ctx.timing,
            'flow.swap.execute.source.read_actual_balance',
            async () =>
              readSourceCotBalanceRaw(
                entry.chainId,
                cot?.contractAddress ?? entry.chainSwaps[0].quote.output.contractAddress,
                ctx
              ),
            {
              tags: {
                wallet_path: 'safe',
              },
            }
          );
        } catch (error) {
          logger.debug('swap.execute.source.actual_balance.skipped', {
            chainId: entry.chainId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return buildBridgeAsset(entry.chainId, entry.chainSwaps, cot, overrideBalanceRaw);
    })
  );
};
