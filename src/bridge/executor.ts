import { VAULT_ABI_MAYAN } from '@avail-project/nexus-types/rff';
import type { Hex, WalletClient } from 'viem';
import EVMVaultABI, { DepositEvent } from '../abi/vault';
import {
  type BridgeIntentDraft,
  type Chain,
  type ChainListType,
  DEFAULT_FILL_TIMEOUT_MINUTES,
  getLogger,
  type SourceTxs,
} from '../domain';
import { Universe } from '../domain/chain-abstraction';
import {
  BackendError,
  ERROR_CODES,
  Errors,
  ExecutionError,
  formatUnknownError,
  NexusError,
} from '../domain/errors';
import { convertAddressByUniverse, isNativeAddress } from '../services/addresses';
import {
  createPublicClientWithFallback,
  requestTimeout,
  switchChain,
  waitForTxReceipt,
} from '../services/evm';
import { createExplorerTxURL, getIntentExplorerUrl } from '../services/explorer';
import {
  waitForIntentFulfilment,
  waitForIntentFulfilmentFromMiddleware,
} from '../services/fulfilment';
import { isUserRejectedRequest } from '../services/is-user-rejected-request';
import { createRequestFromIntent } from '../services/rff';
import {
  createBridgeFillStepId,
  createRequestSigningStepId,
  createRequestSubmissionStepId,
  createVaultDepositStepId,
} from '../services/step-ids';
import type {
  MayanQuote,
  MiddlewareBridgeExecutionClient,
  MiddlewareRffStatusClient,
  MiddlewareRffSubmitterClient,
} from '../transport';
import { executeMayanBridgeFromIntent } from './mayan-executor';

const logger = getLogger();

const normalizeVaultTokenAddress = (tokenAddress: Hex): Hex =>
  convertAddressByUniverse(tokenAddress, Universe.ETHEREUM) as Hex;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExecuteBridgeFromIntentOptions = {
  walletClient: WalletClient;
  address: Hex;
  chainList: ChainListType;
  middlewareClient: MiddlewareBridgeExecutionClient;
  intentExplorerUrl: string;
  fillTimeoutMinutes?: number;
  onProgress?: (update: BridgeExecutionProgressUpdate) => void;
  dstChain: Chain;
};

export type BridgeExecutionProgressUpdate =
  | {
      stepType: 'request_signing';
      state: 'wallet_prompted';
    }
  | {
      stepType: 'request_signing';
      state: 'completed';
      intentRequestHash: Hex;
    }
  | {
      stepType: 'request_signing';
      state: 'failed';
      error: string;
    }
  | {
      stepType: 'request_submission';
      state: 'started';
      intentRequestHash: Hex;
    }
  | {
      stepType: 'request_submission';
      state: 'completed';
      intentRequestHash: Hex;
      explorerUrl: string;
    }
  | {
      stepType: 'request_submission';
      state: 'failed';
      intentRequestHash: Hex;
      error: string;
    }
  | {
      stepType: 'vault_deposit';
      state: 'started';
      chainId: number;
      tokenAddress: Hex;
    }
  | {
      stepType: 'vault_deposit';
      state: 'wallet_prompted';
      chainId: number;
      tokenAddress: Hex;
    }
  | {
      stepType: 'vault_deposit';
      state: 'submitted';
      chainId: number;
      tokenAddress: Hex;
      txHash: Hex;
      explorerUrl: string;
    }
  | {
      stepType: 'vault_deposit';
      state: 'confirmed';
      chainId: number;
      tokenAddress: Hex;
      txHash: Hex;
      explorerUrl: string;
    }
  | {
      stepType: 'vault_deposit';
      state: 'completed';
      chainId: number;
      tokenAddress: Hex;
    }
  | {
      stepType: 'vault_deposit';
      state: 'failed';
      chainId: number;
      tokenAddress: Hex;
      txHash?: Hex;
      explorerUrl?: string;
      error: string;
    }
  | {
      stepType: 'bridge_fill';
      state: 'waiting';
      intentRequestHash: Hex;
    }
  | {
      stepType: 'bridge_fill';
      state: 'completed';
      intentRequestHash: Hex;
    }
  | {
      stepType: 'bridge_fill';
      state: 'failed';
      intentRequestHash: Hex;
      error: string;
    };

export type BridgeExecutorResult = {
  intentExplorerUrl: string;
  requestHash: Hex;
  sourceTxs: SourceTxs;
};

// ---------------------------------------------------------------------------
// executeBridgeFromIntent
// ---------------------------------------------------------------------------

/**
 * Shared bridge executor: owns RFF creation/signing, submission, vault
 * deposits, and fill waiting.
 *
 * Does NOT own: intent creation, hooks, approval/sponsored allowance.
 */
export const executeBridgeFromIntent = async (
  intent: BridgeIntentDraft,
  options: ExecuteBridgeFromIntentOptions
): Promise<BridgeExecutorResult> => {
  if (intent.provider === 'mayan') {
    return executeMayanBridgeFromIntent(intent, options);
  }

  const {
    walletClient,
    address,
    chainList,
    middlewareClient,
    intentExplorerUrl,
    fillTimeoutMinutes,
    onProgress,
    dstChain,
  } = options;

  let stopCollectionWatchers: ((reason: string) => void) | undefined;

  try {
    // 1. Create RFF request from intent, sign it
    onProgress?.({
      stepType: 'request_signing',
      state: 'wallet_prompted',
    });

    const { rffRequest, depositRequest, signature, requestHash } = await createRequestFromIntent(
      intent,
      {
        evm: { address, client: walletClient },
      }
    ).catch((error) => {
      const stepError =
        error instanceof NexusError
          ? error
          : isUserRejectedRequest(error)
            ? Errors.userRejectedIntentSignature()
            : new ExecutionError(ERROR_CODES.EXEC_INTENT_SIGN_FAILED, formatUnknownError(error), {
                context: {
                  service: 'wallet',
                  stepId: createRequestSigningStepId(),
                  stepType: 'request_signing',
                },
              });
      onProgress?.({
        stepType: 'request_signing',
        state: 'failed',
        error: formatUnknownError(stepError),
      });
      throw stepError;
    });

    // 2. Watch for deposit events before submitting
    stopCollectionWatchers = watchIntentCollections(
      requestHash,
      depositRequest.sources,
      chainList,
      onProgress
    );
    onProgress?.({
      stepType: 'request_signing',
      state: 'completed',
      intentRequestHash: requestHash,
    });

    // 3. Submit RFF to middleware
    onProgress?.({
      stepType: 'request_submission',
      state: 'started',
      intentRequestHash: requestHash,
    });
    await submitRFFToMiddleware(rffRequest, signature, middlewareClient, requestHash).catch(
      (error) => {
        stopCollectionWatchers?.('submitRFFFailed');
        stopCollectionWatchers = undefined;
        onProgress?.({
          stepType: 'request_submission',
          state: 'failed',
          intentRequestHash: requestHash,
          error: formatUnknownError(error),
        });
        throw new BackendError(ERROR_CODES.BACKEND_RFF_SUBMIT_FAILED, formatUnknownError(error), {
          context: {
            service: 'middleware',
            stepId: createRequestSubmissionStepId(),
            stepType: 'request_submission',
          },
        });
      }
    );

    const resolvedIntentExplorerUrl = getIntentExplorerUrl(intentExplorerUrl, requestHash);
    onProgress?.({
      stepType: 'request_submission',
      state: 'completed',
      intentRequestHash: requestHash,
      explorerUrl: resolvedIntentExplorerUrl,
    });

    // 4. Execute vault deposits
    const sourceTxs = await executeVaultDeposits({
      depositRequest,
      signature,
      walletClient,
      address,
      chainList,
      requestHash,
      onProgress,
    });

    // 5. Wait for fill
    onProgress?.({
      stepType: 'bridge_fill',
      state: 'waiting',
      intentRequestHash: requestHash,
    });
    await waitForFill({
      requestHash,
      middlewareClient,
      dstChain,
      chainList,
      fillTimeoutMinutes: fillTimeoutMinutes ?? DEFAULT_FILL_TIMEOUT_MINUTES,
    }).catch((error) => {
      onProgress?.({
        stepType: 'bridge_fill',
        state: 'failed',
        intentRequestHash: requestHash,
        error: formatUnknownError(error),
      });
      throw new BackendError(
        ERROR_CODES.BACKEND_FULFILMENT_WAIT_TIMEOUT,
        formatUnknownError(error),
        {
          context: {
            service: 'middleware',
            stepId: createBridgeFillStepId(dstChain.id),
            stepType: 'bridge_fill',
            chainId: dstChain.id,
          },
        }
      );
    });

    stopCollectionWatchers?.('fillCompleted');
    stopCollectionWatchers = undefined;

    onProgress?.({
      stepType: 'bridge_fill',
      state: 'completed',
      intentRequestHash: requestHash,
    });

    if (dstChain.universe === Universe.ETHEREUM) {
      await switchChain(walletClient, dstChain);
    }

    return { intentExplorerUrl: resolvedIntentExplorerUrl, requestHash, sourceTxs };
  } catch (error) {
    stopCollectionWatchers?.('executeFailed');
    stopCollectionWatchers = undefined;
    logger.error('executeBridgeFromIntent:error', error);
    throw error;
  }
};

// ---------------------------------------------------------------------------
// Exported helpers (composable by bridge-in-swap and other flows)
// ---------------------------------------------------------------------------

/**
 * Submit a signed RFF request to middleware. Returns the confirmed request hash.
 */
export const submitRFFToMiddleware = async (
  rffRequest: Parameters<MiddlewareRffSubmitterClient['submitRFF']>[0]['request'],
  signature: Hex,
  middlewareClient: MiddlewareRffSubmitterClient,
  expectedRequestHash?: Hex,
  mayanQuotes?: MayanQuote[]
): Promise<Hex> => {
  const response = await middlewareClient.submitRFF({
    request: rffRequest,
    signature,
    mayanQuotes,
  });
  if (expectedRequestHash && response.request_hash !== expectedRequestHash) {
    logger.warn('submitRFFToMiddleware:requestHashMismatch', {
      localRequestHash: expectedRequestHash,
      middlewareRequestHash: response.request_hash,
    });
  }
  return response.request_hash;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

export type VaultDepositOptions = {
  depositRequest: Awaited<ReturnType<typeof createRequestFromIntent>>['depositRequest'];
  signature: Hex;
  walletClient: WalletClient;
  address: Hex;
  chainList: ChainListType;
  requestHash: Hex;
  onProgress?: (update: BridgeExecutionProgressUpdate) => void;
};

export const executeVaultDeposits = async (opts: VaultDepositOptions): Promise<SourceTxs> => {
  const { depositRequest, signature, walletClient, address, chainList, requestHash, onProgress } =
    opts;

  const sourceTxs: SourceTxs = [];
  const evmDeposits: Promise<unknown>[] = [];

  for (const [i, s] of depositRequest.sources.entries()) {
    const chain = chainList.getChainByID(Number(s.chainID));
    const tokenAddress = normalizeVaultTokenAddress(s.contractAddress);

    if (s.universe === Universe.ETHEREUM && isNativeAddress(tokenAddress)) {
      await switchChain(walletClient, chain);

      const publicClient = createPublicClientWithFallback(chain);
      onProgress?.({
        stepType: 'vault_deposit',
        state: 'wallet_prompted',
        chainId: chain.id,
        tokenAddress,
      });

      const result = await publicClient
        .simulateContract({
          abi: EVMVaultABI,
          account: address,
          address: chainList.getVaultContractAddress(chain.id),
          args: [depositRequest, signature, BigInt(i)],
          chain: chain,
          functionName: 'deposit',
          value: s.value,
        })
        .catch((error: unknown) => {
          const stepError = new ExecutionError(
            ERROR_CODES.EXEC_VAULT_DEPOSIT_SEND_FAILED,
            `Failed to simulate deposit transaction: ${formatUnknownError(error)}`,
            {
              context: {
                service: 'rpc',
                stepId: createVaultDepositStepId(chain.id, tokenAddress),
                stepType: 'vault_deposit',
                chainId: chain.id,
              },
              details: { requestHash },
            }
          );
          onProgress?.({
            stepType: 'vault_deposit',
            state: 'failed',
            chainId: chain.id,
            tokenAddress,
            error: formatUnknownError(stepError),
          });
          throw stepError;
        });

      const hash = await walletClient.writeContract(result.request).catch((error: unknown) => {
        const stepError = isUserRejectedRequest(error)
          ? Errors.userRejectedTxSend()
          : new ExecutionError(
              ERROR_CODES.EXEC_VAULT_DEPOSIT_SEND_FAILED,
              `Failed to submit deposit transaction: ${formatUnknownError(error)}`,
              {
                context: {
                  service: 'wallet',
                  stepId: createVaultDepositStepId(chain.id, tokenAddress),
                  stepType: 'vault_deposit',
                  chainId: chain.id,
                },
                details: { requestHash },
              }
            );
        onProgress?.({
          stepType: 'vault_deposit',
          state: 'failed',
          chainId: chain.id,
          tokenAddress,
          error: formatUnknownError(stepError),
        });
        throw stepError;
      });

      const explorerUrl = createExplorerTxURL(hash, chain.blockExplorers?.default?.url ?? '');
      onProgress?.({
        stepType: 'vault_deposit',
        state: 'submitted',
        chainId: chain.id,
        tokenAddress,
        txHash: hash,
        explorerUrl,
      });

      sourceTxs.push({
        chain: {
          id: chain.id,
          name: chain.name,
          logo: chain.custom.icon,
        },
        txHash: hash,
        txExplorerUrl: explorerUrl,
      });
      evmDeposits.push(
        waitForTxReceipt(hash, publicClient)
          .then(([, error]) => {
            if (error) throw error;
            onProgress?.({
              stepType: 'vault_deposit',
              state: 'confirmed',
              chainId: chain.id,
              tokenAddress,
              txHash: hash,
              explorerUrl,
            });
          })
          .catch((error) => {
            const stepError = new ExecutionError(
              ERROR_CODES.EXEC_VAULT_DEPOSIT_CONFIRM_FAILED,
              `Failed to confirm deposit transaction: ${formatUnknownError(error)}`,
              {
                context: {
                  service: 'rpc',
                  stepId: createVaultDepositStepId(chain.id, tokenAddress),
                  stepType: 'vault_deposit',
                  chainId: chain.id,
                },
                details: { requestHash, txHash: hash },
              }
            );
            onProgress?.({
              stepType: 'vault_deposit',
              state: 'failed',
              chainId: chain.id,
              tokenAddress,
              txHash: hash,
              explorerUrl,
              error: formatUnknownError(stepError),
            });
            throw stepError;
          })
      );
    } else if (s.universe === Universe.ETHEREUM) {
      onProgress?.({
        stepType: 'vault_deposit',
        state: 'started',
        chainId: chain.id,
        tokenAddress,
      });
    }
  }

  if (evmDeposits.length) {
    await Promise.all(evmDeposits);
  }

  return sourceTxs;
};

export type WaitForFillOptions = {
  requestHash: Hex;
  middlewareClient: MiddlewareRffStatusClient;
  dstChain: Chain;
  chainList: ChainListType;
  fillTimeoutMinutes: number;
};

export const waitForFill = async (opts: WaitForFillOptions): Promise<void> => {
  const { requestHash, middlewareClient, dstChain, chainList, fillTimeoutMinutes } = opts;

  const ac = new AbortController();
  const promisesToRace = [
    requestTimeout(fillTimeoutMinutes, ac, requestHash),
    waitForIntentFulfilmentFromMiddleware(middlewareClient, requestHash, ac, 2_000),
  ];

  if (dstChain.universe === Universe.ETHEREUM) {
    promisesToRace.push(
      waitForIntentFulfilment(
        createPublicClientWithFallback(dstChain),
        chainList.getVaultContractAddress(dstChain.id),
        requestHash,
        ac,
        dstChain.id
      )
    );
  }

  await Promise.race(promisesToRace);
};

export const watchIntentCollections = (
  requestHash: Hex,
  depositSources: Array<{
    chainID: bigint;
    contractAddress: Hex;
    universe: number;
  }>,
  chainList: ChainListType,
  onProgress?: (update: BridgeExecutionProgressUpdate) => void,
  isMayan?: boolean
): ((reason: string) => void) => {
  const unwatchers = new Set<() => void>();
  const totalSources = depositSources.length;
  const collectionSources = depositSources.filter(
    (source) =>
      source.universe === Universe.ETHEREUM &&
      !isNativeAddress(normalizeVaultTokenAddress(source.contractAddress))
  );

  logger.debug('watchIntentCollections:init', {
    requestHash,
    totalSources,
    collectionSources: collectionSources.length,
  });

  if (collectionSources.length === 0) {
    // biome-ignore lint/suspicious/noEmptyBlockStatements: noop
    return (_reason: string) => {};
  }

  const stop = (reason: string) => {
    logger.debug('watchIntentCollections:stopAll', {
      requestHash,
      reason,
      activeWatchers: unwatchers.size,
    });
    for (const unwatch of unwatchers) unwatch();
    unwatchers.clear();
  };

  const { ABI, functionName } = isMayan
    ? { ABI: VAULT_ABI_MAYAN, functionName: 'DepositMayan' }
    : { ABI: [DepositEvent] as const, functionName: 'Deposit' };

  for (const source of collectionSources) {
    const chainID = Number(source.chainID);
    const chain = chainList.getChainByID(chainID);
    const tokenAddress = normalizeVaultTokenAddress(source.contractAddress);
    const publicClient = createPublicClientWithFallback(chain);
    const vaultContractAddress = chainList.getVaultContractAddress(chainID);

    const unwatch = publicClient.watchContractEvent({
      abi: ABI,
      address: vaultContractAddress,
      args: { requestHash },
      eventName: functionName,
      poll: true,
      onLogs: (logs) => {
        if (!logs[0]?.transactionHash) return;
        onProgress?.({
          stepType: 'vault_deposit',
          state: 'completed',
          chainId: chainID,
          tokenAddress,
        });

        unwatchers.delete(unwatch);
        unwatch();
      },
    });
    unwatchers.add(unwatch);
  }

  return stop;
};
