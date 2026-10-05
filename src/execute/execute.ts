import { z } from 'zod';
import type {
  ExecuteFeeParams,
  ExecuteParams,
  ExecuteResult,
  ExecuteSimulation,
  TxResult,
} from '../domain';
import { Errors, formatUnknownError } from '../domain/errors';
import {
  addressString,
  hexString,
  nonNegativeBigint,
  nonNegativeInt,
  parseInput,
  positiveInt,
} from '../domain/validation';
import { createExplorerTxURL } from '../services/explorer';
import type { ExecuteDeps } from './deps';
import { estimateTotalFees, type TxWithGas } from './fee-estimation';
import {
  createExecutePlanContext,
  createExecuteTxContext,
  sendExecuteTransactions,
} from './runtime';

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
      toTokenAddress: addressString,
      amount: nonNegativeBigint,
      spender: addressString,
    })
    .optional(),
});

const parseExecuteParams = (input: ExecuteParams) => {
  return parseInput(executeParamsSchema, input);
};

const resolveTokenApproval = (params: ExecuteParams, deps: ExecuteDeps) =>
  params.tokenApproval
    ? {
        token: deps.chainList.getTokenByAddress(
          params.toChainId,
          params.tokenApproval.toTokenAddress
        ),
        amount: BigInt(params.tokenApproval.amount),
        spender: params.tokenApproval.spender,
      }
    : undefined;

export const execute = async (
  params: ExecuteParams,
  deps: ExecuteDeps,
  prepared?: Awaited<ReturnType<typeof priceExecuteFunding>>
): Promise<ExecuteResult> => {
  const parsed = parseExecuteParams(params);
  const { dstPublicClient, dstChain, approvalTx, approvalContext, tx } =
    prepared ??
    (await createExecuteTxContext({
      chainList: deps.chainList,
      ownerAddress: deps.evm.address,
      toChainId: parsed.toChainId,
      to: parsed.to,
      value: parsed.value,
      data: parsed.data,
      gas: parsed.gas,
      tokenApproval: resolveTokenApproval(parsed, deps),
    }));
  const executePlan = createExecutePlanContext({
    chain: dstChain,
    tx,
    approval: approvalContext,
  });

  const sendResult = await sendExecuteTransactions(
    {
      approvalTx,
      tx: { ...tx, value: parsed.value ?? 0n, data: parsed.data ?? '0x', gas: parsed.gas },
      feeParams: prepared?.feeParams,
      plan: executePlan,
    },
    {
      chain: dstChain,
      dstPublicClient,
      address: deps.evm.address,
      receiptTimeout: parsed.receiptTimeout,
      requiredConfirmations: parsed.requiredConfirmations,
      waitForReceipt: parsed.waitForReceipt,
      client: deps.evm.walletClient,
      timing: deps.timing,
    }
  );

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

  return {
    approval,
    execute,
    chainId: parsed.toChainId,
    confirmations: parsed.requiredConfirmations,
    effectiveGasPrice: String(sendResult.receipt?.effectiveGasPrice ?? 0n),
    gasUsed: String(sendResult.receipt?.gasUsed ?? 0n),
  };
};

export const prepareExecuteFunding = async (
  params: ExecuteParams & { gas: bigint },
  deps: ExecuteDeps
) => {
  const parsed = parseInput(executeParamsSchema.required({ gas: true }), params);
  const context = await createExecuteTxContext({
    ...parsed,
    chainList: deps.chainList,
    ownerAddress: deps.evm.address,
    tokenApproval: resolveTokenApproval(parsed, deps),
  });
  const { approvalTx, dstPublicClient, tx } = context;
  const approvalGas = approvalTx
    ? await dstPublicClient
        .estimateGas({
          to: approvalTx.to,
          data: approvalTx.data,
          value: approvalTx.value,
          account: deps.evm.address,
        })
        .catch(() => 70_000n)
    : 0n;
  const feeItems: TxWithGas[] = [
    ...(approvalTx
      ? [{ tx: approvalTx, gasEstimate: approvalGas, gasEstimateKind: 'final' as const }]
      : []),
    { tx, gasEstimate: parsed.gas },
  ];
  return { ...context, feeItems, priceTier: parsed.gasPrice ?? 'medium' };
};

export const priceExecuteFunding = async (
  prepared: Awaited<ReturnType<typeof prepareExecuteFunding>>
) => {
  const fees = await estimateTotalFees(
    prepared.dstPublicClient,
    prepared.dstChain.id,
    prepared.feeItems,
    prepared.priceTier
  );
  const txFee = fees[prepared.approvalTx ? 1 : 0].recommended;
  const feeParams: ExecuteFeeParams = txFee.useLegacyPricing
    ? { type: 'legacy', gasPrice: txFee.maxFeePerGas }
    : {
        type: 'eip1559',
        maxFeePerGas: txFee.maxFeePerGas,
        maxPriorityFeePerGas: txFee.maxPriorityFeePerGas,
      };
  return {
    ...prepared,
    tx: { ...prepared.tx, gas: txFee.gasLimit },
    approvalTx: prepared.approvalTx
      ? { ...prepared.approvalTx, gas: fees[0].recommended.gasLimit }
      : null,
    feeParams,
    estimatedTotalCost: fees.reduce((sum, fee) => sum + fee.recommended.totalMaxCost, 0n),
    l1Fee: fees.reduce((sum, fee) => sum + fee.l1Fee, 0n),
  };
};

export const simulateExecute = async (
  params: ExecuteParams,
  deps: ExecuteDeps
): Promise<ExecuteSimulation> => {
  const parsed = parseExecuteParams(params);
  const { dstPublicClient, tx, approvalTx } = await createExecuteTxContext({
    chainList: deps.chainList,
    ownerAddress: deps.evm.address,
    toChainId: parsed.toChainId,
    to: parsed.to,
    value: parsed.value,
    data: parsed.data,
    gas: parsed.gas,
    tokenApproval: resolveTokenApproval(parsed, deps),
  });

  const estimateGas = (target: { to: `0x${string}`; data?: `0x${string}`; value?: bigint }) =>
    dstPublicClient
      .estimateGas({
        to: target.to,
        data: target.data,
        value: target.value,
        account: deps.evm.address,
      })
      .catch((error) => {
        throw Errors.execution(`Failed to estimate gas: ${formatUnknownError(error)}`, {
          service: 'rpc',
          chainId: parsed.toChainId,
          details: { to: target.to },
        });
      });

  const [txGasUsed, approvalGasUsed, feeEstimate] = await Promise.all([
    estimateGas(tx),
    approvalTx ? estimateGas(approvalTx) : Promise.resolve(0n),
    dstPublicClient.estimateFeesPerGas().catch((error) => {
      throw Errors.execution(`Failed to estimate fees per gas: ${formatUnknownError(error)}`, {
        service: 'rpc',
        chainId: parsed.toChainId,
      });
    }),
  ]);

  const totalGasUsed = txGasUsed + approvalGasUsed;
  const maxFeePerGas = feeEstimate.maxFeePerGas;
  const effectiveGasPrice = maxFeePerGas ?? feeEstimate.gasPrice ?? 0n;
  if (effectiveGasPrice === 0n) {
    throw Errors.gasPriceError({});
  }

  const feeParams: ExecuteFeeParams =
    maxFeePerGas == null
      ? { type: 'legacy', gasPrice: effectiveGasPrice }
      : {
          type: 'eip1559',
          maxFeePerGas,
          maxPriorityFeePerGas: feeEstimate.maxPriorityFeePerGas ?? 0n,
        };

  return {
    feeParams,
    estimatedGasUnits: totalGasUsed,
    estimatedTotalCost: totalGasUsed * effectiveGasPrice,
  };
};
