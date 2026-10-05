import { encodeFunctionData, type Hex, type TransactionReceipt } from 'viem';
import type { Chain, EthereumProvider } from '../domain';
import { Errors, formatUnknownError } from '../domain/errors';
import {
  createPublicClientWithFallback,
  packERC20Approve,
  waitForTxReceipt,
} from '../services/evm';
import { createExplorerTxURL } from '../services/explorer';
import { isUserRejectedRequest } from '../services/is-user-rejected-request';
import type {
  IntentApprovalInstruction,
  IntentNativeTransactionInstruction,
  IntentRequiredSignature,
  IntentTransaction,
} from './types';

type IntentWalletClient = {
  getChainId?: () => Promise<number>;
  switchChain?: (input: { id: number }) => Promise<unknown>;
  addChain?: (input: { chain: Chain }) => Promise<unknown>;
  sendTransaction?: (input: Record<string, unknown>) => Promise<Hex>;
  signTypedData?: (
    input: Extract<IntentRequiredSignature, { kind: 'sourceApproval' }>['data'] & {
      account: Hex;
    }
  ) => Promise<Hex>;
};

type IntentWalletInput = {
  address: Hex;
  provider: Pick<EthereumProvider, 'request'>;
  walletClient: IntentWalletClient;
  chainList: Pick<import('../domain').ChainListType, 'getChainByID'>;
  confirm?: (chain: Chain, hash: Hex) => Promise<TransactionReceipt | undefined>;
};

const sameAddress = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

const defaultConfirm = async (chain: Chain, hash: Hex): Promise<TransactionReceipt> => {
  const publicClient = createPublicClientWithFallback(chain);
  const [receipt, error] = await waitForTxReceipt(hash, publicClient);
  if (error) throw error;
  return receipt;
};

export const createIntentWallet = (input: IntentWalletInput) => {
  const confirm = input.confirm ?? defaultConfirm;

  const switchTo = async (chain: Chain) => {
    if (!input.walletClient.getChainId || !input.walletClient.switchChain) {
      throw Errors.execution('Wallet client cannot switch chains', {
        service: 'wallet',
        chainId: chain.id,
      });
    }
    if ((await input.walletClient.getChainId()) === chain.id) return;
    try {
      await input.walletClient.switchChain({ id: chain.id });
    } catch (error) {
      if (isUserRejectedRequest(error)) throw Errors.userRejectedTxSend();
      if (!input.walletClient.addChain) {
        throw Errors.execution(`Failed to switch wallet chain: ${formatUnknownError(error)}`, {
          service: 'wallet',
          chainId: chain.id,
        });
      }
      await input.walletClient.addChain({ chain });
      await input.walletClient.switchChain({ id: chain.id });
    }
  };

  const send = async (
    chain: Chain,
    transaction: { to: Hex; data: Hex; value: bigint },
    onSubmitted?: (txHash: Hex) => void
  ): Promise<IntentTransaction> => {
    if (!input.walletClient.sendTransaction) {
      throw Errors.execution('Wallet client cannot send transactions', {
        service: 'wallet',
        chainId: chain.id,
      });
    }
    await switchTo(chain);
    let txHash: Hex;
    try {
      txHash = await input.walletClient.sendTransaction({
        account: input.address,
        chain,
        ...transaction,
      });
      onSubmitted?.(txHash);
    } catch (error) {
      if (isUserRejectedRequest(error)) throw Errors.userRejectedTxSend();
      throw Errors.execution(`Failed to send intent transaction: ${formatUnknownError(error)}`, {
        service: 'wallet',
        chainId: chain.id,
        details: { to: transaction.to },
      });
    }
    return {
      chainId: chain.id,
      txHash,
      txExplorerUrl: createExplorerTxURL(txHash, chain.blockExplorers?.default?.url),
    };
  };

  const confirmTransaction = async (
    transaction: IntentTransaction
  ): Promise<IntentTransaction> => ({
    ...transaction,
    receipt: await confirm(input.chainList.getChainByID(transaction.chainId), transaction.txHash),
  });

  const approve = async (
    instruction: IntentApprovalInstruction,
    amountRaw: bigint
  ): Promise<IntentTransaction> => {
    if (!sameAddress(instruction.owner, input.address)) {
      throw Errors.invalidInput(
        `Allowance owner ${instruction.owner} does not match connected account ${input.address}`
      );
    }
    if (amountRaw < instruction.requiredRaw) {
      throw Errors.invalidInput(
        `Allowance amount ${amountRaw} is below required amount ${instruction.requiredRaw}`
      );
    }
    const middlewareCall = amountRaw === instruction.requiredRaw ? instruction.approval : undefined;
    return send(input.chainList.getChainByID(instruction.chainId), {
      to: middlewareCall?.to ?? instruction.tokenAddress,
      data: middlewareCall?.data ?? packERC20Approve(instruction.spender, amountRaw),
      value: 0n,
    });
  };

  const sign = async (instruction: IntentRequiredSignature): Promise<Hex> => {
    if (instruction.kind === 'sourceApproval') {
      const owner =
        instruction.data.message[instruction.data.primaryType === 'Permit' ? 'owner' : 'from'];
      if (!owner || !sameAddress(owner, input.address)) {
        throw Errors.invalidInput('Permit owner does not match connected account');
      }
      if (!input.walletClient.signTypedData) {
        throw Errors.execution('Wallet client cannot sign typed data', {
          service: 'wallet',
          chainId: instruction.chainId,
        });
      }
      await switchTo(input.chainList.getChainByID(instruction.chainId));
    }
    try {
      const signature =
        instruction.kind === 'intent'
          ? await input.provider.request({
              method: 'personal_sign',
              params: [instruction.data.message, input.address],
            })
          : await input.walletClient.signTypedData?.({
              account: input.address,
              ...instruction.data,
            });
      if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signature)) {
        throw new Error('wallet returned an invalid signature');
      }
      return signature as Hex;
    } catch (error) {
      if (isUserRejectedRequest(error)) {
        throw instruction.kind === 'sourceApproval'
          ? Errors.userRejectedAllowance()
          : Errors.userRejectedIntentSignature();
      }
      throw Errors.execution(`Failed to sign ${instruction.kind}: ${formatUnknownError(error)}`, {
        service: 'wallet',
      });
    }
  };

  const sendNative = async (
    instruction: IntentNativeTransactionInstruction,
    signature: Hex,
    onSubmitted?: (txHash: Hex) => void
  ): Promise<IntentTransaction> => {
    const args =
      instruction.functionName === 'deposit'
        ? [instruction.vaultRequest, signature, BigInt(instruction.sourceIndex)]
        : [
            instruction.vaultRequest,
            signature,
            BigInt(instruction.sourceIndex),
            instruction.payload,
            '0x',
          ];
    if (instruction.functionName === 'depositRouter' && !instruction.payload) {
      throw Errors.invalidInput(
        `Native transaction ${instruction.sourceIndex} is missing its routing payload`
      );
    }
    const data = encodeFunctionData({
      abi: instruction.abi,
      functionName: instruction.functionName,
      args,
    });
    return confirmTransaction(
      await send(
        input.chainList.getChainByID(instruction.chainId),
        {
          to: instruction.to,
          data,
          value: instruction.valueRaw,
        },
        onSubmitted
      )
    );
  };

  return { approve, confirmTransaction, sign, sendNative };
};
