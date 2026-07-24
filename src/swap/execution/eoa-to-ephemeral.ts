import type { Hex, PublicClient, WalletClient } from 'viem';
import { type Chain, getLogger } from '../../domain';
import { confirmStepReceipt, switchChain } from '../../services/evm';
import type { SBCCall } from '../../services/sbc';
import { createEoaToEphemeralTransferStepId } from '../../services/step-ids';
import type { PreparedEoaToEphemeralTransfer } from '../types';
import type { SwapCache } from '../wallet/cache';
import {
  buildDirectApprovalRequest,
  materializePermitAuthorizationCall,
} from '../wallet/transfer-authorization';

const logger = getLogger();

type ResolvePreparedFundingTransferCallsInput = {
  transfer: PreparedEoaToEphemeralTransfer;
  tokenDecimals: number;
  chain: Chain;
  eoaAddress: Hex;
  eoaWallet: WalletClient;
  publicClient: Pick<PublicClient, 'waitForTransactionReceipt' | 'readContract'>;
  cache?: Pick<SwapCache, 'getAllowance'> & Partial<Pick<SwapCache, 'setAllowance'>>;
};

const ensureDirectApproval = async (
  input: ResolvePreparedFundingTransferCallsInput
): Promise<void> => {
  const cachedAllowance =
    input.cache?.getAllowance(
      input.transfer.tokenAddress,
      input.eoaAddress,
      input.transfer.targetAddress,
      input.chain.id
    ) ?? 0n;
  if (cachedAllowance >= input.transfer.amount) {
    logger.debug('swap.execute.funding.approval_skipped', {
      chainId: input.chain.id,
      tokenAddress: input.transfer.tokenAddress,
      amountRaw: input.transfer.amount.toString(),
      cachedAllowanceRaw: cachedAllowance.toString(),
    });
    return;
  }

  logger.debug('swap.execute.funding.approval_started', {
    chainId: input.chain.id,
    tokenAddress: input.transfer.tokenAddress,
    amountRaw: input.transfer.amount.toString(),
  });
  await switchChain(input.eoaWallet, input.chain);
  const txHash = await input.eoaWallet.writeContract(
    buildDirectApprovalRequest({
      tokenAddress: input.transfer.tokenAddress,
      amount: input.transfer.amount,
      eoaAddress: input.eoaAddress,
      // Executor (Safe on non-7702, ephemeral on 7702) is the approved spender.
      ephemeralAddress: input.transfer.targetAddress,
      chain: input.chain,
    })
  );
  logger.debug('swap.execute.funding.approval_submitted', {
    chainId: input.chain.id,
    tokenAddress: input.transfer.tokenAddress,
    txHash,
  });
  await confirmStepReceipt(input.publicClient, txHash, input.chain.id, {
    stepId: createEoaToEphemeralTransferStepId(input.chain.id),
    stepType: 'eoa_to_ephemeral_transfer',
    label: 'EOA approval',
  });
  input.cache?.setAllowance?.(
    input.transfer.tokenAddress,
    input.eoaAddress,
    input.transfer.targetAddress,
    input.chain.id,
    input.transfer.amount
  );
  logger.debug('swap.execute.funding.approval_confirmed', {
    chainId: input.chain.id,
    tokenAddress: input.transfer.tokenAddress,
    txHash,
  });
};

export const resolvePreparedFundingTransferCalls = async (
  input: ResolvePreparedFundingTransferCallsInput
): Promise<SBCCall[]> => {
  const calls: SBCCall[] = [];
  const authorizationKind = input.transfer.authorization?.kind ?? 'none';

  logger.debug('swap.execute.funding.calls_started', {
    chainId: input.chain.id,
    tokenAddress: input.transfer.tokenAddress,
    authorizationKind,
    amountRaw: input.transfer.amount.toString(),
  });

  if (input.transfer.authorization?.kind === 'permit') {
    logger.debug('swap.execute.funding.permit_started', {
      chainId: input.chain.id,
      tokenAddress: input.transfer.tokenAddress,
      amountRaw: input.transfer.amount.toString(),
    });
    const permitCall = await materializePermitAuthorizationCall({
      chain: input.chain,
      authorization: input.transfer.authorization,
      tokenAddress: input.transfer.tokenAddress,
      tokenDecimals: input.tokenDecimals,
      amount: input.transfer.amount,
      eoaAddress: input.eoaAddress,
      eoaWallet: input.eoaWallet,
      // Executor (Safe on non-7702, ephemeral on 7702) is the permit spender.
      ephemeralAddress: input.transfer.targetAddress,
      publicClient: input.publicClient as PublicClient,
    });
    if (!permitCall) {
      throw new Error(`Missing permit calldata for ${input.transfer.tokenAddress}`);
    }
    calls.push(permitCall);
    logger.debug('swap.execute.funding.permit_completed', {
      chainId: input.chain.id,
      tokenAddress: input.transfer.tokenAddress,
    });
  }

  if (input.transfer.authorization?.kind === 'approve') {
    await ensureDirectApproval(input);
  }

  calls.push(input.transfer.transferCall);
  logger.debug('swap.execute.funding.calls_completed', {
    chainId: input.chain.id,
    tokenAddress: input.transfer.tokenAddress,
    authorizationKind,
    callCount: calls.length,
  });
  return calls;
};
