import Decimal from 'decimal.js';
import { erc20Abi, type Hex } from 'viem';
import { getLogger } from '../../domain';
import {
  ERROR_CODES,
  ExecutionError,
  ExternalServiceError,
  formatUnknownError,
  NexusError,
} from '../../domain/errors';
import { isNativeAddress } from '../../services/addresses';
import { confirmStepReceipt, switchChain } from '../../services/evm';
import { createExplorerTxURL } from '../../services/explorer';
import { divDecimals } from '../../services/math';
import {
  createCaliburExecuteTxFromCalls,
  createSBCTxFromCalls,
  requireSuccessfulSbcResult,
  type SBCCall,
} from '../../services/sbc';
import { createSourceSwapStepId } from '../../services/step-ids';
import { equalFold } from '../../services/strings';
import { aggregatorService } from '../aggregators';
import { type QuoteResponse, QuoteSeriousness, QuoteType } from '../aggregators/types';
import { predictSafeAccountAddress } from '../safe/predict';
import type {
  BridgeAsset,
  ExecutionContext,
  PreparedEoaToEphemeralTransfer,
  SourceChainCOT,
  SwapMetadata,
  WalletPath,
} from '../types';
import { chainSupports7702 } from '../wallet/capabilities';
import { resolvePreparedFundingTransferCalls } from './eoa-to-ephemeral';
import { getParsedQuote } from './parsed-quote';
import { dispatchSafeSource } from './safe-dispatch';

const logger = getLogger();

type DispatchedSourceChain = {
  chainId: number;
  chainName?: string;
  chainSwaps: QuoteResponse[];
  walletPath: WalletPath;
  explorerBaseUrl?: string;
  submittedTxHash?: Hex;
  submittedExplorerUrl?: string;
  waitForReceipt: () => Promise<Hex>;
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
  >,
  chainId: number
): Promise<SBCCall[]> => {
  const calls: SBCCall[] = [];
  const usedTransfers = new Set<string>();
  const publicClient = ctx.publicClientList.get(chainId);
  const chain = ctx.chainList.getChainByID(chainId);

  for (const swap of sortSourceSwaps(chainSwaps)) {
    const parsedQuote = getParsedQuote(swap, ctx.preparedExecution?.parsedQuotes);
    const nativeInput = isNativeInput(swap);

    // ERC20 inputs are funded EOA → executor (ephemeral SBC or Safe) inside the same batch, so the
    // executor holds the token before it approves the aggregator router and swaps. The prepared
    // transfer's targetAddress is the executor for this chain's wallet path. Native inputs carry
    // their value via the SBC / Safe execTransaction, so they need no funding transfer.
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
  ownerWalletPath: WalletPath,
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

  // Swap output is always carried as the ephemeral identity for the RFF; the per-chain Safe
  // → ephemeral transfer happens inside the bridge deposit batch, not in this bookkeeping.
  void ownerWalletPath;
  return {
    chainID: chainId,
    contractAddress: cot?.contractAddress ?? chainSwaps[0].quote.output.contractAddress,
    decimals,
    eoaBalance: new Decimal(0),
    ephemeralBalance,
  };
};

// Read the COT that actually landed at the source wrapper after the swaps confirmed (ephemeral on
// 7702 chains, the predicted Safe on non-7702). Mirrors the targeted read in failure-cleanup.
const readWrapperCotBalanceRaw = async (
  chainId: number,
  cotAddress: Hex,
  ctx: Pick<ExecutionContext, 'chainList' | 'ephemeralWallet' | 'publicClientList'>
): Promise<bigint> => {
  const is7702 = chainSupports7702(ctx.chainList.getChainByID(chainId));
  const holder = is7702
    ? ctx.ephemeralWallet.address
    : predictSafeAccountAddress(ctx.ephemeralWallet.address).address;
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

const sourceSwapStep = (chainId: number) => ({
  stepId: createSourceSwapStepId(chainId),
  stepType: 'source_swap',
  label: 'Source swap',
});

// Re-quote source legs that reverted. For EXACT_OUT (`srcBuffer` non-null, COT units sizing
// `min(SRC_BUFFER_PCT, SRC_BUFFER_MAX_USD)` of the destination-buffered input) the combined
// output drop must fit inside that budget. EXACT_IN passes `null`: re-quote and proceed with
// no drift guard — Seam 2 re-sizes the dst swap to whatever COT actually lands.
const requoteFailedChains = async (
  failedChains: Array<{ chainId: number; chainSwaps: QuoteResponse[] }>,
  srcBuffer: Decimal | null,
  gasSrcBuffer: Decimal | undefined,
  ctx: Pick<
    ExecutionContext,
    'sourceExecutionPaths' | 'eoaAddress' | 'ephemeralWallet' | 'destinationDirectEoa'
  > & { destinationChainId: number }
) => {
  // Per-chain recipient: when the chain is the dst chain AND the route has no dst swap step,
  // the route quoted the source swap with recipient = EOA (direct delivery). Otherwise the
  // recipient is the chain's wrapper (Safe for non-7702, ephemeral for 7702).
  const recipientForChain = (chainId: number, walletPath: WalletPath): Hex => {
    if (chainId === ctx.destinationChainId && ctx.destinationDirectEoa) return ctx.eoaAddress;
    return walletPath === 'safe'
      ? predictSafeAccountAddress(ctx.ephemeralWallet.address).address
      : ctx.ephemeralWallet.address;
  };

  const perChainResults = await Promise.all(
    failedChains.map(async ({ chainId, chainSwaps }) => {
      const walletPath = ctx.sourceExecutionPaths.get(chainId) ?? 'ephemeral';
      const userAddress =
        walletPath === 'safe'
          ? predictSafeAccountAddress(ctx.ephemeralWallet.address).address
          : ctx.ephemeralWallet.address;
      const sourceRecipient = recipientForChain(chainId, walletPath);

      const requoted = await Promise.all(
        chainSwaps.map(async (swap) => {
          const [requote] = await swap.aggregator.getQuotes([
            {
              type: QuoteType.EXACT_IN,
              seriousness: QuoteSeriousness.SERIOUS,
              chainId: swap.chainID,
              inputToken: swap.quote.input.contractAddress,
              outputToken: swap.quote.output.contractAddress,
              inputAmount: swap.holding.amountRaw,
              userAddress,
              recipientAddress: sourceRecipient,
            },
          ]);

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

  // Pooled drift check, grouped per output token. A Path A batch mixes toToken legs (checked against
  // srcBuffer) and native gas legs (checked against gasSrcBuffer); a single native/gas token can't be
  // offset by a toToken over-quote. Every non-Path-A route has a single output token → one group,
  // reducing to the original `Σnew ≥ Σold − srcBuffer` check (byte-identical).
  const bufferForToken = (contractAddress: Hex): Decimal | null =>
    isNativeAddress(contractAddress) ? (gasSrcBuffer ?? null) : srcBuffer;

  const sumByToken = (
    groups: Iterable<QuoteResponse[]>
  ): Map<string, { total: Decimal; contractAddress: Hex }> => {
    const totals = new Map<string, { total: Decimal; contractAddress: Hex }>();
    for (const swaps of groups) {
      for (const swap of swaps) {
        const key = swap.quote.output.contractAddress.toLowerCase();
        const entry = totals.get(key) ?? {
          total: new Decimal(0),
          contractAddress: swap.quote.output.contractAddress,
        };
        entry.total = entry.total.add(
          divDecimals(swap.quote.output.amountRaw, swap.quote.output.decimals)
        );
        totals.set(key, entry);
      }
    }
    return totals;
  };

  const oldByToken = sumByToken(failedChains.map((chain) => chain.chainSwaps));
  const newByToken = sumByToken(perChainResults.map(([, requoted]) => requoted));

  for (const [key, { total: oldTotal, contractAddress }] of oldByToken) {
    const buffer = bufferForToken(contractAddress);
    if (buffer === null) continue; // no buffer for this output token → accept (e.g. an unbudgeted group)
    const newTotal = newByToken.get(key)?.total ?? new Decimal(0);
    const minAcceptable = oldTotal.minus(buffer);
    logger.debug('requoteFailedChains:bufferCheck', {
      outputToken: contractAddress,
      oldTotal: oldTotal.toFixed(),
      newTotal: newTotal.toFixed(),
      buffer: buffer.toFixed(),
      minAcceptable: minAcceptable.toFixed(),
    });
    if (newTotal.lt(minAcceptable)) {
      const firstFailedChain = failedChains[0];
      const firstSwap = firstFailedChain?.chainSwaps[0];
      throw new ExternalServiceError(
        ERROR_CODES.EXTERNAL_RATES_DRIFT_EXCEEDED,
        `Source requote exceeded the drift budget for ${contractAddress}: dropped from ${oldTotal.toFixed()} to ${newTotal.toFixed()} (buffer ${buffer.toFixed()})`,
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
            srcBuffer: buffer.toFixed(),
            minAcceptable: minAcceptable.toFixed(),
            failedChainIds: failedChains.map((f) => f.chainId).join(','),
          },
        }
      );
    }
  }

  return perChainResults;
};

// ---------------------------------------------------------------------------
// executeSourceSwaps
// ---------------------------------------------------------------------------

/**
 * Executes source swaps across all chains.
 *
 * Per-chain wrapper, based on the chain's 7702 support:
 *   - 'ephemeral' (Calibur SBC) for 7702 chains
 *   - 'safe' (Safe.execTransaction via middleware) for non-7702 chains
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
    // Path A only: the native gas legs' drift budget (native units). A Path A batch mixes toToken and
    // native-gas legs, so the pooled re-quote guard checks each output-token group against its own
    // buffer. Absent on every non-Path-A route (single output token → single group).
    gasSrcBuffer?: Decimal;
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
    logger.debug('executeSourceSwaps:attempt', {
      attempt,
      chains: [...pendingChains.keys()],
    });

    const pendingEntries = [...pendingChains.entries()];
    const dispatchResults: PromiseSettledResult<DispatchedSourceChain>[] = [];

    for (const [chainId, chainSwaps] of pendingEntries) {
      try {
        const walletPath: WalletPath = ctx.sourceExecutionPaths.get(chainId) ?? 'ephemeral';
        const chain = ctx.chainList.getChainByID(chainId);
        const calls = await buildSourceCalls(chainSwaps, ctx, chainId);
        const nativeValue = calls.reduce((sum, call) => sum + call.value, 0n);

        // Non-7702 chains use the Safe smart-account flow instead of Calibur SBC. Sponsor pays
        // gas via middleware when there's no native value to carry; otherwise the EOA submits
        // directly so it can fund the native send.
        if (chain && !chainSupports7702(chain)) {
          const publicClient = ctx.publicClientList.get(chainId);
          ctx.onProgress?.({
            stepType: 'source_swap',
            chainId,
            state: nativeValue > 0n ? 'wallet_prompted' : 'started',
          });
          const { txHash } = await dispatchSafeSource({
            chain,
            chainId,
            calls,
            nativeValue,
            ephemeralWallet: ctx.ephemeralWallet,
            eoaWallet: ctx.eoaWallet,
            eoaAddress: ctx.eoaAddress,
            publicClient,
            middleware: ctx.middlewareClient,
          });
          const explorerUrl = createExplorerTxURL(txHash, chain?.blockExplorers?.default?.url);
          ctx.onProgress?.({
            stepType: 'source_swap',
            chainId,
            state: 'submitted',
            txHash,
            explorerUrl,
          });
          dispatchResults.push({
            status: 'fulfilled',
            value: {
              chainId,
              chainName: chain?.name,
              chainSwaps,
              walletPath,
              explorerBaseUrl: chain?.blockExplorers?.default?.url,
              submittedTxHash: txHash,
              submittedExplorerUrl: explorerUrl,
              waitForReceipt: () =>
                confirmStepReceipt(publicClient, txHash, chainId, sourceSwapStep(chainId)),
            } satisfies DispatchedSourceChain,
          });
          continue;
        }

        const publicClient = ctx.publicClientList.get(chainId);
        if (nativeValue > 0n) {
          const hasDelegatedAuth =
            ctx.cache?.hasAuthCodeSet(ctx.ephemeralWallet.address, chainId) ?? false;
          if (!hasDelegatedAuth) {
            const bootstrapSbcTx = await createSBCTxFromCalls({
              calls: [],
              chainID: chainId,
              ephemeralAddress: ctx.ephemeralWallet.address,
              ephemeralWallet: ctx.ephemeralWallet,
              publicClient,
            });
            const bootstrapResults = await ctx.middlewareClient.submitSBCs([bootstrapSbcTx]);
            const bootstrapHash = requireSuccessfulSbcResult(
              bootstrapResults,
              chainId,
              'Native source auth bootstrap'
            );
            await confirmStepReceipt(publicClient, bootstrapHash, chainId, sourceSwapStep(chainId));
            ctx.cache?.markAuthCodeSet?.(ctx.ephemeralWallet.address, chainId);
          }

          ctx.onProgress?.({
            stepType: 'source_swap',
            chainId,
            state: 'wallet_prompted',
          });
          const tx = await createCaliburExecuteTxFromCalls({
            calls,
            chainID: chainId,
            ephemeralAddress: ctx.ephemeralWallet.address,
            ephemeralWallet: ctx.ephemeralWallet,
            value: nativeValue,
          });
          await switchChain(ctx.eoaWallet, chain);
          const txHash = await ctx.eoaWallet.sendTransaction({
            account: ctx.eoaAddress,
            to: tx.to,
            data: tx.data,
            value: tx.value,
            chain,
          });
          const explorerUrl = createExplorerTxURL(txHash, chain?.blockExplorers?.default?.url);
          ctx.onProgress?.({
            stepType: 'source_swap',
            chainId,
            state: 'submitted',
            txHash,
            explorerUrl,
          });

          dispatchResults.push({
            status: 'fulfilled',
            value: {
              chainId,
              chainName: chain?.name,
              chainSwaps,
              walletPath,
              explorerBaseUrl: chain?.blockExplorers?.default?.url,
              submittedTxHash: txHash,
              submittedExplorerUrl: explorerUrl,
              waitForReceipt: () =>
                confirmStepReceipt(publicClient, txHash, chainId, sourceSwapStep(chainId)),
            } satisfies DispatchedSourceChain,
          });
          continue;
        }

        ctx.onProgress?.({
          stepType: 'source_swap',
          chainId,
          state: 'started',
        });
        const sbcTx = await createSBCTxFromCalls({
          calls,
          chainID: chainId,
          ephemeralAddress: ctx.ephemeralWallet.address,
          ephemeralWallet: ctx.ephemeralWallet,
          publicClient,
        });

        const results = await ctx.middlewareClient.submitSBCs([sbcTx]);
        const txHash = requireSuccessfulSbcResult(results, chainId, 'Source swap SBC submission');
        const explorerUrl = createExplorerTxURL(txHash, chain?.blockExplorers?.default?.url);
        ctx.onProgress?.({
          stepType: 'source_swap',
          chainId,
          state: 'submitted',
          txHash,
          explorerUrl,
        });

        dispatchResults.push({
          status: 'fulfilled',
          value: {
            chainId,
            chainName: chain?.name,
            chainSwaps,
            walletPath,
            explorerBaseUrl: chain?.blockExplorers?.default?.url,
            submittedTxHash: txHash,
            submittedExplorerUrl: explorerUrl,
            waitForReceipt: () =>
              confirmStepReceipt(publicClient, txHash, chainId, sourceSwapStep(chainId)),
          } satisfies DispatchedSourceChain,
        });
      } catch (error) {
        dispatchResults.push({
          status: 'rejected',
          reason: error,
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

    const receiptResults = await Promise.allSettled(
      dispatchedChains.map(async (entry) => ({
        ...entry,
        txHash: await entry.waitForReceipt(),
      }))
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

    lastError = failedChains[0].error;

    if (attempt === 0) {
      const requoted = await requoteFailedChains(
        failedChains.map(({ chainId, chainSwaps }) => ({ chainId, chainSwaps })),
        source.srcBuffer,
        source.gasSrcBuffer,
        ctx
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

  // Bridge funding flows through the ephemeral identity regardless of the per-chain wrapper; the
  // asset is always tagged ephemeral here. EXACT_IN reclaim reads the actual wrapper COT balance so
  // positive source slippage bridges through instead of being swept at the source.
  return Promise.all(
    sortedEntries.map(async (entry) => {
      const cot = source.cotByChain?.get(entry.chainId);
      // Best-effort: a failed balance read falls back to the quote floor — loses the slippage
      // reclaim but never fails the swap, symmetric with the destination reclaim.
      let overrideBalanceRaw: bigint | undefined;
      if (source.reclaimFromActualBalance) {
        try {
          overrideBalanceRaw = await readWrapperCotBalanceRaw(
            entry.chainId,
            cot?.contractAddress ?? entry.chainSwaps[0].quote.output.contractAddress,
            ctx
          );
        } catch (error) {
          logger.debug('executeSourceSwaps:reclaim_skipped', {
            chainId: entry.chainId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return buildBridgeAsset(
        entry.chainId,
        entry.chainSwaps,
        'ephemeral',
        cot,
        overrideBalanceRaw
      );
    })
  );
};
