import {
  createPublicClient,
  type Hex,
  http,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
} from 'viem';
import {
  type Chain,
  type ChainListType,
  type ExecuteApprovalStep,
  type ExecuteFeeParams,
  type ExecutePlanStep,
  type ExecuteTransactionStep,
  logger,
  type PlanTokenMetadata,
  type TimingSpanHooks,
  type TokenInfo,
  type Tx,
} from '../domain';
import { ERROR_CODES, Errors, ExecutionError, formatUnknownError } from '../domain/errors';
import { isNativeAddress } from '../services/addresses';
import { erc20GetAllowance } from '../services/allowance-utils';
import { packERC20Approve, switchChain, waitForTxReceipt } from '../services/evm';
import { createExplorerTxURL } from '../services/explorer';
import { isUserRejectedRequest } from '../services/is-user-rejected-request';
import { divDecimals } from '../services/math';
import { runNonBlocking } from '../services/non-blocking';
import { createExecuteApprovalStepId, createExecuteTransactionStepId } from '../services/step-ids';
import { equalFold } from '../services/strings';
import { withRootTimingSpan, withTimingSpan } from '../services/timing';
import { getAtomicBatchSupport } from '../services/wallet-capabilities';

export type { ExecuteFeeParams } from '../domain';

export const isNativeExecuteToken = (chainList: ChainListType, chain: Chain, tokenAddress: Hex) =>
  isNativeAddress(tokenAddress) ||
  equalFold(tokenAddress, chainList.getNativeToken(chain.id).contractAddress);

export type ExecuteApprovalContext = {
  token: PlanTokenMetadata;
  spender: Hex;
  amount: bigint;
};

export type AllowanceCheck = {
  tokenAddress: Hex;
  spender: Hex;
  requiredAllowance: bigint;
};

// Sync, no I/O. Builds the execute tx and — when a token approval is requested — a
// *speculative* approval tx plus the `allowanceCheck` needed to decide if it's required.
// Callers that want the allowance read off the critical path run it in parallel with their
// other fetches, then keep or drop the speculative approval based on the result.
export const buildExecuteTxs = (input: {
  chainList: ChainListType;
  toChainId: number;
  to: Hex;
  value?: bigint;
  data?: Hex;
  gas?: bigint;
  tokenApproval?: {
    tokenAddress: Hex;
    amount: bigint;
    spender: Hex;
  };
}): {
  dstChain: Chain;
  dstPublicClient: PublicClient;
  tx: Tx;
  speculativeApprovalTx: Tx | null;
  allowanceCheck: AllowanceCheck | null;
} => {
  const dstChain = input.chainList.getChainByID(input.toChainId);
  const dstPublicClient = createPublicClient({
    chain: dstChain,
    transport: http(dstChain.rpcUrls.default.http[0]),
  });

  let speculativeApprovalTx: Tx | null = null;
  let allowanceCheck: AllowanceCheck | null = null;
  if (input.tokenApproval) {
    const { tokenAddress, amount, spender } = input.tokenApproval;
    speculativeApprovalTx = {
      to: tokenAddress,
      data: packERC20Approve(spender, amount),
      value: 0n,
    };
    allowanceCheck = { tokenAddress, spender, requiredAllowance: amount };
  }

  const tx: Tx = {
    to: input.to,
    value: input.value ?? 0n,
    data: input.data ?? '0x',
    gas: input.gas,
  };

  return { dstChain, dstPublicClient, tx, speculativeApprovalTx, allowanceCheck };
};

export const createExecuteTxContext = async (input: {
  chainList: ChainListType;
  ownerAddress: Hex;
  toChainId: number;
  to: Hex;
  value?: bigint;
  data?: Hex;
  gas?: bigint;
  tokenApproval?: {
    token: TokenInfo;
    amount: bigint;
    spender: Hex;
  };
}) => {
  const { dstChain, dstPublicClient, tx, speculativeApprovalTx, allowanceCheck } = buildExecuteTxs({
    ...input,
    tokenApproval: input.tokenApproval
      ? {
          tokenAddress: input.tokenApproval.token.contractAddress,
          amount: input.tokenApproval.amount,
          spender: input.tokenApproval.spender,
        }
      : undefined,
  });

  let approvalTx: Tx | null = null;
  let approvalContext: ExecuteApprovalContext | null = null;
  if (allowanceCheck && speculativeApprovalTx && input.tokenApproval) {
    const currentAllowance = await erc20GetAllowance(
      {
        contractAddress: allowanceCheck.tokenAddress,
        spender: allowanceCheck.spender,
        owner: input.ownerAddress,
      },
      dstPublicClient
    );
    if (currentAllowance < allowanceCheck.requiredAllowance) {
      approvalTx = speculativeApprovalTx;
      approvalContext = {
        token: input.tokenApproval.token,
        spender: allowanceCheck.spender,
        amount: allowanceCheck.requiredAllowance,
      };
    }
  }

  return { dstChain, dstPublicClient, tx, approvalTx, approvalContext };
};

export type ExecuteProgressUpdate =
  | {
      stepType: 'execute_approval';
      state: 'wallet_prompted';
    }
  | {
      stepType: 'execute_approval';
      state: 'submitted';
      txHash: Hex;
      explorerUrl: string;
    }
  | {
      stepType: 'execute_approval';
      state: 'confirmed';
      txHash: Hex;
      explorerUrl: string;
    }
  | {
      stepType: 'execute_approval';
      state: 'failed';
      txHash?: Hex;
      explorerUrl?: string;
      error: string;
    }
  | {
      stepType: 'execute_transaction';
      state: 'wallet_prompted';
      value: string;
      hasData: boolean;
    }
  | {
      stepType: 'execute_transaction';
      state: 'submitted';
      value: string;
      hasData: boolean;
      txHash: Hex;
      explorerUrl: string;
    }
  | {
      stepType: 'execute_transaction';
      state: 'confirmed';
      value: string;
      hasData: boolean;
      txHash: Hex;
      explorerUrl: string;
    }
  | {
      stepType: 'execute_transaction';
      state: 'failed';
      value: string;
      hasData: boolean;
      txHash?: Hex;
      explorerUrl?: string;
      error: string;
    };

export type ExecutePlanContext = {
  steps: ExecutePlanStep[];
  approvalStep?: ExecuteApprovalStep;
  transactionStep: ExecuteTransactionStep;
};

export type ExecuteSendResult = {
  txHash: Hex;
  receipt: TransactionReceipt | undefined;
  approvalHash: Hex | undefined;
};

export const toPlanTokenMetadata = (token: PlanTokenMetadata): PlanTokenMetadata => token;

const toChainDisplay = (chain: Chain) => {
  const {
    id,
    name,
    custom: { icon: logo },
  } = chain;
  return {
    id,
    name,
    logo,
  };
};

export const createExecutePlanContext = (input: {
  chain: Chain;
  tx: Tx;
  approval?: ExecuteApprovalContext | null;
}): ExecutePlanContext => {
  const transactionStep: ExecuteTransactionStep = {
    type: 'execute_transaction',
    id: createExecuteTransactionStepId(input.chain.id, input.tx.to),
    chain: toChainDisplay(input.chain),
    to: input.tx.to,
  };

  const approvalStep = input.approval
    ? ({
        type: 'execute_approval',
        id: createExecuteApprovalStepId(input.chain.id, input.approval.token.contractAddress),
        chain: toChainDisplay(input.chain),
        token: toPlanTokenMetadata(input.approval.token),
        spender: input.approval.spender,
        amount: divDecimals(input.approval.amount, input.approval.token.decimals).toFixed(),
        amountRaw: input.approval.amount.toString(),
      } satisfies ExecuteApprovalStep)
    : undefined;

  return {
    steps: approvalStep ? [approvalStep, transactionStep] : [transactionStep],
    approvalStep,
    transactionStep,
  };
};

const spreadFeeParams = (feeParams?: ExecuteFeeParams) => {
  if (!feeParams) return {};
  if (feeParams.type === 'legacy') return { gasPrice: feeParams.gasPrice };
  return {
    maxFeePerGas: feeParams.maxFeePerGas,
    maxPriorityFeePerGas: feeParams.maxPriorityFeePerGas,
  };
};

export const supportsAtomicExecuteBatch = async (
  client: WalletClient,
  address: Hex,
  chainId: number
): Promise<boolean> => {
  try {
    const atomicBatchSupport = await getAtomicBatchSupport(client, address, [chainId]);
    logger.debug('atomic-execute-batch', {
      address,
      chainId,
      atomicBatchSupport,
    });
    return atomicBatchSupport.get(chainId) ?? false;
  } catch {
    return false;
  }
};

export const sendExecuteTransactions = async (
  params: {
    tx: Tx;
    approvalTx: Tx | null;
    plan: ExecutePlanContext;
    feeParams?: ExecuteFeeParams;
  },
  options: {
    onProgress?: (update: ExecuteProgressUpdate) => void;
    chain: Chain;
    dstPublicClient: PublicClient;
    address: Hex;
    client: WalletClient;
    waitForReceipt?: boolean;
    receiptTimeout?: number;
    requiredConfirmations?: number;
    timing?: TimingSpanHooks;
  }
): Promise<ExecuteSendResult> =>
  withRootTimingSpan(options.timing, 'flow.execute.send_tx', async (sendTxSpanId) => {
    const { waitForReceipt = true, receiptTimeout = 300000, requiredConfirmations = 1 } = options;
    await switchChain(options.client, options.chain);

    const transactionMeta = {
      value: params.tx.value.toString(),
      hasData: params.tx.data !== '0x',
    };

    const emitProgress = (update: ExecuteProgressUpdate) => {
      runNonBlocking(
        'ExecuteProgressEmitFailed',
        () => {
          options.onProgress?.(update);
        },
        {
          stepType: update.stepType,
          state: update.state,
        }
      );
    };

    let approvalHash: Hex | undefined;
    if (params.approvalTx) {
      const approvalStep = params.plan.approvalStep;
      if (!approvalStep) {
        throw Errors.internal(
          'execute approval transaction exists without execute approval plan step'
        );
      }

      const atomicBatchSupported = await supportsAtomicExecuteBatch(
        options.client,
        options.address,
        options.chain.id
      );

      if (atomicBatchSupported) {
        emitProgress({
          stepType: 'execute_approval',
          state: 'wallet_prompted',
        });
        emitProgress({
          stepType: 'execute_transaction',
          state: 'wallet_prompted',
          ...transactionMeta,
        });

        const dispatch = await options.client
          .sendCalls({
            account: options.address,
            chain: options.chain,
            forceAtomic: true,
            calls: [
              {
                to: params.approvalTx.to,
                data: params.approvalTx.data,
                value: params.approvalTx.value,
              },
              {
                to: params.tx.to,
                data: params.tx.data,
                value: params.tx.value,
              },
            ],
          })
          .catch((error) => {
            const stepError = isUserRejectedRequest(error)
              ? Errors.userRejectedTxSend()
              : new ExecutionError(
                  ERROR_CODES.EXEC_TX_SEND_FAILED,
                  `Failed to send atomic execute batch: ${formatUnknownError(error)}`,
                  {
                    context: {
                      service: 'wallet',
                      stepId: params.plan.transactionStep.id,
                      stepType: 'execute_transaction',
                      chainId: options.chain.id,
                    },
                    details: { to: params.tx.to },
                  }
                );
            emitProgress({
              stepType: 'execute_approval',
              state: 'failed',
              error: formatUnknownError(stepError),
            });
            emitProgress({
              stepType: 'execute_transaction',
              state: 'failed',
              ...transactionMeta,
              error: formatUnknownError(stepError),
            });
            throw stepError;
          });

        const batchResult = await options.client
          .waitForCallsStatus({
            id: dispatch.id,
            timeout: receiptTimeout,
          })
          .catch((error) => {
            const stepError = new ExecutionError(
              ERROR_CODES.EXEC_ATOMIC_BATCH_STATUS_FAILED,
              `Failed to resolve atomic execute batch status: ${formatUnknownError(error)}`,
              {
                context: {
                  service: 'rpc',
                  stepId: params.plan.transactionStep.id,
                  stepType: 'execute_transaction',
                  chainId: options.chain.id,
                },
                details: { to: params.tx.to },
              }
            );
            emitProgress({
              stepType: 'execute_approval',
              state: 'failed',
              error: formatUnknownError(stepError),
            });
            emitProgress({
              stepType: 'execute_transaction',
              state: 'failed',
              ...transactionMeta,
              error: formatUnknownError(stepError),
            });
            throw stepError;
          });

        const receipts = batchResult.receipts ?? [];
        approvalHash = receipts[0]?.transactionHash as Hex | undefined;
        const txHash =
          (receipts[receipts.length - 1]?.transactionHash as Hex | undefined) ?? approvalHash;
        const approvalExplorerUrl = approvalHash
          ? createExplorerTxURL(approvalHash, options.chain.blockExplorers?.default?.url)
          : undefined;
        const txExplorerUrl = txHash
          ? createExplorerTxURL(txHash, options.chain.blockExplorers?.default?.url)
          : undefined;

        if (approvalHash && approvalExplorerUrl !== undefined) {
          emitProgress({
            stepType: 'execute_approval',
            state: 'submitted',
            txHash: approvalHash,
            explorerUrl: approvalExplorerUrl,
          });
        }
        if (txHash && txExplorerUrl !== undefined) {
          emitProgress({
            stepType: 'execute_transaction',
            state: 'submitted',
            ...transactionMeta,
            txHash,
            explorerUrl: txExplorerUrl,
          });
        }

        if (batchResult.status !== 'success' || !txHash) {
          const stepError = new ExecutionError(
            ERROR_CODES.EXEC_TX_ONCHAIN_REVERTED,
            'Atomic execute batch failed',
            {
              context: {
                service: 'rpc',
                stepId: params.plan.transactionStep.id,
                stepType: 'execute_transaction',
                chainId: options.chain.id,
              },
            }
          );
          emitProgress({
            stepType: 'execute_approval',
            state: 'failed',
            txHash: approvalHash,
            explorerUrl: approvalExplorerUrl,
            error: formatUnknownError(stepError),
          });
          emitProgress({
            stepType: 'execute_transaction',
            state: 'failed',
            ...transactionMeta,
            txHash,
            explorerUrl: txExplorerUrl,
            error: formatUnknownError(stepError),
          });
          throw stepError;
        }

        if (approvalHash && approvalExplorerUrl !== undefined) {
          emitProgress({
            stepType: 'execute_approval',
            state: 'confirmed',
            txHash: approvalHash,
            explorerUrl: approvalExplorerUrl,
          });
        }

        let receipt: TransactionReceipt | undefined;
        if (waitForReceipt) {
          const waitForReceiptCall = async () => {
            const [r, error] = await waitForTxReceipt(
              txHash,
              options.dstPublicClient,
              requiredConfirmations,
              receiptTimeout
            );
            if (error) throw error;
            return r;
          };
          receipt = await withTimingSpan(
            options.timing,
            'flow.execute.wait_receipt',
            waitForReceiptCall,
            sendTxSpanId ? { parentSpanId: sendTxSpanId } : undefined
          ).catch((error) => {
            const stepError = new ExecutionError(
              ERROR_CODES.EXEC_TX_CONFIRM_FAILED,
              `Failed to confirm execute transaction: ${formatUnknownError(error)}`,
              {
                context: {
                  service: 'rpc',
                  stepId: params.plan.transactionStep.id,
                  stepType: 'execute_transaction',
                  chainId: options.chain.id,
                },
                details: { to: params.tx.to, txHash },
              }
            );
            emitProgress({
              stepType: 'execute_transaction',
              state: 'failed',
              ...transactionMeta,
              txHash,
              explorerUrl: txExplorerUrl,
              error: formatUnknownError(stepError),
            });
            throw stepError;
          });

          emitProgress({
            stepType: 'execute_transaction',
            state: 'confirmed',
            ...transactionMeta,
            txHash,
            explorerUrl: txExplorerUrl ?? '',
          });
        }

        return {
          txHash,
          receipt,
          approvalHash,
        };
      }

      emitProgress({
        stepType: 'execute_approval',
        state: 'wallet_prompted',
      });
      approvalHash = await options.client
        .sendTransaction({
          ...params.approvalTx,
          account: options.address,
          chain: options.chain,
          ...spreadFeeParams(params.feeParams),
        })
        .catch((error) => {
          const stepError = isUserRejectedRequest(error)
            ? Errors.userRejectedAllowance()
            : new ExecutionError(
                ERROR_CODES.EXEC_APPROVAL_TX_SEND_FAILED,
                `Failed to send approval transaction: ${formatUnknownError(error)}`,
                {
                  context: {
                    service: 'wallet',
                    stepId: approvalStep.id,
                    stepType: 'execute_approval',
                    chainId: options.chain.id,
                  },
                  details: { to: params.approvalTx?.to },
                }
              );
          emitProgress({
            stepType: 'execute_approval',
            state: 'failed',
            error: formatUnknownError(stepError),
          });
          throw stepError;
        });

      const approvalExplorerUrl = createExplorerTxURL(
        approvalHash,
        options.chain.blockExplorers?.default?.url
      );
      emitProgress({
        stepType: 'execute_approval',
        state: 'submitted',
        txHash: approvalHash,
        explorerUrl: approvalExplorerUrl,
      });

      await waitForTxReceipt(approvalHash, options.dstPublicClient, 1)
        .then(([, error]) => {
          if (error) throw error;
        })
        .catch((error) => {
          const stepError = new ExecutionError(
            ERROR_CODES.EXEC_APPROVAL_TX_CONFIRM_FAILED,
            `Failed to confirm approval transaction: ${formatUnknownError(error)}`,
            {
              context: {
                service: 'rpc',
                stepId: approvalStep.id,
                stepType: 'execute_approval',
                chainId: options.chain.id,
              },
              details: { to: params.approvalTx?.to, txHash: approvalHash },
            }
          );
          emitProgress({
            stepType: 'execute_approval',
            state: 'failed',
            txHash: approvalHash,
            explorerUrl: approvalExplorerUrl,
            error: formatUnknownError(stepError),
          });
          throw stepError;
        });

      emitProgress({
        stepType: 'execute_approval',
        state: 'confirmed',
        txHash: approvalHash,
        explorerUrl: approvalExplorerUrl,
      });
    }

    emitProgress({
      stepType: 'execute_transaction',
      state: 'wallet_prompted',
      ...transactionMeta,
    });
    const txHash = await options.client
      .sendTransaction({
        ...params.tx,
        account: options.address,
        chain: options.chain,
        ...spreadFeeParams(params.feeParams),
      })
      .catch((error) => {
        const stepError = isUserRejectedRequest(error)
          ? Errors.userRejectedTxSend()
          : new ExecutionError(
              ERROR_CODES.EXEC_TX_SEND_FAILED,
              `Failed to send transaction: ${formatUnknownError(error)}`,
              {
                context: {
                  service: 'wallet',
                  stepId: params.plan.transactionStep.id,
                  stepType: 'execute_transaction',
                  chainId: options.chain.id,
                },
                details: { to: params.tx.to },
              }
            );
        emitProgress({
          stepType: 'execute_transaction',
          state: 'failed',
          ...transactionMeta,
          error: formatUnknownError(stepError),
        });
        throw stepError;
      });

    const txExplorerUrl = createExplorerTxURL(txHash, options.chain.blockExplorers?.default?.url);
    emitProgress({
      stepType: 'execute_transaction',
      state: 'submitted',
      ...transactionMeta,
      txHash,
      explorerUrl: txExplorerUrl,
    });

    let receipt: TransactionReceipt | undefined;
    if (waitForReceipt) {
      const waitForReceiptCall = async () => {
        const [r, error] = await waitForTxReceipt(
          txHash,
          options.dstPublicClient,
          requiredConfirmations,
          receiptTimeout
        );
        if (error) throw error;
        return r;
      };
      receipt = await withTimingSpan(
        options.timing,
        'flow.execute.wait_receipt',
        waitForReceiptCall,
        sendTxSpanId ? { parentSpanId: sendTxSpanId } : undefined
      ).catch((error) => {
        const stepError = new ExecutionError(
          ERROR_CODES.EXEC_TX_CONFIRM_FAILED,
          `Failed to confirm execute transaction: ${formatUnknownError(error)}`,
          {
            context: {
              service: 'rpc',
              stepId: params.plan.transactionStep.id,
              stepType: 'execute_transaction',
              chainId: options.chain.id,
            },
            details: { to: params.tx.to, txHash },
          }
        );
        emitProgress({
          stepType: 'execute_transaction',
          state: 'failed',
          ...transactionMeta,
          txHash,
          explorerUrl: txExplorerUrl,
          error: formatUnknownError(stepError),
        });
        throw stepError;
      });

      emitProgress({
        stepType: 'execute_transaction',
        state: 'confirmed',
        ...transactionMeta,
        txHash,
        explorerUrl: txExplorerUrl,
      });
    }

    return {
      txHash,
      receipt,
      approvalHash,
    };
  });
