import Decimal from 'decimal.js';
import { type Hex, parseUnits } from 'viem';
import type {
  Chain,
  ChainListType,
  ExecutePlanStep,
  ExecuteRequirement,
  OnEventParam,
  SwapAndExecuteEvent,
  SwapAndExecuteIntent,
  SwapAndExecuteOnIntentHookData,
  SwapAndExecutePlan,
  TokenInfo,
} from '../domain';
import { logger } from '../domain';
import { Errors } from '../domain/errors';
import {
  buildExecuteTxs,
  createExecutePlanContext,
  isNativeExecuteToken,
  sendExecuteTransactions,
} from '../execute/runtime';
import { erc20GetAllowance } from '../services/allowance-utils';
import {
  computeShortfall,
  createAvailableBalances,
  createExecuteRequirement,
  createPriceLookup,
  createSwapAndExecuteIntent,
  type PriceDatum,
} from '../services/composite-intent';
import { createExplorerTxURL } from '../services/explorer';
import { estimateTotalFees, type TxWithGas } from '../services/fee-estimation';
import { equalFold } from '../services/strings';
import { resolveTokenInfo } from '../services/token-metadata';
import { SLIPPAGE_DEFAULT } from '../swap/constants';
import { buildSwapPreflight, type SwapPreflight } from '../swap/preflight';
import type { Source, SwapAndExecuteParams, SwapAndExecuteResult, SwapData } from '../swap/types';
import { SwapMode } from '../swap/types';
import type { MiddlewareSwapClient } from '../transport';
import type { SwapAndExecuteDeps } from './deps';
import { buildSwapPreviewState, type SwapPreviewState, swap } from './swap';
import { createSwapAndExecuteProgressEmitter } from './swap-and-execute-progress';

type SwapAndExecuteOptions = OnEventParam<SwapAndExecuteEvent> & {
  onIntent?: (data: SwapAndExecuteOnIntentHookData) => void;
  slippageTolerance?: number;
  skipSwapOverride?: boolean;
};

type RawSwapBalances = Awaited<ReturnType<MiddlewareSwapClient['getSwapBalances']>>;
type FundingShortfall = ReturnType<typeof computeShortfall>;

type CompositePreviewState = {
  available: ReturnType<typeof createAvailableBalances>;
  intent: SwapAndExecuteIntent;
  plan: SwapAndExecutePlan;
  preflight: SwapPreflight;
  rawBalances: RawSwapBalances;
  shortfall: FundingShortfall;
  swapInput: SwapData | null;
  swapPreviewState: SwapPreviewState | null;
  sources?: Source[];
};

const mergeSwapAndExecutePlan = (
  swapSteps: SwapAndExecutePlan['steps'],
  executeSteps: ExecutePlanStep[],
  swapRequired: boolean
): SwapAndExecutePlan => ({
  swapRequired,
  steps: [...swapSteps, ...executeSteps],
});

const toPriceData = (balances: RawSwapBalances): PriceDatum[] =>
  balances.map((balance) => ({
    chainId: balance.chainID,
    tokenAddress: balance.tokenAddress,
    amount: new Decimal(balance.amount),
    valueUsd: new Decimal(balance.value),
  }));

// `sources`, when provided, is the user's explicit allowlist: keep only those (chain, token)
// balances and fail loud if none match. Applied once up front so every downstream consumer — dst
// availability, the shortfall, and the nested swap()'s preloaded balances — sees the same set.
const applySourcesAllowlist = (balances: RawSwapBalances, sources?: Source[]): RawSwapBalances => {
  if (!sources || sources.length === 0) return balances;
  const filtered = balances.filter((balance) =>
    sources.some(
      (source) =>
        source.chainId === balance.chainID && equalFold(source.tokenAddress, balance.tokenAddress)
    )
  );
  if (filtered.length === 0) {
    throw Errors.insufficientBalance('No balances match the requested sources');
  }
  return filtered;
};

const getDestinationBalances = (
  chainList: ChainListType,
  balances: RawSwapBalances,
  chain: Chain,
  token: Pick<TokenInfo, 'symbol' | 'decimals' | 'contractAddress'>
) => {
  const destinationBalances = balances.filter((balance) => balance.chainID === chain.id);
  const tokenBalance = destinationBalances.find((balance) =>
    isNativeExecuteToken(chainList, chain, token.contractAddress)
      ? isNativeExecuteToken(chainList, chain, balance.tokenAddress)
      : equalFold(balance.tokenAddress, token.contractAddress)
  );
  const gasBalance = destinationBalances.find((balance) =>
    isNativeExecuteToken(chainList, chain, balance.tokenAddress)
  );

  return {
    tokenBalanceRaw: tokenBalance ? parseUnits(tokenBalance.amount, tokenBalance.decimals) : 0n,
    gasBalanceRaw: gasBalance ? parseUnits(gasBalance.amount, gasBalance.decimals) : 0n,
  };
};

const createBaseSwapInput = (
  params: Pick<SwapAndExecuteParams, 'toChainId' | 'toTokenAddress' | 'toAmountRaw'> & {
    sources?: Source[];
  }
): SwapData => ({
  mode: SwapMode.EXACT_OUT,
  data: {
    toChainId: params.toChainId,
    toTokenAddress: params.toTokenAddress,
    toAmountRaw: params.toAmountRaw,
    sources: params.sources,
  },
});

const createFundingSwapInput = (
  params: Pick<SwapAndExecuteParams, 'toChainId' | 'toTokenAddress'> & {
    sources?: Source[];
    shortfall: FundingShortfall;
  }
): SwapData => ({
  mode: SwapMode.EXACT_OUT,
  data: {
    toChainId: params.toChainId,
    toTokenAddress: params.toTokenAddress,
    // Sentinel shape (same for token and native): positive = shortfall (bridge in),
    // negative = reserve abs(value) of dst-chain balance so the funding swap doesn't
    // consume tokens the user already holds for the execute step.
    toAmountRaw:
      params.shortfall.tokenShortfall > 0n
        ? params.shortfall.tokenShortfall
        : params.shortfall.tokenReserve > 0n
          ? -params.shortfall.tokenReserve
          : 0n,
    toNativeAmountRaw:
      params.shortfall.gasShortfall > 0n
        ? params.shortfall.gasShortfall
        : params.shortfall.gasReserve > 0n
          ? -params.shortfall.gasReserve
          : undefined,
    sources: params.sources,
  },
});

const buildCompositePreviewState = async (
  input: {
    dstChain: Chain;
    executePlan: ReturnType<typeof createExecutePlanContext>;
    executeRequirement: ExecuteRequirement;
    sources?: Source[];
    preflight: SwapPreflight;
    priceLookup: (chainId: number, tokenAddress: Hex) => Decimal;
    rawBalances: RawSwapBalances;
    requirementRaw: { token: bigint; gas: bigint; nativeValue: bigint };
    toChainId: number;
    toToken: Pick<TokenInfo, 'symbol' | 'decimals' | 'contractAddress'>;
    toTokenAddress: Hex;
    forceSkipFunding?: boolean;
  },
  deps: SwapAndExecuteDeps
): Promise<CompositePreviewState> => {
  const { tokenBalanceRaw, gasBalanceRaw } = getDestinationBalances(
    deps.chainList,
    input.rawBalances,
    input.dstChain,
    input.toToken
  );
  const available = createAvailableBalances({
    chain: input.dstChain,
    executeToken: input.toToken,
    tokenBalanceRaw,
    gasBalanceRaw,
    priceLookup: input.priceLookup,
  });

  const shortfall = input.forceSkipFunding
    ? {
        skipFunding: true,
        tokenShortfall: 0n,
        tokenReserve: 0n,
        gasShortfall: 0n,
        gasReserve: 0n,
      }
    : computeShortfall(
        input.requirementRaw,
        {
          token: tokenBalanceRaw,
          gas: gasBalanceRaw,
        },
        isNativeExecuteToken(deps.chainList, input.dstChain, input.toTokenAddress)
      );

  // The crux of the flow: requirement vs. what the user already holds on the dst chain →
  // the shortfall that drives swap-vs-skip. Fires on both the initial build and every refresh.
  logger.debug('SwapAndExecute:shortfall', {
    toChainId: input.toChainId,
    toTokenAddress: input.toTokenAddress,
    forceSkipFunding: input.forceSkipFunding,
    requirementRaw: input.requirementRaw,
    availableRaw: { token: tokenBalanceRaw, gas: gasBalanceRaw },
    shortfall,
  });

  if (shortfall.skipFunding) {
    return {
      available,
      intent: createSwapAndExecuteIntent({
        executeRequirement: input.executeRequirement,
        available,
        chain: input.dstChain,
        executeToken: input.toToken,
        priceLookup: input.priceLookup,
        shortfall: {
          tokenAmountRaw: 0n,
          gasAmountRaw: 0n,
        },
      }),
      plan: mergeSwapAndExecutePlan([], input.executePlan.steps, false),
      preflight: input.preflight,
      rawBalances: input.rawBalances,
      shortfall,
      swapInput: null,
      swapPreviewState: null,
      sources: input.sources,
    };
  }

  const swapInput = createFundingSwapInput({
    toChainId: input.toChainId,
    toTokenAddress: input.toTokenAddress,
    sources: input.sources,
    shortfall,
  });
  // Log the forwarded funding params the moment they exist — BEFORE routing. A route failure
  // (unroutable source, missing gas-swap quote, …) must still surface exactly what was fed in;
  // never gate the log on work that can throw.
  logger.debug('SwapAndExecute:funding_swap', { swapInput });

  const swapPreviewState = await buildSwapPreviewState(swapInput, {
    chainList: deps.chainList,
    eoaAddress: deps.evm.address,
    ephemeralWallet: deps.swap.ephemeralWallet,
    cotCurrencyId: deps.swap.cotCurrencyId,
    middlewareClient: deps.middlewareClient,
    forceMayan: deps.forceMayan,
    preflight: input.preflight,
  });

  return {
    available,
    intent: createSwapAndExecuteIntent({
      executeRequirement: input.executeRequirement,
      available,
      chain: input.dstChain,
      executeToken: input.toToken,
      priceLookup: input.priceLookup,
      shortfall: {
        tokenAmountRaw: shortfall.tokenShortfall,
        gasAmountRaw: shortfall.gasShortfall,
      },
      swap: swapPreviewState.intent,
    }),
    plan: mergeSwapAndExecutePlan(swapPreviewState.plan.steps, input.executePlan.steps, true),
    preflight: input.preflight,
    rawBalances: input.rawBalances,
    shortfall,
    swapInput,
    swapPreviewState,
    sources: input.sources,
  };
};

export const swapAndExecute = async (
  params: SwapAndExecuteParams,
  deps: SwapAndExecuteDeps,
  options?: SwapAndExecuteOptions
): Promise<SwapAndExecuteResult> => {
  const { toChainId, toTokenAddress, toAmountRaw, sources, execute } = params;

  const { emitEvent, emitStatus, emitPlanPreview, emitPlanConfirmed, emitExecuteProgress } =
    createSwapAndExecuteProgressEmitter(options?.onEvent);

  emitStatus('preparing');
  emitStatus('route_building');

  logger.debug('SwapAndExecute:params', {
    toChainId,
    toTokenAddress,
    toAmountRaw,
    sources,
    execute: {
      to: execute.to,
      value: execute.value,
      data: execute.data,
      gas: execute.gas,
      gasPrice: execute.gasPrice,
      tokenApproval: execute.tokenApproval,
    },
    skipSwapOverride: options?.skipSwapOverride,
  });

  const { dstChain, dstPublicClient, tx, speculativeApprovalTx, allowanceCheck } = buildExecuteTxs({
    chainList: deps.chainList,
    toChainId,
    to: execute.to,
    value: execute.value,
    data: execute.data,
    gas: execute.gas,
    tokenApproval: execute.tokenApproval
      ? {
          tokenAddress: execute.tokenApproval.toTokenAddress,
          amount: execute.tokenApproval.amount,
          spender: execute.tokenApproval.spender,
        }
      : undefined,
  });

  // Speculative approval: read the on-chain allowance, estimate the speculative approval's gas,
  // and fetch balances concurrently. Previously the allowance read and approval-gas estimate ran
  // serially before balances were even requested; here all three overlap.
  const [currentAllowance, approvalGasUsed, rawBalances] = await Promise.all([
    allowanceCheck
      ? erc20GetAllowance(
          {
            contractAddress: allowanceCheck.tokenAddress,
            spender: allowanceCheck.spender,
            owner: deps.evm.address,
          },
          dstPublicClient
        )
      : Promise.resolve(null),
    speculativeApprovalTx
      ? dstPublicClient
          .estimateGas({
            to: speculativeApprovalTx.to,
            data: speculativeApprovalTx.data,
            value: speculativeApprovalTx.value,
            account: deps.evm.address,
          })
          .catch(() => 70_000n)
      : Promise.resolve(0n),
    deps.middlewareClient.getSwapBalances(deps.evm.address),
  ]);

  // Apply the user's source allowlist once, up front. Every downstream consumer — dst availability,
  // the shortfall, and the nested swap()'s preloaded balances — then sees the same filtered set.
  // Resolve the destination/execute token's metadata ONCE — deployment list → balances → on-chain —
  // and reuse it for the approval display, preflight, and the nested swap. No throw for tokens
  // outside the deployment list, no redundant reads. Done BEFORE the sources allowlist (which can
  // throw) since it's independent of it, and on the full unfiltered balances so a held token's
  // metadata is found even when `sources` excludes it.
  const executeTokenInfo = await resolveTokenInfo({
    chainList: deps.chainList,
    balances: rawBalances,
    publicClient: dstPublicClient,
    chainId: toChainId,
    address: toTokenAddress,
  });

  const balances = applySourcesAllowlist(rawBalances, sources);

  // Keep the speculative approval only if the on-chain allowance doesn't already cover it.
  const approvalTx =
    allowanceCheck &&
    currentAllowance !== null &&
    currentAllowance < allowanceCheck.requiredAllowance
      ? speculativeApprovalTx
      : null;
  const approvalContext =
    approvalTx && allowanceCheck
      ? {
          token: {
            contractAddress: allowanceCheck.tokenAddress,
            symbol: executeTokenInfo.symbol,
            decimals: executeTokenInfo.decimals,
          },
          spender: allowanceCheck.spender,
          amount: allowanceCheck.requiredAllowance,
        }
      : null;

  logger.debug('SwapAndExecute:execute_tx', {
    dstChainId: dstChain.id,
    to: tx.to,
    value: tx.value,
    currentAllowance,
    requiredAllowance: allowanceCheck?.requiredAllowance ?? null,
    speculativeApprovalKept: approvalTx !== null,
    approvalGasUsed,
    balanceCount: balances.length,
  });

  const executeGasUsed = execute.gas;
  const feeEstimateItems: TxWithGas[] = [
    ...(approvalTx
      ? [
          {
            tx: {
              to: approvalTx.to,
              data: approvalTx.data,
              value: approvalTx.value,
            },
            gasEstimate: approvalGasUsed,
            gasEstimateKind: 'final' as const,
          },
        ]
      : []),
    {
      tx: {
        to: tx.to,
        data: tx.data,
        value: tx.value,
      },
      gasEstimate: executeGasUsed,
    },
  ];
  const baseSwapInput = createBaseSwapInput({
    toChainId,
    toTokenAddress,
    toAmountRaw,
    sources,
  });
  const [preflight, fees] = await Promise.all([
    buildSwapPreflight(baseSwapInput, {
      chainList: deps.chainList,
      cotCurrencyId: deps.swap.cotCurrencyId,
      eoaAddress: deps.evm.address,
      middlewareClient: deps.middlewareClient,
      preloadedBalances: balances,
      preloadedDstTokenInfo: executeTokenInfo,
    }),
    estimateTotalFees(dstPublicClient, dstChain.id, feeEstimateItems, execute.gasPrice ?? 'medium'),
  ]);

  const approvalFee = approvalTx ? fees[0] : null;
  const txFee = fees[approvalTx ? 1 : 0];
  if (!txFee || txFee.recommended.maxFeePerGas === 0n) {
    throw Errors.gasPriceError({
      chainId: dstChain.id,
    });
  }

  if (approvalTx && approvalFee) {
    approvalTx.gas = approvalFee.recommended.gasLimit;
  }
  tx.gas = txFee.recommended.gasLimit;

  const l1Fee = fees.reduce((sum, fee) => sum + fee.l1Fee, 0n);
  const gasFee = fees.reduce((sum, fee) => sum + fee.recommended.totalMaxCost, 0n);
  const feeParams: import('../execute/runtime').ExecuteFeeParams = txFee.recommended
    .useLegacyPricing
    ? { type: 'legacy', gasPrice: txFee.recommended.maxFeePerGas }
    : {
        type: 'eip1559',
        maxFeePerGas: txFee.recommended.maxFeePerGas,
        maxPriorityFeePerGas: txFee.recommended.maxPriorityFeePerGas,
      };

  logger.debug('SwapAndExecute:fees', {
    dstChainId: dstChain.id,
    gasFee,
    l1Fee,
    txGasLimit: tx.gas,
    approvalGasLimit: approvalTx?.gas ?? null,
    maxFeePerGas: txFee.recommended.maxFeePerGas,
    useLegacyPricing: txFee.recommended.useLegacyPricing,
  });

  const priceLookup = createPriceLookup(
    toPriceData(balances),
    preflight.oraclePrices,
    deps.chainList
  );
  const toToken = preflight.dstTokenInfo;
  const executeRequirement = createExecuteRequirement({
    chain: dstChain,
    executeToken: toToken,
    executeAmountRaw: toAmountRaw,
    to: tx.to,
    gasEstimate: {
      gasToken: deps.chainList.getNativeToken(dstChain.id),
      amountRaw: gasFee,
      estimatedGasUnits: txFee.recommended.gasLimit,
      feeParams,
      l1Fee,
      priceTier: execute.gasPrice ?? 'medium',
    },
    nativeValueRaw: tx.value ?? 0n,
    tokenApproval: approvalContext
      ? {
          token: approvalContext.token,
          amountRaw: approvalContext.amount,
          spender: approvalContext.spender,
        }
      : null,
    priceLookup,
  });
  const executePlan = createExecutePlanContext({
    chain: dstChain,
    tx,
    approval: approvalContext,
  });
  const requirementRaw = {
    token: toAmountRaw,
    gas: gasFee,
    nativeValue: tx.value ?? 0n,
  } as const;

  let previewState = await buildCompositePreviewState(
    {
      dstChain,
      executePlan,
      executeRequirement,
      sources,
      preflight,
      priceLookup,
      rawBalances: balances,
      requirementRaw,
      toChainId,
      toToken,
      toTokenAddress,
      forceSkipFunding: options?.skipSwapOverride === true,
    },
    deps
  );

  emitStatus('route_ready');
  emitPlanPreview(previewState.plan);
  emitStatus('awaiting_approval');

  const compositeOnIntent = options?.onIntent;
  if (compositeOnIntent) {
    previewState = await new Promise<CompositePreviewState>((resolve, reject) => {
      let completed = false;
      let currentState = previewState;

      const allow = () => {
        completed = true;
        resolve(currentState);
      };
      const deny = () => {
        completed = true;
        reject(new Error('User denied swap intent'));
      };
      const refresh = async (nextSources?: Source[]): Promise<SwapAndExecuteIntent> => {
        if (completed) {
          return currentState.intent;
        }

        const refreshedRawBalances = await deps.middlewareClient.getSwapBalances(deps.evm.address);
        const refreshedSources = nextSources ?? currentState.sources;
        const refreshedBalances = applySourcesAllowlist(refreshedRawBalances, refreshedSources);
        const refreshedBaseSwapInput = createBaseSwapInput({
          toChainId,
          toTokenAddress,
          toAmountRaw,
          sources: refreshedSources,
        });
        const refreshedPreflight = await buildSwapPreflight(refreshedBaseSwapInput, {
          chainList: deps.chainList,
          cotCurrencyId: deps.swap.cotCurrencyId,
          eoaAddress: deps.evm.address,
          middlewareClient: deps.middlewareClient,
          preloadedBalances: refreshedBalances,
        });
        const refreshedPriceLookup = createPriceLookup(
          toPriceData(refreshedBalances),
          refreshedPreflight.oraclePrices,
          deps.chainList
        );
        currentState = await buildCompositePreviewState(
          {
            dstChain,
            executePlan,
            executeRequirement,
            sources: refreshedSources,
            preflight: refreshedPreflight,
            priceLookup: refreshedPriceLookup,
            rawBalances: refreshedBalances,
            requirementRaw,
            toChainId,
            toToken,
            toTokenAddress,
            forceSkipFunding: options?.skipSwapOverride === true,
          },
          deps
        );
        emitPlanPreview(currentState.plan);
        return currentState.intent;
      };

      try {
        compositeOnIntent({
          allow,
          deny,
          intent: currentState.intent,
          refresh,
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  emitStatus('approved');
  emitPlanConfirmed(previewState.plan);
  emitStatus('executing');

  // The exact SwapData handed to the nested swap() — the params swapAndExecute forwards.
  const forwardedSwapInput = previewState.swapInput ?? baseSwapInput;
  logger.debug('SwapAndExecute:executing', {
    swapRequired: previewState.intent.swapRequired,
    swapInput: forwardedSwapInput,
    planStepCount: previewState.plan.steps.length,
  });

  const swapResult = previewState.intent.swapRequired
    ? await swap(forwardedSwapInput, deps, {
        onIntent: ({ allow }) => allow(),
        onEvent: (event) => {
          if (event.type === 'plan_progress') {
            emitEvent(event);
          }
        },
        slippageTolerance: options?.slippageTolerance ?? SLIPPAGE_DEFAULT,
        preloadedBalances: previewState.rawBalances,
        preloadedDstTokenInfo: executeTokenInfo,
      })
    : null;

  logger.debug('SwapAndExecute:swap_done', {
    swapSkipped: swapResult === null,
    swapResult,
  });

  const sendResult = await sendExecuteTransactions(
    {
      approvalTx,
      tx,
      feeParams,
      plan: executePlan,
    },
    {
      onProgress: (update) => emitExecuteProgress(update, executePlan),
      chain: dstChain,
      dstPublicClient,
      address: deps.evm.address,
      client: deps.evm.walletClient,
      timing: deps.timing,
    }
  );

  logger.debug('SwapAndExecute:execute_result', {
    txHash: sendResult.txHash,
    approvalHash: sendResult.approvalHash,
  });

  emitStatus('completed');

  const explorerBaseUrl = dstChain.blockExplorers?.default?.url;
  const executeResult = {
    txHash: sendResult.txHash,
    txExplorerUrl: createExplorerTxURL(sendResult.txHash, explorerBaseUrl),
    receipt: sendResult.receipt,
  };
  const approval = sendResult.approvalHash
    ? {
        txHash: sendResult.approvalHash,
        txExplorerUrl: createExplorerTxURL(sendResult.approvalHash, explorerBaseUrl),
      }
    : undefined;

  if (swapResult) {
    return {
      approval,
      execute: executeResult,
      swapSkipped: false,
      swapResult,
    };
  }

  return {
    approval,
    execute: executeResult,
    swapSkipped: true,
    swapResult: undefined,
  };
};
