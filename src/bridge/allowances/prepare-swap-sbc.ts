import type { PrivateKeyAccount, WalletClient } from 'viem';
import type { AllowanceHookSource, BridgeIntentDraft, ChainListType } from '../../domain';
import { ERROR_CODES, Errors, ExecutionError } from '../../domain/errors';
import {
  type AllowanceExecutionInput,
  executeAllowances,
  resolveAllowanceInputs,
} from '../../services/allowances';
import { waitForTxReceiptByChain } from '../../services/evm';
import { equalFold } from '../../services/strings';
import type { PublicClientList } from '../../swap/types';
import type { SwapCache } from '../../swap/wallet/cache';
import { chainSupports7702 } from '../../swap/wallet/capabilities';
import type {
  MiddlewareApprovalCreatorClient,
  MiddlewareSbcSubmitterClient,
} from '../../transport';

export const prepareSwapBridgeExecution = async (
  intent: BridgeIntentDraft,
  options: {
    allowanceSelections: Array<'max' | 'min' | bigint | string>;
    insufficientAllowanceSources: AllowanceHookSource[];
    middlewareClient: MiddlewareSbcSubmitterClient & MiddlewareApprovalCreatorClient;
    ephemeralWallet: PrivateKeyAccount;
    eoaAddress?: `0x${string}`;
    eoaWallet?: WalletClient;
    chainList: ChainListType;
    publicClientList: PublicClientList;
    cache: SwapCache | undefined;
  }
): Promise<void> => {
  const {
    allowanceSelections,
    insufficientAllowanceSources,
    middlewareClient,
    ephemeralWallet,
    eoaAddress,
    eoaWallet,
    chainList,
    publicClientList,
  } = options;

  if (insufficientAllowanceSources.length === 0) {
    return;
  }

  const resolved = resolveAllowanceInputs({
    sources: insufficientAllowanceSources,
    allowances: allowanceSelections,
  });

  const ephemeralApprovals = resolved.filter(
    (source) => !source.ownerAddress || equalFold(source.ownerAddress, ephemeralWallet.address)
  );
  const eoaApprovals = resolved.filter(
    (source) => source.ownerAddress && !equalFold(source.ownerAddress, ephemeralWallet.address)
  );

  const { createSBCTxFromCalls, requireSuccessfulSbcResult } = await import('../../services/sbc');
  const { encodeFunctionData, erc20Abi } = await import('viem');

  const byChain = new Map<number, typeof ephemeralApprovals>();
  for (const r of ephemeralApprovals) {
    // Non-7702 chains have no Calibur delegation, so SBC-based pre-approvals don't apply. The
    // v1-style Safe deposit batch grants vault allowance via permit just-in-time, so the
    // pre-pass is redundant there. Skip non-7702 chains entirely.
    const chain = chainList.getChainByID(r.chainID);
    if (!chainSupports7702(chain)) continue;
    let bucket = byChain.get(r.chainID);
    if (!bucket) {
      bucket = [];
      byChain.set(r.chainID, bucket);
    }
    bucket.push(r);
  }

  for (const [chainId, chainSources] of byChain) {
    const publicClient = publicClientList.get(chainId);
    const calls = chainSources.map((s) => ({
      to: s.tokenContract,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [chainList.getVaultContractAddress(chainId), s.amount],
      }),
      value: 0n,
    }));

    const sbcTx = await createSBCTxFromCalls({
      calls,
      chainID: chainId,
      ephemeralAddress: ephemeralWallet.address,
      ephemeralWallet,
      publicClient,
    });

    const results = await middlewareClient.submitSBCs([sbcTx]);
    const txHash = requireSuccessfulSbcResult(
      results,
      chainId,
      'Swap bridge approval SBC submission'
    );
    const [, error] = await waitForTxReceiptByChain(txHash, publicClient, chainId);
    if (error) {
      throw new ExecutionError(
        ERROR_CODES.EXEC_TX_ONCHAIN_REVERTED,
        `Swap bridge approval reverted on chain ${chainId}`,
        { context: { service: 'rpc', chainId }, details: { txHash } }
      );
    }
  }

  if (eoaApprovals.length > 0) {
    if (!eoaAddress || !eoaWallet) {
      throw Errors.internal('EOA bridge approvals require eoaAddress and eoaWallet');
    }

    const dstChain = chainList.getChainByID(intent.destination.chain.id);
    const allowanceOptions: AllowanceExecutionInput['options'] = {
      evm: {
        address: eoaAddress,
        client: eoaWallet,
      },
      chainList,
      middlewareClient,
    };
    await executeAllowances({
      sources: eoaApprovals,
      options: allowanceOptions,
      dstChain,
    });
  }
};
