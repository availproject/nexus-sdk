import type { Hex, PublicClient, WalletClient } from 'viem';
import { type Chain, getLogger } from '../../domain';
import { confirmStepReceipt, switchChain } from '../../services/evm';
import { createExplorerTxURL } from '../../services/explorer';
import type { SafeCall } from '../../services/safe';
import { createSwapAllowanceStepId } from '../../services/step-ids';
import type { EnsureSafeAccountV2Response } from '../safe/types';
import type { PreparedEoaToEphemeralTransfer, SwapExecutionProgressUpdate } from '../types';
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
  publicClient: Pick<
    PublicClient,
    'getTransactionReceipt' | 'waitForTransactionReceipt' | 'readContract'
  >;
  cache?: Pick<SwapCache, 'getAllowance'> & Partial<Pick<SwapCache, 'setAllowance'>>;
  safeDeploymentPromise: Promise<EnsureSafeAccountV2Response>;
  onProgress?: (update: SwapExecutionProgressUpdate) => void;
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
  const stepId = createSwapAllowanceStepId(
    input.transfer.reason,
    input.chain.id,
    input.transfer.tokenAddress
  );
  input.onProgress?.({
    stepType: 'allowance',
    stepId,
    chainId: input.chain.id,
    state: 'wallet_prompted',
  });
  await switchChain(input.eoaWallet, input.chain);
  const txHash = await input.eoaWallet.writeContract(
    buildDirectApprovalRequest({
      tokenAddress: input.transfer.tokenAddress,
      amount: input.transfer.amount,
      eoaAddress: input.eoaAddress,
      // The Safe is the approved spender.
      ephemeralAddress: input.transfer.targetAddress,
      chain: input.chain,
    })
  );
  logger.debug('swap.execute.funding.approval_submitted', {
    chainId: input.chain.id,
    tokenAddress: input.transfer.tokenAddress,
    txHash,
  });
  const explorerUrl = createExplorerTxURL(txHash, input.chain.blockExplorers?.default?.url);
  input.onProgress?.({
    stepType: 'allowance',
    stepId,
    chainId: input.chain.id,
    state: 'submitted',
    txHash,
    explorerUrl,
  });
  await confirmStepReceipt(input.publicClient, txHash, input.chain.id, {
    stepId,
    stepType: 'allowance',
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
  input.onProgress?.({
    stepType: 'allowance',
    stepId,
    chainId: input.chain.id,
    state: 'confirmed',
    txHash,
    explorerUrl,
  });
};

export const resolvePreparedFundingTransferCalls = async (
  input: ResolvePreparedFundingTransferCallsInput
): Promise<SafeCall[]> => {
  await input.safeDeploymentPromise;

  const calls: SafeCall[] = [];
  const authorizationKind = input.transfer.authorization?.kind ?? 'none';

  logger.debug('swap.execute.funding.calls_started', {
    chainId: input.chain.id,
    tokenAddress: input.transfer.tokenAddress,
    authorizationKind,
    amountRaw: input.transfer.amount.toString(),
  });

  const authorization = input.transfer.authorization;
  try {
    if (authorization?.kind === 'permit') {
      const needsSignature = authorization.call === null;
      const stepId = createSwapAllowanceStepId(
        input.transfer.reason,
        input.chain.id,
        input.transfer.tokenAddress
      );
      if (needsSignature) {
        input.onProgress?.({
          stepType: 'allowance',
          stepId,
          chainId: input.chain.id,
          state: 'wallet_prompted',
        });
      }
      logger.debug('swap.execute.funding.permit_started', {
        chainId: input.chain.id,
        tokenAddress: input.transfer.tokenAddress,
        amountRaw: input.transfer.amount.toString(),
      });
      const permitCall = await materializePermitAuthorizationCall({
        chain: input.chain,
        authorization,
        tokenAddress: input.transfer.tokenAddress,
        tokenDecimals: input.tokenDecimals,
        amount: input.transfer.amount,
        eoaAddress: input.eoaAddress,
        eoaWallet: input.eoaWallet,
        // The Safe is the permit spender.
        ephemeralAddress: input.transfer.targetAddress,
        publicClient: input.publicClient as PublicClient,
      });
      if (!permitCall) {
        throw new Error(`Missing permit calldata for ${input.transfer.tokenAddress}`);
      }
      calls.push(permitCall);
      if (needsSignature) {
        input.onProgress?.({
          stepType: 'allowance',
          stepId,
          chainId: input.chain.id,
          state: 'signed',
        });
      }
      logger.debug('swap.execute.funding.permit_completed', {
        chainId: input.chain.id,
        tokenAddress: input.transfer.tokenAddress,
      });
    }

    if (authorization?.kind === 'approve') {
      await ensureDirectApproval(input);
    }
  } catch (error) {
    input.onProgress?.({
      stepType: 'allowance',
      stepId: createSwapAllowanceStepId(
        input.transfer.reason,
        input.chain.id,
        input.transfer.tokenAddress
      ),
      chainId: input.chain.id,
      state: 'failed',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
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
