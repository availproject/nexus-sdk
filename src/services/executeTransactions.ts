import type { Hex, PublicClient, TransactionReceipt, WalletClient } from 'viem';
import { BRIDGE_STEPS, type Chain, NEXUS_EVENTS, type OnEventParam, type Tx } from '../commons';
import { Errors } from '../sdk/ca-base/errors';
import { switchChain, waitForTxReceipt } from '../sdk/ca-base/utils';
import { getAtomicBatchSupport } from './walletCapabilities';

export type ExecuteFeeParams =
  | {
      type: 'legacy';
      gasPrice: bigint;
    }
  | {
      type: 'eip1559';
      maxFeePerGas: bigint;
      maxPriorityFeePerGas: bigint;
    };

type ExecuteSendResult = {
  txHash: Hex;
  receipt: TransactionReceipt | undefined;
  approvalHash: Hex | undefined;
};

const spreadFeeParams = (feeParams?: ExecuteFeeParams) => {
  if (!feeParams) {
    return {};
  }

  if (feeParams.type === 'legacy') {
    return { gasPrice: feeParams.gasPrice };
  }

  return {
    maxFeePerGas: feeParams.maxFeePerGas,
    maxPriorityFeePerGas: feeParams.maxPriorityFeePerGas,
  };
};

export const sendExecuteTransactions = async (
  params: {
    tx: Tx;
    approvalTx: Tx | null;
    feeParams?: ExecuteFeeParams;
  },
  options: {
    emit?: OnEventParam['onEvent'];
    chain: Chain;
    dstPublicClient: PublicClient;
    address: Hex;
    client: WalletClient;
    waitForReceipt?: boolean;
    receiptTimeout?: number;
    requiredConfirmations?: number;
  }
): Promise<ExecuteSendResult> => {
  const { waitForReceipt = true, receiptTimeout = 300000, requiredConfirmations = 1 } = options;
  await switchChain(options.client, options.chain);

  let approvalHash: Hex | undefined;
  if (params.approvalTx) {
    const atomicBatchSupport = await getAtomicBatchSupport(options.client, options.address, [
      options.chain.id,
    ]);

    if (atomicBatchSupport.get(options.chain.id)) {
      const dispatch = await options.client.sendCalls({
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
      });

      if (options.emit) {
        options.emit({
          name: NEXUS_EVENTS.STEP_COMPLETE,
          args: BRIDGE_STEPS.EXECUTE_TRANSACTION_SENT,
        });
      }

      const batchResult = await options.client.waitForCallsStatus({
        id: dispatch.id,
        timeout: receiptTimeout,
      });
      const receipts = batchResult.receipts ?? [];
      approvalHash = receipts[0]?.transactionHash as Hex | undefined;
      const txHash =
        (receipts[receipts.length - 1]?.transactionHash as Hex | undefined) ?? approvalHash;

      if (batchResult.status !== 'success' || !txHash) {
        throw Errors.internal('Atomic execute batch failed');
      }

      if (options.emit && approvalHash) {
        options.emit({
          name: NEXUS_EVENTS.STEP_COMPLETE,
          args: BRIDGE_STEPS.EXECUTE_APPROVAL_STEP,
        });
      }

      let receipt: TransactionReceipt | undefined;
      if (waitForReceipt) {
        receipt = await waitForTxReceipt(
          txHash,
          options.dstPublicClient,
          requiredConfirmations,
          receiptTimeout
        );

        if (options.emit) {
          options.emit({
            name: NEXUS_EVENTS.STEP_COMPLETE,
            args: BRIDGE_STEPS.EXECUTE_TRANSACTION_CONFIRMED,
          });
        }
      }

      return {
        txHash,
        receipt,
        approvalHash,
      };
    }

    approvalHash = await options.client.sendTransaction({
      ...params.approvalTx,
      account: options.address,
      chain: options.chain,
      ...spreadFeeParams(params.feeParams),
    });

    await waitForTxReceipt(approvalHash, options.dstPublicClient, 1);
    if (options.emit) {
      options.emit({
        name: NEXUS_EVENTS.STEP_COMPLETE,
        args: BRIDGE_STEPS.EXECUTE_APPROVAL_STEP,
      });
    }
  }

  const txHash = await options.client.sendTransaction({
    ...params.tx,
    account: options.address,
    chain: options.chain,
    ...spreadFeeParams(params.feeParams),
  });

  if (options.emit) {
    options.emit({
      name: NEXUS_EVENTS.STEP_COMPLETE,
      args: BRIDGE_STEPS.EXECUTE_TRANSACTION_SENT,
    });
  }

  let receipt: TransactionReceipt | undefined;
  if (waitForReceipt) {
    receipt = await waitForTxReceipt(
      txHash,
      options.dstPublicClient,
      requiredConfirmations,
      receiptTimeout
    );

    if (options.emit) {
      options.emit({
        name: NEXUS_EVENTS.STEP_COMPLETE,
        args: BRIDGE_STEPS.EXECUTE_TRANSACTION_CONFIRMED,
      });
    }
  }

  return {
    txHash,
    receipt,
    approvalHash,
  };
};
