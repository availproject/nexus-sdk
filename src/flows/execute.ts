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
} from '../domain/utils/validation';
import {
  createExecutePlanContext,
  createExecuteTxContext,
  sendExecuteTransactions,
} from '../execute/runtime';
import { createExplorerTxURL } from '../services/explorer';
import type { ExecuteDeps } from './deps';

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

const parseExecuteParams = (input: ExecuteParams) => {
  return parseInput(executeParamsSchema, input);
};

const resolveTokenApproval = (params: ExecuteParams, deps: ExecuteDeps) =>
  params.tokenApproval
    ? {
        token: deps.chainList.getTokenInfoBySymbol(
          params.toChainId,
          params.tokenApproval.toTokenSymbol
        ),
        amount: BigInt(params.tokenApproval.amount),
        spender: params.tokenApproval.spender,
      }
    : undefined;

export const execute = async (params: ExecuteParams, deps: ExecuteDeps): Promise<ExecuteResult> => {
  const parsed = parseExecuteParams(params);
  const { dstPublicClient, dstChain, approvalTx, approvalContext, tx } =
    await createExecuteTxContext({
      chainList: deps.chainList,
      ownerAddress: deps.evm.address,
      toChainId: parsed.toChainId,
      to: parsed.to,
      value: parsed.value,
      data: parsed.data,
      gas: parsed.gas,
      tokenApproval: resolveTokenApproval(parsed, deps),
    });
  const executePlan = createExecutePlanContext({
    chain: dstChain,
    tx,
    approval: approvalContext,
  });

  const sendResult = await sendExecuteTransactions(
    {
      approvalTx,
      tx,
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
