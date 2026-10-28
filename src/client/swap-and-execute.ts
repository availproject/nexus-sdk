import type { Hex, WalletClient } from 'viem';
import { z } from 'zod';
import type { AnalyticsManager } from '../analytics/AnalyticsManager';
import { NexusAnalyticsEvents } from '../analytics/events';
import { type ChainListType, type ExecuteParams, ZERO_ADDRESS } from '../domain';
import ERC20ABI from '../domain/erc20-abi';
import { ERROR_CODES, Errors, formatUnknownError, ValidationError } from '../domain/errors';
import { addressString, parseInput, positiveInt } from '../domain/validation';
import type { ExecuteDeps } from '../execute/deps';
import {
  executeParamsSchema,
  execute as flowExecute,
  prepareExecuteFunding,
  priceExecuteFunding,
} from '../execute/execute';
import type { IntentCatalog } from '../intent/catalog';
import {
  calculateIntentFunding,
  filterFundingBalances,
  formatFundingAmount,
} from '../intent/funding';
import type { MiddlewareClient } from '../intent/middleware';
import { assertIntentQuoteFresh, runIntent } from '../intent/orchestrator';
import type {
  SwapAndExecuteParams,
  SwapExactInParams,
  SwapExactOutParams,
} from '../intent/swap-types';
import type { IntentReporting } from '../intent/telemetry';
import type {
  IntentBalance,
  IntentBalancesResult,
  IntentEvent,
  IntentQuoteRequest,
  IntentSource,
  IntentToken,
  SwapAndExecuteIntent,
  SwapAndExecuteIntentResult,
} from '../intent/types';
import { isNativeAddress } from '../services/addresses';
import { runNonBlocking } from '../services/non-blocking';
import { equalFold } from '../services/strings';
import type { SwapAndExecuteOptions, SwapOperationOptions } from './types';

const positiveAmount = z
  .bigint({ error: 'must be a positive bigint' })
  .positive({ error: 'must be a positive bigint' });
const sourceSchema = z.object({
  chainId: positiveInt,
  tokenAddress: addressString.optional(),
});
const exactInputSourcesSchema = z
  .array(
    sourceSchema.extend({
      tokenAddress: addressString,
      amountRaw: z
        .bigint({
          error: (issue) =>
            issue.input === undefined
              ? 'exact-input swap requires amountRaw on every source'
              : 'source amountRaw must be a bigint',
        })
        .positive({ error: 'source amountRaw must be greater than zero' }),
    }),
    { error: 'exact-input swap requires sources' }
  )
  .min(1, { error: 'exact-input swap requires sources' });
const exactOutputSourcesSchema = z.array(sourceSchema).optional();
const swapAndExecuteFields = {
  toChainId: positiveInt,
  toTokenAddress: addressString,
  execute: executeParamsSchema.omit({ toChainId: true }).extend({ gas: positiveAmount }),
};
const swapAndExecuteSchema = z.discriminatedUnion('tradeType', [
  z.object({
    ...swapAndExecuteFields,
    tradeType: z.literal('exactInput'),
    sources: exactInputSourcesSchema,
    toAmountRaw: z.undefined({ error: 'is only supported for exactOutput' }).optional(),
  }),
  z.object({
    ...swapAndExecuteFields,
    tradeType: z.literal('exactOutput').optional(),
    sources: exactOutputSourcesSchema,
    toAmountRaw: positiveAmount,
  }),
]);

const validateSwapAndExecuteInput = (input: SwapAndExecuteParams) => {
  parseInput(swapAndExecuteSchema, input);
};

const parseSwapAndExecuteSources = (sources: IntentSource[] | undefined, exactInput: boolean) =>
  exactInput
    ? { exactInput: true as const, sources: parseInput(exactInputSourcesSchema, sources) }
    : { exactInput: false as const, sources: parseInput(exactOutputSourcesSchema, sources) };

type SwapAndExecuteDependencies = {
  state: { analytics?: AnalyticsManager; middlewareClient: MiddlewareClient };
  getEvm: () => { client: WalletClient; address: Hex };
  getChainList: () => ChainListType;
  getIntentCatalog: () => IntentCatalog;
  loadExecuteToken: (params: ExecuteParams) => Promise<void>;
  exactInRequest: (
    input: SwapExactInParams,
    sender: Hex,
    options?: SwapOperationOptions,
    sources?: IntentSource[]
  ) => Promise<IntentQuoteRequest>;
  exactOutRequest: (
    input: SwapExactOutParams,
    options?: SwapOperationOptions,
    sources?: IntentSource[]
  ) => Promise<IntentQuoteRequest>;
  intentRuntime: (attemptId?: string) => Parameters<typeof runIntent>[1];
};

type SwapAndExecuteContext = Pick<
  SwapAndExecuteDependencies,
  'state' | 'exactInRequest' | 'exactOutRequest'
> & {
  input: SwapAndExecuteParams;
  options?: SwapAndExecuteOptions;
  reporting?: IntentReporting;
  exactInput: boolean;
  executeParams: ExecuteParams & { gas: bigint };
  updateApprovalAmount: boolean;
  deps: ExecuteDeps;
  prepared: Awaited<ReturnType<typeof prepareExecuteFunding>>;
  snapshot: IntentBalancesResult;
  token: IntentToken;
  outputIsNative: boolean;
};

const matchesDestination = (source: IntentSource, context: SwapAndExecuteContext) => {
  const { input, outputIsNative, token } = context;
  return (
    source.chainId === input.toChainId &&
    source.tokenAddress !== undefined &&
    (outputIsNative
      ? isNativeAddress(source.tokenAddress)
      : equalFold(source.tokenAddress, token.address))
  );
};

const buildPreview = async (context: SwapAndExecuteContext, sources?: IntentSource[]) => {
  const {
    input,
    options,
    reporting,
    exactInput,
    executeParams,
    updateApprovalAmount,
    deps,
    prepared,
    snapshot,
    token,
    outputIsNative,
    state,
    exactInRequest,
    exactOutRequest,
  } = context;
  const native = prepared.dstChain.nativeCurrency;
  const selection = parseSwapAndExecuteSources(sources, exactInput);
  const selected = selection.sources;
  let localAmountRaw = 0n;
  const swapSources: IntentSource[] | undefined = selection.exactInput
    ? selection.sources.filter((source) => {
        if (!matchesDestination(source, context)) return true;
        localAmountRaw += source.amountRaw;
        return false;
      })
    : selected;
  const inputRequest =
    input.tradeType === 'exactInput' && swapSources?.length
      ? await exactInRequest(
          input,
          deps.evm.address,
          { slippageBps: options?.slippageBps },
          swapSources
        )
      : undefined;
  const balances = exactInput
    ? snapshot.balances
    : filterFundingBalances(snapshot.balances, selected);
  const tokenEntry = balances.find(
    (entry) =>
      entry.chainId === input.toChainId &&
      (outputIsNative ? entry.isNative : equalFold(entry.tokenAddress, token.address))
  );
  const nativeEntry = balances.find((entry) => entry.chainId === input.toChainId && entry.isNative);
  const availableBalance = (entry?: IntentBalance) => {
    if (!entry) return 0n;
    const spent = exactInput
      ? (swapSources?.reduce(
          (total, source) =>
            source.chainId === entry.chainId &&
            source.tokenAddress &&
            (entry.isNative
              ? isNativeAddress(source.tokenAddress)
              : equalFold(source.tokenAddress, entry.tokenAddress))
              ? total + (source.amountRaw ?? 0n)
              : total,
          0n
        ) ?? 0n)
      : 0n;
    const remaining = entry.usableBalanceRaw - spent;
    return remaining > 0n ? remaining : 0n;
  };
  const walletTokenBalance = availableBalance(tokenEntry);
  const tokenBalance =
    exactInput && localAmountRaw < walletTokenBalance ? localAmountRaw : walletTokenBalance;
  const nativeBalance = availableBalance(nativeEntry);
  const previewPrepared =
    updateApprovalAmount && !inputRequest && executeParams.tokenApproval
      ? await prepareExecuteFunding(
          {
            ...executeParams,
            tokenApproval: { ...executeParams.tokenApproval, amount: localAmountRaw },
          },
          deps
        )
      : prepared;
  const priced = await priceExecuteFunding(previewPrepared);
  const fundingInput = {
    outputIsNative,
    outputBalanceRaw: tokenBalance,
    executeValueRaw: executeParams.value ?? 0n,
    estimatedGasCostRaw: priced.estimatedTotalCost,
    nativeBalanceRaw: nativeBalance,
  };
  const funding = calculateIntentFunding({
    ...fundingInput,
    outputAmountRaw: input.toAmountRaw ?? 0n,
    ...(exactInput && outputIsNative
      ? {
          nativeBalanceRaw: nativeBalance > localAmountRaw ? nativeBalance - localAmountRaw : 0n,
        }
      : {}),
  });
  if (exactInput && !inputRequest && funding.gasDropRaw > 0n) {
    throw new ValidationError(
      ERROR_CODES.INSUFFICIENT_BALANCE,
      'Native balance cannot cover execution without a swap',
      { context: { chainId: input.toChainId } }
    );
  }
  const quoteRequest = inputRequest
    ? {
        ...inputRequest,
        ...(funding.gasDropRaw > 0n ? { gasDrop: { amount: funding.gasDropRaw.toString() } } : {}),
      }
    : exactInput || (funding.outputAmountRaw === 0n && funding.gasDropRaw === 0n)
      ? undefined
      : await exactOutRequest(
          {
            toChainId: input.toChainId,
            toTokenAddress: token.address,
            toAmountRaw: funding.outputAmountRaw,
            toNativeAmountRaw: funding.gasDropRaw,
            sources: selected,
          },
          { slippageBps: options?.slippageBps }
        );
  const executable = quoteRequest
    ? await state.middlewareClient.getIntentQuote(quoteRequest, reporting?.attemptId)
    : undefined;
  if (executable) assertIntentQuoteFresh(executable, Date.now());
  let outputAmountRaw = input.toAmountRaw ?? 0n;
  if (exactInput) {
    const reservedNativeRaw = outputIsNative ? funding.outputAmountRaw : 0n;
    const minimumAmountRaw = (executable?.quote.output.minAmountRaw ?? 0n) + localAmountRaw;
    if (minimumAmountRaw < reservedNativeRaw) {
      throw new ValidationError(
        ERROR_CODES.INSUFFICIENT_BALANCE,
        'Exact-input minimum native output cannot cover execution value and gas',
        { context: { chainId: input.toChainId } }
      );
    }
    outputAmountRaw = minimumAmountRaw - reservedNativeRaw;
  }
  const previewFunding = exactInput
    ? calculateIntentFunding({ ...fundingInput, outputAmountRaw })
    : funding;
  const tokenReference =
    tokenEntry?.valueUsd != null && tokenEntry.usableBalanceRaw > 0n
      ? { amountRaw: tokenEntry.usableBalanceRaw, valueUsd: String(tokenEntry.valueUsd) }
      : executable && {
          amountRaw: executable.quote.output.amountRaw,
          valueUsd: executable.quote.output.amountUsd,
        };
  const nativeReference = outputIsNative
    ? tokenReference
    : nativeEntry && {
        amountRaw: nativeEntry.usableBalanceRaw,
        valueUsd: nativeEntry.valueUsd == null ? undefined : String(nativeEntry.valueUsd),
      };
  const tokenAmount = (raw: bigint) => formatFundingAmount(raw, token.decimals, tokenReference);
  const nativeAmount = (raw: bigint) => formatFundingAmount(raw, native.decimals, nativeReference);
  const tokenShortfall = outputAmountRaw > tokenBalance ? outputAmountRaw - tokenBalance : 0n;
  const gasShortfall = outputIsNative
    ? previewFunding.outputAmountRaw - tokenShortfall
    : previewFunding.gasDropRaw;
  const approval = priced.approvalContext;
  const intent: SwapAndExecuteIntent = {
    executeRequirement: {
      chain: {
        id: prepared.dstChain.id,
        name: prepared.dstChain.name,
        logo: prepared.dstChain.custom.icon,
      },
      to: executeParams.to,
      token: {
        address: token.address,
        symbol: token.symbol,
        decimals: token.decimals,
        ...tokenAmount(outputAmountRaw),
      },
      gas: {
        address: ZERO_ADDRESS,
        symbol: native.symbol,
        decimals: native.decimals,
        ...nativeAmount(priced.estimatedTotalCost),
        estimatedGasUnits: priced.tx.gas,
        approvalGasUnits: priced.approvalTx?.gas ?? 0n,
        feeParams: priced.feeParams,
        l1FeeRaw: priced.l1Fee,
        priceTier: prepared.priceTier,
      },
      nativeValue: executeParams.value ? nativeAmount(executeParams.value) : null,
      tokenApproval: approval
        ? {
            token: {
              address: approval.token.contractAddress,
              symbol: approval.token.symbol,
              decimals: approval.token.decimals,
            },
            ...formatFundingAmount(
              updateApprovalAmount ? outputAmountRaw : approval.amount,
              approval.token.decimals
            ),
            spender: approval.spender,
          }
        : null,
    },
    available: { token: tokenAmount(tokenBalance), gas: nativeAmount(nativeBalance) },
    shortfall: { token: tokenAmount(tokenShortfall), gas: nativeAmount(gasShortfall) },
    ...(executable ? { swapRequired: true, quote: executable.quote } : { swapRequired: false }),
  };
  return { intent, executable, priced, sources: selected, localAmountRaw };
};

type SwapAndExecutePreview = Awaited<ReturnType<typeof buildPreview>>;

const emitQuote = (
  preview: SwapAndExecutePreview,
  options?: SwapAndExecuteOptions,
  reporting?: IntentReporting
) => {
  if (!preview.executable) return;
  const event: IntentEvent = { type: 'quote', quote: preview.executable.quote };
  reporting?.observe(event);
  runNonBlocking('IntentEventEmitFailed', () => options?.onEvent?.(event), {
    eventType: event.type,
  });
};

const reviewIntent = async (
  initial: SwapAndExecutePreview,
  context: SwapAndExecuteContext
): Promise<SwapAndExecutePreview> => {
  const { options, reporting } = context;
  let current = initial;
  emitQuote(current, options, reporting);
  const onIntent = options?.hooks?.onIntent;
  if (onIntent) {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let accepting = false;
      let pending = Promise.resolve();
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      const allow = () => {
        if (settled || accepting) return;
        accepting = true;
        void pending.then(() => {
          if (settled) return;
          settled = true;
          resolve();
        });
      };
      const refresh = (sources?: IntentSource[]) => {
        if (settled || accepting) return Promise.resolve(current.intent);
        const selected = sources?.map((source) => ({ ...source }));
        const next = pending.then(async () => {
          if (settled) return current.intent;
          try {
            const updated = await buildPreview(context, selected ?? current.sources);
            if (!settled) {
              current = updated;
              emitQuote(current, options, reporting);
            }
            return current.intent;
          } catch (error) {
            reporting?.refreshFailed(error);
            throw error;
          }
        });
        pending = next.then(
          () => undefined,
          () => undefined
        );
        return next;
      };
      try {
        Promise.resolve(
          onIntent({
            intent: current.intent,
            allow,
            deny: () => fail(Errors.userDeniedIntent()),
            refresh,
            ...(reporting ? { attemptId: reporting.attemptId } : {}),
          })
        ).catch(fail);
      } catch (error) {
        fail(error);
      }
    });
  }
  return current;
};

const readDestinationBalance = async (context: SwapAndExecuteContext) => {
  const { outputIsNative, prepared, token, input, deps } = context;
  try {
    return outputIsNative
      ? await prepared.dstPublicClient.getBalance({ address: deps.evm.address })
      : await prepared.dstPublicClient.readContract({
          address: token.address,
          abi: ERC20ABI,
          functionName: 'balanceOf',
          args: [deps.evm.address],
        });
  } catch (error) {
    throw Errors.execution(`Failed to read destination balance: ${formatUnknownError(error)}`, {
      service: 'rpc',
      chainId: input.toChainId,
    });
  }
};

export const createSwapAndExecute = ({
  state,
  getEvm,
  getChainList,
  getIntentCatalog,
  loadExecuteToken,
  exactInRequest,
  exactOutRequest,
  intentRuntime,
}: SwapAndExecuteDependencies) => {
  const swapAndExecute = async (
    input: SwapAndExecuteParams,
    options?: SwapAndExecuteOptions,
    reporting?: IntentReporting
  ): Promise<SwapAndExecuteIntentResult> => {
    validateSwapAndExecuteInput(input);
    const exactInput = input.tradeType === 'exactInput';
    const evm = getEvm();
    const executeParams = { ...input.execute, toChainId: input.toChainId };
    const updateApprovalAmount =
      exactInput &&
      executeParams.tokenApproval !== undefined &&
      equalFold(executeParams.tokenApproval.toTokenAddress, input.toTokenAddress);
    const deps = {
      chainList: getChainList(),
      evm: { walletClient: evm.client, address: evm.address },
      timing: state.analytics?.scopedTimingHooks(reporting?.attemptId),
    };
    await loadExecuteToken(executeParams);
    const [prepared, snapshot, token] = await Promise.all([
      updateApprovalAmount
        ? prepareExecuteFunding(executeParams, deps, true)
        : prepareExecuteFunding(executeParams, deps),
      state.middlewareClient.getIntentBalances(evm.address, {
        refresh: true,
        ...(reporting ? { attemptId: reporting.attemptId } : {}),
      }),
      getIntentCatalog().getToken(input.toChainId, input.toTokenAddress),
    ]);
    if (snapshot.errored) {
      state.analytics?.reportEvent(NexusAnalyticsEvents.BALANCES_FETCH_PARTIAL, {
        ...reporting?.properties(),
        'balances.partial': true,
        'balances.count': snapshot.balances.length,
      });
    }
    const outputIsNative = token.isNative || isNativeAddress(token.address);
    const context: SwapAndExecuteContext = {
      input,
      options,
      reporting,
      exactInput,
      executeParams,
      updateApprovalAmount,
      deps,
      prepared,
      snapshot,
      token,
      outputIsNative,
      state,
      exactInRequest,
      exactOutRequest,
    };
    const preview = await buildPreview(context, input.sources);
    const current = await reviewIntent(preview, context);
    const measureReceived = exactInput || options?.beforeExecute !== undefined;
    const balanceBefore = measureReceived ? await readDestinationBalance(context) : 0n;
    if (exactInput && balanceBefore < current.localAmountRaw) {
      throw new ValidationError(
        ERROR_CODES.INSUFFICIENT_BALANCE,
        'Selected destination-token amount is no longer available',
        { context: { chainId: input.toChainId } }
      );
    }
    const acceptedQuote = current.executable;
    const swapResult = acceptedQuote
      ? await runIntent(
          {
            requestQuote: async () => acceptedQuote,
            quoteAlreadyEmitted: true,
            reporting,
            onEvent: options?.onEvent,
            pollingIntervalMs: options?.pollingIntervalMs,
            timeoutMs: (options?.fillTimeoutMinutes ?? 2) * 60_000,
          },
          intentRuntime(reporting?.attemptId)
        )
      : undefined;
    if (!swapResult) reporting?.skip();
    const balanceAfter =
      measureReceived && swapResult ? await readDestinationBalance(context) : balanceBefore;
    // shortcut: balance differences include unrelated transfers; use intent-specific transfers when available.
    const receivedAmountRaw = balanceAfter - balanceBefore;
    if (exactInput && swapResult && receivedAmountRaw <= 0n) {
      throw new ValidationError(
        ERROR_CODES.INSUFFICIENT_BALANCE,
        'Destination balance did not increase after fulfillment',
        { context: { chainId: input.toChainId } }
      );
    }
    const nativeAvailable = balanceBefore - current.localAmountRaw;
    const nativeRequired = (executeParams.value ?? 0n) + current.priced.estimatedTotalCost;
    const reservedNativeRaw =
      exactInput && outputIsNative && nativeRequired > nativeAvailable
        ? nativeRequired - nativeAvailable
        : 0n;
    const executeAmountRaw = exactInput
      ? receivedAmountRaw + current.localAmountRaw - reservedNativeRaw
      : input.toAmountRaw;
    if (exactInput && executeAmountRaw <= 0n) {
      throw new ValidationError(
        ERROR_CODES.INSUFFICIENT_BALANCE,
        'Destination funds cannot cover execution value and gas',
        { context: { chainId: input.toChainId } }
      );
    }
    const finalParams = {
      ...executeParams,
      gas: current.priced.tx.gas,
      ...(await options?.beforeExecute?.({ receivedAmountRaw, executeAmountRaw })),
      ...(updateApprovalAmount && executeParams.tokenApproval
        ? {
            tokenApproval: { ...executeParams.tokenApproval, amount: executeAmountRaw },
          }
        : {}),
    };
    const executed = await flowExecute(finalParams, deps, current.priced, updateApprovalAmount);
    return swapResult
      ? { swapSkipped: false, swapResult, approval: executed.approval, execute: executed.execute }
      : { swapSkipped: true, approval: executed.approval, execute: executed.execute };
  };

  return swapAndExecute;
};
