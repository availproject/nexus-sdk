import Decimal from 'decimal.js';
import { type Hex, type PublicClient, toHex } from 'viem';
import { z } from 'zod';
import { createBridgeIntent } from '../bridge/intent/creator';
import { buildQuoteRequest } from '../bridge/intent/quote-request';
import { type BridgePreviewState, buildBridgePreviewState } from '../bridge/preview';
import {
  type BeforeExecuteHook,
  type BridgeAndExecuteEvent,
  type BridgeAndExecuteIntent,
  type BridgeAndExecuteOnIntentHookData,
  type BridgeAndExecuteParams,
  type BridgeAndExecutePlan,
  type BridgeAndExecuteResult,
  type BridgeAndExecuteSimulationResult,
  type BridgeEvent,
  type BridgeResult,
  type Chain,
  type ChainListType,
  type ExecutePlanStep,
  type ExecuteRequirement,
  logger,
  type OnEventParam,
  type OraclePriceResponse,
  type TokenBalance,
  type TokenInfo,
  type Tx,
  type TxResult,
} from '../domain';
import { Errors, formatUnknownError } from '../domain/errors';
import {
  addressString,
  hexString,
  nonNegativeBigint,
  nonNegativeInt,
  parseInput,
  positiveInt,
} from '../domain/utils/validation';
import {
  createExecutePlanContext,
  createExecuteTxContext,
  type ExecuteApprovalContext,
  isNativeExecuteToken,
  sendExecuteTransactions,
} from '../execute/runtime';
import { createUserAssets, getBalancesForBridge } from '../services/balances';
import {
  computeShortfall,
  createAvailableBalances,
  createBridgeAndExecuteIntent,
  createExecuteRequirement,
  createPriceLookup,
  type PriceDatum,
} from '../services/composite-intent';
import { createExplorerTxURL } from '../services/explorer';
import { estimateTotalFees, type TxWithGas } from '../services/fee-estimation';
import { divDecimals, mulDecimals } from '../services/math';
import { generateStateOverride } from '../services/simulation';
import { withTimingSpan } from '../services/timing';
import type { MiddlewareSimulationClient, QuoteResponse } from '../transport';
import { executeBridge, simulateBridge } from './bridge';
import { createBridgeAndExecuteProgressEmitter } from './bridge-and-execute-progress';
import type { BridgeAndExecuteDeps } from './deps';

type BridgeAndExecuteOptions = OnEventParam<BridgeAndExecuteEvent> &
  BeforeExecuteHook & {
    fillTimeoutMinutes?: number;
    onIntent?: (data: BridgeAndExecuteOnIntentHookData) => void;
  };

type FundingShortfall = ReturnType<typeof computeShortfall>;

type CompositePreviewState = {
  available: ReturnType<typeof createAvailableBalances>;
  bridgePreviewState: BridgePreviewState | null;
  intent: BridgeAndExecuteIntent;
  plan: BridgeAndExecutePlan;
  shortfall: FundingShortfall;
  sourceChains?: number[];
};

type EstimateBridgeAndExecuteResult = {
  address: Hex;
  approvalContext: ExecuteApprovalContext | null;
  approvalTx: Tx | null;
  dstChain: Chain;
  dstPublicClient: PublicClient;
  executeRequirement: ExecuteRequirement;
  gas: {
    approval: bigint;
    tx: bigint;
  };
  feeParams: import('../execute/runtime').ExecuteFeeParams;
  priceLookup: (chainId: number, tokenAddress: Hex) => Decimal;
  resolveQuoteResponse: () => QuoteResponse;
  requirementRaw: {
    gas: bigint;
    nativeValue: bigint;
    token: bigint;
  };
  token: TokenInfo;
  tx: Tx;
};

const executeParamsSchema = z.object({
  toChainId: positiveInt,
  to: addressString,
  value: nonNegativeBigint.optional(),
  data: hexString.optional(),
  gas: nonNegativeBigint.optional(),
  gasPrice: z.enum(['low', 'medium', 'high']).optional(),
  enableTransactionPolling: z.boolean().optional(),
  transactionTimeout: nonNegativeInt.optional(),
  waitForReceipt: z.boolean().optional(),
  receiptTimeout: nonNegativeInt.optional(),
  requiredConfirmations: nonNegativeInt.optional(),
  tokenApproval: z
    .object({
      toTokenSymbol: z.string().min(1),
      amount: nonNegativeBigint,
      spender: addressString,
    })
    .optional(),
});

const bridgeAndExecuteParamsSchema = z.object({
  toChainId: positiveInt,
  toTokenSymbol: z.string().min(1),
  toAmountRaw: nonNegativeBigint,
  sources: z.array(positiveInt).optional(),
  execute: executeParamsSchema.omit({ toChainId: true }),
  enableTransactionPolling: z.boolean().optional(),
  transactionTimeout: nonNegativeInt.optional(),
  waitForReceipt: z.boolean().optional(),
  receiptTimeout: nonNegativeInt.optional(),
  requiredConfirmations: nonNegativeInt.optional(),
  recentApprovalTxHash: hexString.optional(),
});

const parseBridgeAndExecuteParams = (input: BridgeAndExecuteParams) => {
  return parseInput(bridgeAndExecuteParamsSchema, input);
};

const mergeBridgeAndExecutePlan = (
  bridgeSteps: BridgeAndExecutePlan['steps'],
  executeSteps: ExecutePlanStep[],
  bridgeRequired: boolean
): BridgeAndExecutePlan => ({
  bridgeRequired,
  steps: [...bridgeSteps, ...executeSteps],
});

const toPriceData = (balances: TokenBalance[]): PriceDatum[] =>
  balances.flatMap((asset) =>
    asset.chainBalances.map((chainBalance) => ({
      chainId: chainBalance.chain.id,
      tokenAddress: chainBalance.contractAddress,
      amount: new Decimal(chainBalance.balance),
      valueUsd: new Decimal(chainBalance.value),
    }))
  );

const getDestinationBalances = (
  chainList: ChainListType,
  balances: TokenBalance[],
  dstChain: Chain,
  token: TokenInfo
) => {
  const assetList = createUserAssets(balances);
  const tokenAddress = isNativeExecuteToken(chainList, dstChain, token.contractAddress)
    ? chainList.getNativeToken(dstChain.id).contractAddress
    : token.contractAddress;
  const { destinationAssetBalance, destinationGasBalance } = assetList.getAssetDetails(
    dstChain,
    tokenAddress
  );

  return {
    tokenBalanceRaw: mulDecimals(
      destinationAssetBalance,
      isNativeExecuteToken(chainList, dstChain, token.contractAddress)
        ? dstChain.nativeCurrency.decimals
        : token.decimals
    ),
    gasBalanceRaw: mulDecimals(destinationGasBalance, dstChain.nativeCurrency.decimals),
  };
};

const convertNativeGasToTokenAmount = (
  chainList: ChainListType,
  input: {
    chain: Chain;
    gasAmountRaw: bigint;
    priceLookup: (chainId: number, tokenAddress: Hex) => Decimal;
    token: TokenInfo;
  }
) => {
  const gasAmount = divDecimals(input.gasAmountRaw, input.chain.nativeCurrency.decimals);
  if (
    gasAmount.isZero() ||
    isNativeExecuteToken(chainList, input.chain, input.token.contractAddress)
  ) {
    return gasAmount;
  }

  const nativePrice = input.priceLookup(
    input.chain.id,
    chainList.getNativeToken(input.chain.id).contractAddress
  );
  const tokenPrice = input.priceLookup(input.chain.id, input.token.contractAddress);
  if (nativePrice.lte(0) || tokenPrice.lte(0)) {
    return new Decimal(0);
  }

  return gasAmount.mul(nativePrice).div(tokenPrice).toDP(input.token.decimals, Decimal.ROUND_CEIL);
};

const simulateBundle = async (
  middlewareClient: MiddlewareSimulationClient,
  input: {
    tokenSymbol: string;
    tokenAddress: Hex;
    balanceSlot?: number;
    amount: bigint;
    txs: Tx[];
    chainId: number;
    userAddress: Hex;
  }
) => {
  const overrides = generateStateOverride(input);
  return middlewareClient
    .simulateBundleV2({
      chainId: String(input.chainId),
      simulations: input.txs.map((tx, i) => ({
        type: 'transaction',
        from: input.userAddress,
        to: tx.to,
        data: tx.data,
        value: toHex(tx.value),
        stepId: `sim_${i}`,
        enableStateOverride: true,
        stateOverride: overrides,
      })),
    })
    .catch((error) => {
      throw Errors.backend(`Failed to simulate bundle: ${formatUnknownError(error)}`, {
        service: 'middleware',
        chainId: input.chainId,
        details: { tokenAddress: input.tokenAddress },
      });
    });
};

const buildCompositePreviewState = async (
  input: {
    address: Hex;
    dstChain: Chain;
    executePlan: ReturnType<typeof createExecutePlanContext>;
    executeRequirement: ExecuteRequirement;
    oraclePrices: OraclePriceResponse;
    priceLookup: (chainId: number, tokenAddress: Hex) => Decimal;
    requirementRaw: EstimateBridgeAndExecuteResult['requirementRaw'];
    sourceChains?: number[];
    token: TokenInfo;
    unifiedBalances: TokenBalance[];
    getQuoteResponse: () => QuoteResponse;
  },
  deps: BridgeAndExecuteDeps
): Promise<CompositePreviewState> => {
  const { tokenBalanceRaw, gasBalanceRaw } = getDestinationBalances(
    deps.chainList,
    input.unifiedBalances,
    input.dstChain,
    input.token
  );

  const available = createAvailableBalances({
    chain: input.dstChain,
    executeToken: input.token,
    tokenBalanceRaw,
    gasBalanceRaw,
    priceLookup: input.priceLookup,
  });

  const shortfall = computeShortfall(
    input.requirementRaw,
    {
      token: tokenBalanceRaw,
      gas: gasBalanceRaw,
    },
    isNativeExecuteToken(deps.chainList, input.dstChain, input.token.contractAddress)
  );

  if (shortfall.skipFunding) {
    const plan = mergeBridgeAndExecutePlan([], input.executePlan.steps, false);
    return {
      available,
      bridgePreviewState: null,
      intent: createBridgeAndExecuteIntent({
        executeRequirement: input.executeRequirement,
        available,
        chain: input.dstChain,
        executeToken: input.token,
        priceLookup: input.priceLookup,
        shortfall: {
          tokenAmountRaw: 0n,
          gasAmountRaw: 0n,
        },
      }),
      plan,
      shortfall,
      sourceChains: input.sourceChains,
    };
  }

  const bridgeIntent = await createBridgeIntent(
    {
      amount: divDecimals(shortfall.tokenShortfall, input.token.decimals),
      assets: createUserAssets(input.unifiedBalances),
      gas: divDecimals(shortfall.gasShortfall, input.dstChain.nativeCurrency.decimals),
      gasInToken: convertNativeGasToTokenAmount(deps.chainList, {
        chain: input.dstChain,
        gasAmountRaw: shortfall.gasShortfall,
        priceLookup: input.priceLookup,
        token: input.token,
      }),
      resolveUsdValue: ({ amount, chainId, tokenAddress }) =>
        amount.mul(input.priceLookup(chainId, tokenAddress)),
      sourceChains: input.sourceChains ?? [],
      token: input.token,
      provider: 'nexus',
      dstChainId: input.dstChain.id,
      dstChainUniverse: input.dstChain.universe,
      dstChainNativeDecimals: input.dstChain.nativeCurrency.decimals,
      recipient: input.address,
      quoteResponse: input.getQuoteResponse(),
    },
    {
      chainList: deps.chainList,
      evm: {
        address: input.address,
      },
    }
  );
  const bridgePreviewState = await buildBridgePreviewState(bridgeIntent, {
    chainList: deps.chainList,
  });
  const plan = mergeBridgeAndExecutePlan(
    bridgePreviewState.plan.steps,
    input.executePlan.steps,
    true
  );

  return {
    available,
    bridgePreviewState,
    intent: createBridgeAndExecuteIntent({
      executeRequirement: input.executeRequirement,
      available,
      chain: input.dstChain,
      executeToken: input.token,
      priceLookup: input.priceLookup,
      shortfall: {
        tokenAmountRaw: shortfall.tokenShortfall,
        gasAmountRaw: shortfall.gasShortfall,
      },
      bridge: bridgePreviewState.readableIntent,
    }),
    plan,
    shortfall,
    sourceChains: input.sourceChains,
  };
};

const estimateBridgeAndExecute = async (
  params: BridgeAndExecuteParams,
  deps: BridgeAndExecuteDeps
): Promise<
  EstimateBridgeAndExecuteResult & {
    initialPreviewState: CompositePreviewState;
  }
> => {
  const { toChainId, toTokenSymbol, toAmountRaw, execute } = params;

  const { token, chain: dstChain } = deps.chainList.getChainAndTokenFromSymbol(
    toChainId,
    toTokenSymbol
  );

  const address = deps.evm.address;
  const txs: Tx[] = [];

  const { tx, approvalTx, approvalContext, dstPublicClient } = await createExecuteTxContext({
    chainList: deps.chainList,
    ownerAddress: address,
    toChainId,
    to: execute.to,
    value: execute.value,
    data: execute.data,
    gas: execute.gas,
    tokenApproval: execute.tokenApproval
      ? {
          token: deps.chainList.getTokenInfoBySymbol(
            toChainId,
            execute.tokenApproval.toTokenSymbol
          ),
          amount: BigInt(execute.tokenApproval.amount),
          spender: execute.tokenApproval.spender,
        }
      : undefined,
  });

  logger.debug('BridgeAndExecute:2', {
    tx,
    dstChain,
    dstPublicClient,
    approvalTx,
  });

  if (approvalTx) {
    txs.push(approvalTx);
  }

  txs.push(tx);

  const determineGasUsed = execute.gas
    ? Promise.resolve({ approvalGas: approvalTx ? 70_000n : 0n, txGas: execute.gas })
    : simulateBundle(deps.middlewareClient, {
        txs,
        amount: params.toAmountRaw,
        userAddress: address,
        chainId: dstChain.id,
        tokenAddress: token.contractAddress,
        balanceSlot: token.balanceSlot,
        tokenSymbol: toTokenSymbol ?? 'ETH',
      }).then(({ gas }) => {
        if (approvalTx) {
          return {
            approvalGas: gas[0],
            txGas: gas[1],
          };
        }

        return {
          approvalGas: 0n,
          txGas: gas[0],
        };
      });

  const quoteRequest = buildQuoteRequest(deps.chainList, token, dstChain.id);

  const quotePromise = deps.middlewareClient
    .getQuote(quoteRequest)
    .catch((error) => error as Error);

  const [gasUsed, balances, oraclePrices, quoteResult] = await Promise.all([
    determineGasUsed,
    getBalancesForBridge({
      evmAddress: deps.evm.address,
      chainList: deps.chainList,
      middlewareClient: deps.middlewareClient,
    }),
    deps.middlewareClient.getOraclePrices(),
    quotePromise,
  ]);

  const resolveQuoteResponse = (): QuoteResponse => {
    if (quoteResult instanceof Error) throw quoteResult;
    return quoteResult;
  };

  const items: TxWithGas[] = [
    ...(approvalTx
      ? [
          {
            tx: {
              to: approvalTx.to,
              data: approvalTx.data,
              value: approvalTx.value,
            },
            gasEstimate: gasUsed.approvalGas,
          },
        ]
      : []),
    {
      tx: {
        to: tx.to,
        data: tx.data,
        value: tx.value,
      },
      gasEstimate: gasUsed.txGas,
    },
  ];
  const fees = await estimateTotalFees(
    dstPublicClient,
    dstChain.id,
    items,
    execute.gasPrice ?? 'medium'
  );
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
  const gasPrice = txFee.recommended.maxFeePerGas;
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

  logger.debug('BridgeAndExecute:3', {
    fees,
    gasPrice,
    balances,
    l1Fee,
    gasFee,
  });

  const priceLookup = createPriceLookup(toPriceData(balances), oraclePrices, deps.chainList);
  const executeRequirement = createExecuteRequirement({
    chain: dstChain,
    executeToken: token,
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
  const initialPreviewState = await buildCompositePreviewState(
    {
      address,
      dstChain,
      executePlan,
      executeRequirement,
      oraclePrices,
      priceLookup,
      requirementRaw,
      sourceChains: params.sources,
      token,
      unifiedBalances: balances,
      getQuoteResponse: resolveQuoteResponse,
    },
    deps
  );

  return {
    approvalContext,
    address,
    approvalTx,
    dstChain,
    dstPublicClient,
    executeRequirement,
    feeParams,
    gas: {
      tx: tx.gas ?? 0n,
      approval: approvalTx?.gas ?? 0n,
    },
    initialPreviewState,
    priceLookup,
    resolveQuoteResponse,
    requirementRaw,
    token,
    tx,
  };
};

export const simulateBridgeAndExecute = async (
  params: BridgeAndExecuteParams,
  deps: BridgeAndExecuteDeps
): Promise<BridgeAndExecuteSimulationResult> => {
  const parsed = parseBridgeAndExecuteParams(params);
  const estimate = await estimateBridgeAndExecute(parsed, deps);

  let bridgeResult: BridgeAndExecuteSimulationResult['bridgeSimulation'] = null;

  if (estimate.initialPreviewState.intent.bridgeRequired) {
    bridgeResult = await simulateBridge(
      {
        recipient: deps.evm.address,
        dstChain: estimate.dstChain,
        dstToken: estimate.token,
        tokenAmount: estimate.initialPreviewState.shortfall.tokenShortfall,
        nativeAmount: estimate.initialPreviewState.shortfall.gasShortfall,
        sourceChains: estimate.initialPreviewState.sourceChains ?? parsed.sources ?? [],
      },
      deps
    );
  }

  return {
    bridgeSimulation: bridgeResult,
    executeSimulation: {
      feeParams: estimate.feeParams,
      estimatedGasUnits: estimate.gas.approval + estimate.gas.tx,
      estimatedTotalCost: estimate.requirementRaw.gas,
    },
  };
};

export const bridgeAndExecute = async (
  params: BridgeAndExecuteParams,
  deps: BridgeAndExecuteDeps,
  options?: BridgeAndExecuteOptions
): Promise<BridgeAndExecuteResult> => {
  const { emitEvent, emitStatus, emitPlanPreview, emitPlanConfirmed, emitExecuteProgress } =
    createBridgeAndExecuteProgressEmitter(options?.onEvent);

  emitStatus('preparing');

  const parsed = parseBridgeAndExecuteParams(params);
  emitStatus('intent_building');
  const estimate = await estimateBridgeAndExecute(parsed, deps);
  emitStatus('intent_ready');

  const {
    dstPublicClient,
    dstChain,
    address,
    token,
    tx,
    approvalTx,
    approvalContext,
    executeRequirement,
    resolveQuoteResponse,
    requirementRaw,
  } = estimate;
  const executePlan = createExecutePlanContext({
    chain: dstChain,
    tx,
    approval: approvalContext,
  });
  let previewState = estimate.initialPreviewState;

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
        reject(Errors.userDeniedIntent());
      };
      const refresh = async (selectedSources?: number[]): Promise<BridgeAndExecuteIntent> => {
        if (completed) {
          return currentState.intent;
        }

        const [unifiedBalances, oraclePrices] = await Promise.all([
          getBalancesForBridge({
            evmAddress: deps.evm.address,
            chainList: deps.chainList,
            middlewareClient: deps.middlewareClient,
          }),
          deps.middlewareClient.getOraclePrices(),
        ]);
        const refreshedPriceLookup = createPriceLookup(
          toPriceData(unifiedBalances),
          oraclePrices,
          deps.chainList
        );
        currentState = await buildCompositePreviewState(
          {
            address,
            dstChain,
            executePlan,
            executeRequirement,
            oraclePrices,
            priceLookup: refreshedPriceLookup,
            requirementRaw,
            sourceChains: selectedSources ?? parsed.sources,
            token,
            unifiedBalances,
            getQuoteResponse: resolveQuoteResponse,
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

  const applyBeforeExecute = async () => {
    if (!options?.beforeExecute) {
      return;
    }

    const response = await options.beforeExecute();
    logger.debug('BeforeExecuteHook', {
      response,
    });
    if (response.data) {
      tx.data = response.data;
    }

    if (response.value) {
      tx.value = response.value;
    }

    if (response.gas && response.gas !== 0n) {
      tx.gas = response.gas;
    }
  };

  emitStatus('executing');

  const runBridgePhase = async (): Promise<BridgeResult | null> => {
    if (!previewState.intent.bridgeRequired) {
      return null;
    }

    const bridgeExecutionResult = await executeBridge(
      {
        recipient: deps.evm.address,
        dstChain,
        dstToken: token,
        tokenAmount: previewState.shortfall.tokenShortfall,
        nativeAmount: previewState.shortfall.gasShortfall,
        sourceChains: previewState.sourceChains ?? parsed.sources ?? [],
      },
      deps,
      {
        emit: (event: BridgeEvent) => {
          if (event.type === 'plan_progress') {
            emitEvent(event);
          }
        },
        hooks: {
          onIntent: ({ allow }) => allow(),
          onAllowance: ({ sources, allow }) => allow(sources.map(() => 'min')),
        },
        fillTimeoutMinutes: options?.fillTimeoutMinutes,
      }
    );

    return {
      intentExplorerUrl: bridgeExecutionResult.intentExplorerUrl,
      sourceTxs: bridgeExecutionResult.sourceTxs,
      intent: bridgeExecutionResult.intent,
    };
  };

  const bridgeResult = await withTimingSpan(
    deps.timing,
    'flow.bridge_and_execute.run_bridge_phase',
    async () => runBridgePhase()
  );
  await applyBeforeExecute();

  const sendResult = await withTimingSpan(
    deps.timing,
    'flow.bridge_and_execute.run_execute_phase',
    async () =>
      sendExecuteTransactions(
        {
          approvalTx,
          tx,
          feeParams: estimate.feeParams,
          plan: executePlan,
        },
        {
          onProgress: (update) => emitExecuteProgress(update, executePlan),
          chain: dstChain,
          dstPublicClient,
          address,
          receiptTimeout: parsed.receiptTimeout,
          requiredConfirmations: parsed.requiredConfirmations,
          waitForReceipt: parsed.waitForReceipt,
          client: deps.evm.walletClient,
          timing: deps.timing,
        }
      )
  );
  emitStatus('completed');

  logger.debug('BridgeAndExecute:5', {
    sendResult,
  });

  const explorerBaseUrl = dstChain.blockExplorers?.default?.url;
  const execute: TxResult = {
    txHash: sendResult.txHash,
    txExplorerUrl: createExplorerTxURL(sendResult.txHash, explorerBaseUrl),
    receipt: sendResult.receipt,
  };
  const approval = sendResult.approvalHash
    ? ({
        txHash: sendResult.approvalHash,
        txExplorerUrl: createExplorerTxURL(sendResult.approvalHash, explorerBaseUrl),
      } satisfies TxResult)
    : undefined;

  if (bridgeResult) {
    return {
      approval,
      execute,
      bridgeSkipped: false,
      bridgeResult,
    };
  }

  return {
    approval,
    execute,
    bridgeSkipped: true,
    bridgeResult: undefined,
  };
};
