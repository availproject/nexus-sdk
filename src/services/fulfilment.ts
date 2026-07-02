import type { PublicClient } from 'viem';
import { FillEvent } from '../abi/vault';
import { getLogger } from '../domain';
import { Errors } from '../domain/errors';
import type { MiddlewareRffStatusClient } from '../transport';
import { waitForTxReceiptByChain } from './evm';

const logger = getLogger();

export const waitForIntentFulfilment = async (
  publicClient: PublicClient,
  vaultContractAddr: `0x${string}`,
  requestHash: `0x${string}`,
  ac: AbortController,
  chainId: number
) => {
  return new Promise((resolve) => {
    const unwatch = publicClient.watchContractEvent({
      abi: [FillEvent] as const,
      address: vaultContractAddr,
      args: { requestHash },
      eventName: 'Fulfilment',
      onLogs: async (logs) => {
        logger.debug('waitForIntentFulfilment', { logs });
        const fillTxHash = logs[0]?.transactionHash;
        // The Fulfilment log means the fill is mined (~1 confirmation). Wait the chain-aware
        // confirmation count (1 on mainnet, 2 elsewhere) so a lagging dst RPC has the fill synced
        // before any follow-up tx (e.g. a bridge-and-execute call) reads stale state. The event
        // already proves the fill, so a transient receipt-wait hiccup must not fail the bridge.
        if (fillTxHash) {
          await waitForTxReceiptByChain(fillTxHash, publicClient, chainId).catch(() => undefined);
        }
        ac.abort();
        return resolve(fillTxHash);
      },
      poll: true,
    });
    ac.signal.addEventListener(
      'abort',
      () => {
        logger.debug('waitForIntentFulfilment: got abort, going to unwatch');
        unwatch();
        return resolve('ok from outside');
      },
      { once: true }
    );
  });
};

export const waitForIntentFulfilmentFromMiddleware = async (
  middlewareClient: MiddlewareRffStatusClient,
  requestHash: `0x${string}`,
  ac: AbortController,
  pollIntervalMs = 1000
) => {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const settleResolve = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const settleReject = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const sleep = (ms: number) =>
      new Promise<void>((sleepResolve) => {
        if (ac.signal.aborted) {
          return sleepResolve();
        }
        const onAbort = () => {
          clearTimeout(timer);
          sleepResolve();
        };
        const timer = setTimeout(() => {
          ac.signal.removeEventListener('abort', onAbort);
          sleepResolve();
        }, ms);
        ac.signal.addEventListener('abort', onAbort, { once: true });
      });

    const poll = async () => {
      while (!ac.signal.aborted && !settled) {
        try {
          const rff = await middlewareClient.getRFFStatus(requestHash);
          if (rff.status === 'fulfilled') {
            logger.debug('waitForIntentFulfilmentFromMiddleware: fulfilled', { requestHash });
            ac.abort();
            return settleResolve();
          }
          if (rff.status === 'expired') {
            logger.error('waitForIntentFulfilmentFromMiddleware: expired', { requestHash });
            ac.abort();
            return settleReject(Errors.internal('RFF expired before fulfilment', { requestHash }));
          }
        } catch (error) {
          if (!ac.signal.aborted) {
            logger.debug('waitForIntentFulfilmentFromMiddleware: poll error', { error });
          }
        }

        await sleep(pollIntervalMs);
      }

      settleResolve();
    };

    ac.signal.addEventListener(
      'abort',
      () => {
        settleResolve();
      },
      { once: true }
    );

    void poll();
  });
};
