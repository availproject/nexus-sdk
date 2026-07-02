import type { ApprovalsByChain } from '@avail-project/nexus-types';
import { keyBy } from 'es-toolkit';
import type { Hex, JsonRpcAccount, PublicClient, WalletClient } from 'viem';
import { ContractFunctionExecutionError, maxUint256, parseSignature, toHex } from 'viem';
import ERC20ABI from '../abi/erc20';
import type { AllowanceHookSource, Chain, ChainListType, SetAllowanceInput } from '../domain';
import { getLogger } from '../domain';
import { Universe } from '../domain/chain-abstraction';
import {
  ERROR_CODES,
  Errors,
  ExecutionError,
  formatUnknownError,
  NexusError,
} from '../domain/errors';
import { PermitVariant } from '../domain/permits';
import type { MiddlewareApprovalCreatorClient } from '../transport';
import { signPermitForAddressAndValue } from './allowance-utils';
import { createPublicClientWithFallback, switchChain, waitForTxReceipt } from './evm';
import { createExplorerTxURL } from './explorer';
import { isUserRejectedRequest } from './is-user-rejected-request';
import { divDecimals, mulDecimals } from './math';
import { getPermitVariantAndVersion } from './permits';
import { createAllowanceApprovalStepId } from './step-ids';
import { equalFold } from './strings';

const logger = getLogger();

type NormalApprovalInput = {
  chain: Chain;
  tokenContract: `0x${string}`;
  tokenDecimals: number;
  amount: bigint;
  vaultContract: `0x${string}`;
  publicClient: PublicClient;
  ownerAddress?: `0x${string}`;
};

export type AllowanceExecutionProgressUpdate =
  | {
      stepType: 'allowance_approval';
      chainId: number;
      tokenAddress: Hex;
      state: 'wallet_prompted';
      approvedAmount: string;
      approvedAmountRaw: string;
    }
  | {
      stepType: 'allowance_approval';
      chainId: number;
      tokenAddress: Hex;
      state: 'submitted';
      approvedAmount: string;
      approvedAmountRaw: string;
      txHash: Hex;
      explorerUrl: string;
    }
  | {
      stepType: 'allowance_approval';
      chainId: number;
      tokenAddress: Hex;
      state: 'confirmed';
      approvedAmount: string;
      approvedAmountRaw: string;
      txHash: Hex;
      explorerUrl: string;
    }
  | {
      stepType: 'allowance_approval';
      chainId: number;
      tokenAddress: Hex;
      state: 'failed';
      approvedAmount: string;
      approvedAmountRaw: string;
      error: string;
    };

export type AllowanceExecutionInput = {
  sources: Array<{
    chainID: number;
    ownerAddress?: `0x${string}`;
    tokenContract: `0x${string}`;
    amount: bigint;
  }>;
  options: {
    evm: {
      address: Hex;
      client: WalletClient;
    };
    chainList: ChainListType;
    middlewareClient: MiddlewareApprovalCreatorClient;
  };
  dstChain: Chain;
  onProgress?: (update: AllowanceExecutionProgressUpdate) => void;
};

export const executeAllowances = async (input: AllowanceExecutionInput): Promise<void> => {
  const { sources, options, dstChain, onProgress } = input;

  try {
    const toApprovedAmount = (amount: bigint, decimals: number) => ({
      approvedAmount: divDecimals(amount, decimals).toFixed(),
      approvedAmountRaw: amount.toString(),
    });

    const toStepError = (approval: NormalApprovalInput, error: unknown) => {
      if (error instanceof NexusError) return error;
      return new ExecutionError(
        ERROR_CODES.EXEC_APPROVAL_TX_SEND_FAILED,
        formatUnknownError(error),
        {
          context: {
            service: 'wallet',
            stepId: createAllowanceApprovalStepId(approval.chain.id, approval.tokenContract),
            stepType: 'allowance_approval',
            chainId: approval.chain.id,
          },
        }
      );
    };

    const enqueueNormalApproval = async (
      approval: NormalApprovalInput,
      target: Array<Promise<void>>
    ) => {
      logger.debug(`Switching chain to ${approval.chain.id}`);
      await switchChain(options.evm.client, approval.chain);

      const amount = toApprovedAmount(approval.amount, approval.tokenDecimals);
      onProgress?.({
        stepType: 'allowance_approval',
        chainId: approval.chain.id,
        tokenAddress: approval.tokenContract,
        state: 'wallet_prompted',
        ...amount,
      });

      const txHash = await options.evm.client
        .writeContract({
          abi: ERC20ABI,
          account: approval.ownerAddress ?? options.evm.address,
          address: approval.tokenContract,
          args: [approval.vaultContract, approval.amount],
          chain: approval.chain,
          functionName: 'approve',
        })
        .catch((cause) => {
          const error =
            cause instanceof ContractFunctionExecutionError || isUserRejectedRequest(cause)
              ? Errors.userRejectedAllowance()
              : Errors.execution(`Failed to approve allowance: ${formatUnknownError(cause)}`, {
                  service: 'wallet',
                  chainId: approval.chain.id,
                  details: { tokenContract: approval.tokenContract },
                });
          onProgress?.({
            stepType: 'allowance_approval',
            chainId: approval.chain.id,
            tokenAddress: approval.tokenContract,
            state: 'failed',
            ...amount,
            error: formatUnknownError(error),
          });
          throw toStepError(approval, error);
        });

      const explorerUrl = createExplorerTxURL(
        txHash,
        approval.chain.blockExplorers?.default?.url ?? ''
      );

      onProgress?.({
        stepType: 'allowance_approval',
        chainId: approval.chain.id,
        tokenAddress: approval.tokenContract,
        state: 'submitted',
        ...amount,
        txHash,
        explorerUrl,
      });

      target.push(
        waitForTxReceipt(txHash, approval.publicClient)
          .then(([, error]) => {
            if (error) throw error;
            onProgress?.({
              stepType: 'allowance_approval',
              chainId: approval.chain.id,
              tokenAddress: approval.tokenContract,
              state: 'confirmed',
              ...amount,
              txHash,
              explorerUrl,
            });
          })
          .catch((error) => {
            onProgress?.({
              stepType: 'allowance_approval',
              chainId: approval.chain.id,
              tokenAddress: approval.tokenContract,
              state: 'failed',
              ...amount,
              error: formatUnknownError(error),
            });
            throw toStepError(approval, error);
          })
      );
    };

    const sponsoredApprovals: ApprovalsByChain = {};
    const unsponsoredApprovals: Array<Promise<void>> = [];
    const sponsoredFallbackApprovals: Record<number, NormalApprovalInput[]> = {};

    for (const source of sources) {
      const chain = options.chainList.getChainByID(source.chainID);
      const publicClient = createPublicClientWithFallback(chain);
      const vaultContract = options.chainList.getVaultContractAddress(chain.id);
      const token = options.chainList.getTokenByAddress(source.chainID, source.tokenContract);
      if (chain.universe !== Universe.ETHEREUM) {
        throw Errors.universeNotSupported();
      }

      logger.debug(`Switching chain to ${chain.id}`);
      await switchChain(options.evm.client, chain);

      const normalApprovalInput: NormalApprovalInput = {
        chain,
        tokenContract: source.tokenContract,
        tokenDecimals: token.decimals,
        amount: source.amount,
        vaultContract,
        publicClient,
        ownerAddress: source.ownerAddress,
      };

      const permitEntry = await getPermitVariantAndVersion({
        chainId: source.chainID,
        tokenAddress: source.tokenContract,
        chainList: options.chainList,
        publicClient,
      });
      const currency = {
        tokenAddress: source.tokenContract,
        decimals: token.decimals,
        permitVariant: permitEntry?.permitVariant ?? PermitVariant.Unsupported,
        permitContractVersion: permitEntry?.permitContractVersion ?? 0,
      };

      if (currency.permitVariant === PermitVariant.Unsupported || chain.id === 1) {
        await enqueueNormalApproval(normalApprovalInput, unsponsoredApprovals);
        continue;
      }

      const account: JsonRpcAccount = {
        address: source.ownerAddress ?? options.evm.address,
        type: 'json-rpc',
      };
      const amount = toApprovedAmount(source.amount, token.decimals);

      onProgress?.({
        stepType: 'allowance_approval',
        chainId: chain.id,
        tokenAddress: source.tokenContract,
        state: 'wallet_prompted',
        ...amount,
      });

      const signed = parseSignature(
        await signPermitForAddressAndValue(
          currency,
          chain,
          options.evm.client,
          publicClient,
          account,
          vaultContract,
          source.amount
        ).catch((cause) => {
          const error =
            cause instanceof NexusError
              ? cause
              : cause instanceof ContractFunctionExecutionError || isUserRejectedRequest(cause)
                ? Errors.userRejectedAllowance()
                : Errors.execution(`Failed to sign permit: ${formatUnknownError(cause)}`, {
                    service: 'wallet',
                    chainId: chain.id,
                    details: { tokenContract: source.tokenContract },
                  });
          onProgress?.({
            stepType: 'allowance_approval',
            chainId: chain.id,
            tokenAddress: source.tokenContract,
            state: 'failed',
            ...amount,
            error: formatUnknownError(error),
          });
          throw toStepError(normalApprovalInput, error);
        })
      );

      sponsoredFallbackApprovals[chain.id] ??= [];
      sponsoredFallbackApprovals[chain.id].push(normalApprovalInput);

      sponsoredApprovals[chain.id] ??= [
        {
          address: account.address,
          ops: [],
        },
      ];
      sponsoredApprovals[chain.id][0].ops.push({
        signature: {
          v: signed.yParity < 27 ? signed.yParity + 27 : signed.yParity,
          r: signed.r,
          s: signed.s,
        },
        tokenAddress: source.tokenContract,
        value: toHex(source.amount),
        variant: currency.permitVariant === PermitVariant.PolygonEMT ? 2 : 1,
      });
    }

    if (Object.keys(sponsoredApprovals).length > 0) {
      logger.debug('setAllowances:sponsoredApprovals', { sponsoredApprovals });

      const sponsoredChainIds = Object.keys(sponsoredApprovals).map(Number);
      const failedSponsoredChainIds = new Set<number>();
      const sponsoredTxHashes = new Map<number, Hex>();

      try {
        const responses = await options.middlewareClient.createApprovals(sponsoredApprovals);
        const responsesByChain = keyBy(responses, (response) => response.chainId);

        for (const chainId of sponsoredChainIds) {
          const response = responsesByChain[chainId];
          if (!response || response.errored) {
            failedSponsoredChainIds.add(chainId);
            continue;
          }
          if (response.txHash) {
            sponsoredTxHashes.set(chainId, response.txHash);
          }
        }
      } catch (error) {
        logger.error('setAllowances:sponsoredApprovalsFailed', error, {
          chains: sponsoredChainIds,
        });
        for (const chainId of sponsoredChainIds) {
          failedSponsoredChainIds.add(chainId);
        }
      }

      for (const [chainId, txHash] of sponsoredTxHashes) {
        if (failedSponsoredChainIds.has(chainId)) {
          continue;
        }

        const chainApprovals = sponsoredFallbackApprovals[chainId] ?? [];
        if (chainApprovals.length === 0) {
          continue;
        }

        const explorerUrl = createExplorerTxURL(
          txHash,
          chainApprovals[0].chain.blockExplorers?.default?.url ?? ''
        );

        for (const approval of chainApprovals) {
          const amount = toApprovedAmount(approval.amount, approval.tokenDecimals);
          onProgress?.({
            stepType: 'allowance_approval',
            chainId: approval.chain.id,
            tokenAddress: approval.tokenContract,
            state: 'submitted',
            ...amount,
            txHash,
            explorerUrl,
          });
        }

        unsponsoredApprovals.push(
          waitForTxReceipt(txHash, chainApprovals[0].publicClient)
            .then(([, error]) => {
              if (error) throw error;
              for (const approval of chainApprovals) {
                const amount = toApprovedAmount(approval.amount, approval.tokenDecimals);
                onProgress?.({
                  stepType: 'allowance_approval',
                  chainId: approval.chain.id,
                  tokenAddress: approval.tokenContract,
                  state: 'confirmed',
                  ...amount,
                  txHash,
                  explorerUrl,
                });
              }
            })
            .catch((error) => {
              const failedApproval = chainApprovals[0];
              if (!failedApproval) {
                throw error;
              }

              const amount = toApprovedAmount(failedApproval.amount, failedApproval.tokenDecimals);
              onProgress?.({
                stepType: 'allowance_approval',
                chainId: failedApproval.chain.id,
                tokenAddress: failedApproval.tokenContract,
                state: 'failed',
                ...amount,
                error: formatUnknownError(error),
              });
              throw toStepError(failedApproval, error);
            })
        );
      }

      if (failedSponsoredChainIds.size > 0) {
        logger.debug('setAllowances:fallbackToNormalApprovals', {
          chains: Array.from(failedSponsoredChainIds),
        });
        for (const chainId of failedSponsoredChainIds) {
          const chainApprovals = sponsoredFallbackApprovals[chainId] ?? [];
          for (const approval of chainApprovals) {
            await enqueueNormalApproval(approval, unsponsoredApprovals);
          }
        }
      }
    }

    if (unsponsoredApprovals.length > 0) {
      await Promise.all(unsponsoredApprovals);
    }
  } catch (error) {
    logger.error('Error setting allowances', error, { cause: 'ALLOWANCE_SETTING_ERROR' });
    throw error;
  } finally {
    if (dstChain.universe === Universe.ETHEREUM) {
      await switchChain(options.evm.client, dstChain);
    }
  }
};

export const resolveAllowanceInputs = (input: {
  sources: AllowanceHookSource[];
  allowances: Array<'max' | 'min' | bigint | string>;
}): Array<SetAllowanceInput> => {
  const { sources, allowances } = input;
  if (sources.length !== allowances.length) {
    throw Errors.invalidAllowance(sources.length, allowances.length);
  }

  const val: Array<SetAllowanceInput> = [];
  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    const allowance = allowances[i];
    let amount = 0n;
    if (typeof allowance === 'string' && equalFold(allowance, 'max')) {
      amount = maxUint256;
    } else if (typeof allowance === 'string' && equalFold(allowance, 'min')) {
      amount = source.allowance.minimumRaw;
    } else if (typeof allowance === 'string') {
      amount = mulDecimals(allowance, source.token.decimals);
    } else {
      amount = allowance;
    }
    val.push({
      amount,
      chainID: source.chain.id,
      ...(source.holderAddress ? { ownerAddress: source.holderAddress } : {}),
      tokenContract: source.token.contractAddress,
    });
  }

  return val;
};
