import { describe, expect, it, vi } from 'vitest';
import type { Hex, PublicClient } from 'viem';
import {
  waitForIntentFulfilment,
  waitForIntentFulfilmentFromMiddleware,
} from '../../src/services/fulfilment';

const REQUEST_HASH = `0x${'77'.repeat(32)}` as Hex;
type MiddlewareClient = Parameters<typeof waitForIntentFulfilmentFromMiddleware>[0];

describe('waitForIntentFulfilmentFromMiddleware', () => {
  it('uses getRFFStatus', async () => {
    const getRFFStatus = vi.fn().mockResolvedValue({ status: 'fulfilled' });
    const middlewareClient: MiddlewareClient = {
      getRFFStatus,
    };

    await expect(
      waitForIntentFulfilmentFromMiddleware(middlewareClient, REQUEST_HASH, new AbortController(), 0)
    ).resolves.toBeUndefined();

    expect(getRFFStatus).toHaveBeenCalledWith(REQUEST_HASH);
  });
});

describe('waitForIntentFulfilment', () => {
  const VAULT = `0x${'aa'.repeat(20)}` as Hex;
  const FILL_TX = `0x${'bb'.repeat(32)}` as Hex;

  // Fires the Fulfilment event on the next tick, then records the confirmations the fill tx is
  // waited for (the chain-aware RPC-sync margin).
  const makeClient = (capture: (confirmations: number) => void) =>
    ({
      watchContractEvent: ({ onLogs }: { onLogs: (logs: unknown[]) => void }) => {
        queueMicrotask(() => onLogs([{ transactionHash: FILL_TX }]));
        return () => {};
      },
      waitForTransactionReceipt: async ({
        confirmations,
        hash,
      }: {
        confirmations: number;
        hash: Hex;
      }) => {
        expect(hash).toBe(FILL_TX);
        capture(confirmations);
        return { status: 'success' };
      },
    }) as unknown as PublicClient;

  it('waits 2 confirmations of the fill tx on a non-mainnet destination', async () => {
    let confirmations: number | undefined;
    await waitForIntentFulfilment(
      makeClient((c) => {
        confirmations = c;
      }),
      VAULT,
      REQUEST_HASH,
      new AbortController(),
      42161
    );
    expect(confirmations).toBe(2);
  });

  it('waits 1 confirmation on Ethereum mainnet', async () => {
    let confirmations: number | undefined;
    await waitForIntentFulfilment(
      makeClient((c) => {
        confirmations = c;
      }),
      VAULT,
      REQUEST_HASH,
      new AbortController(),
      1
    );
    expect(confirmations).toBe(1);
  });
});
