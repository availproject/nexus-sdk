import {
  encodeMayanRouteData,
  getRoutesDataFromQuote,
  toMayanDepositRequest,
  VAULT_ABI_MAYAN,
} from '@avail-project/nexus-types/rff';
import type { Hex } from 'viem';
import {
  type BridgeIntentDraft,
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
import { waitForIntentFulfilmentFromMiddleware } from '../services/fulfilment';
import { isUserRejectedRequest } from '../services/is-user-rejected-request';
import { createRequestFromIntent } from '../services/rff';
import {
  createBridgeFillStepId,
  createRequestSigningStepId,
  createRequestSubmissionStepId,
  createVaultDepositStepId,
} from '../services/step-ids';
import type {
  BridgeExecutionProgressUpdate,
  BridgeExecutorResult,
  ExecuteBridgeFromIntentOptions,
} from './executor';
import { submitRFFToMiddleware, watchIntentCollections } from './executor';

const logger = getLogger();

const normalizeVaultTokenAddress = (tokenAddress: Hex): Hex =>
  convertAddressByUniverse(tokenAddress, Universe.ETHEREUM) as Hex;

// ---------------------------------------------------------------------------
// executeMayanBridgeFromIntent
// ---------------------------------------------------------------------------

export const executeMayanBridgeFromIntent = async (
  intent: BridgeIntentDraft,
  options: ExecuteBridgeFromIntentOptions
): Promise<BridgeExecutorResult> => {
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
      onProgress,
      true
    );
    onProgress?.({
      stepType: 'request_signing',
      state: 'completed',
      intentRequestHash: requestHash,
    });

    // 3. Submit RFF to middleware
    const mayanQuotes = intent.selectedSources.flatMap((source) =>
      source.mayanQuote ? [source.mayanQuote] : []
    );
    onProgress?.({
      stepType: 'request_submission',
      state: 'started',
      intentRequestHash: requestHash,
    });
    await submitRFFToMiddleware(
      rffRequest,
      signature,
      middlewareClient,
      requestHash,
      mayanQuotes
    ).catch((error) => {
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
    });

    const resolvedIntentExplorerUrl = getIntentExplorerUrl(intentExplorerUrl, requestHash);
    onProgress?.({
      stepType: 'request_submission',
      state: 'completed',
      intentRequestHash: requestHash,
      explorerUrl: resolvedIntentExplorerUrl,
    });

    // 4. Execute vault deposits
    const sourceTxs = await executeMayanVaultDeposits({
      intent,
      depositRequest,
      rffRequest,
      signature,
      walletClient,
      address,
      chainList,
      requestHash,
      middlewareClient,
      onProgress,
    });

    onProgress?.({
      stepType: 'bridge_fill',
      state: 'waiting',
      intentRequestHash: requestHash,
    });
    await waitForMayanFill({
      requestHash,
      middlewareClient,
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
    logger.error('executeMayanBridgeFromIntent:error', error);
    throw error;
  }
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type VaultDepositOptions = {
  intent: BridgeIntentDraft;
  depositRequest: Awaited<ReturnType<typeof createRequestFromIntent>>['depositRequest'];
  rffRequest: Awaited<ReturnType<typeof createRequestFromIntent>>['rffRequest'];
  signature: Hex;
  walletClient: ExecuteBridgeFromIntentOptions['walletClient'];
  address: Hex;
  chainList: ChainListType;
  requestHash: Hex;
  middlewareClient: ExecuteBridgeFromIntentOptions['middlewareClient'];
  onProgress?: (update: BridgeExecutionProgressUpdate) => void;
};

const executeMayanVaultDeposits = async (opts: VaultDepositOptions): Promise<SourceTxs> => {
  const {
    intent,
    depositRequest,
    rffRequest,
    signature,
    walletClient,
    address,
    chainList,
    requestHash,
    middlewareClient,
    onProgress,
  } = opts;

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
      const quote = intent.selectedSources[i]?.mayanQuote;
      if (!quote) {
        throw Errors.internal(`Mayan quote missing for source ${i}`);
      }

      const result = await publicClient
        .simulateContract({
          abi: VAULT_ABI_MAYAN,
          account: address,
          address: chainList.getVaultContractAddress(chain.id),
          args: [
            toMayanDepositRequest(rffRequest),
            signature,
            BigInt(i),
            encodeMayanRouteData(await getRoutesDataFromQuote(quote)),
          ],
          chain: chain,
          functionName: 'depositMayan',
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
          .then(async ([, error]) => {
            if (error) throw error;
            await middlewareClient
              .reportMayanNativeTx(requestHash, {
                source_index: i,
                tx_hash: hash,
              })
              .catch((error) => {
                const stepError = new BackendError(
                  ERROR_CODES.BACKEND_REPORT_MAYAN_TX_FAILED,
                  `Failed to report Mayan native tx to middleware: ${formatUnknownError(error)}`,
                  {
                    context: {
                      service: 'middleware',
                      stepId: createVaultDepositStepId(chain.id, tokenAddress),
                      stepType: 'vault_deposit',
                      chainId: chain.id,
                    },
                    details: { requestHash, txHash: hash },
                  }
                );
                throw stepError;
              });

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

type WaitForFillOptions = {
  requestHash: Hex;
  middlewareClient: ExecuteBridgeFromIntentOptions['middlewareClient'];
  fillTimeoutMinutes: number;
};

const waitForMayanFill = async (opts: WaitForFillOptions): Promise<void> => {
  const { requestHash, middlewareClient, fillTimeoutMinutes } = opts;

  const ac = new AbortController();
  const promisesToRace = [
    requestTimeout(fillTimeoutMinutes, ac, requestHash),
    waitForIntentFulfilmentFromMiddleware(middlewareClient, requestHash, ac, 2_000),
  ];

  await Promise.race(promisesToRace);
};
