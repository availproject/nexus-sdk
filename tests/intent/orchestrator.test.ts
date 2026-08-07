import { describe, expect, it, vi } from 'vitest';
import type { Hex } from 'viem';
import { runIntent } from '../../src/intent/orchestrator';
import type {
  ExecutableIntentQuote,
  IntentEvent,
  IntentStatus,
} from '../../src/intent/types';

const ACCOUNT = '0x00000000000000000000000000000000000000aa' as Hex;
const TOKEN = '0x00000000000000000000000000000000000000bb' as Hex;
const SPENDER = '0x00000000000000000000000000000000000000cc' as Hex;
const TX_HASH = `0x${'33'.repeat(32)}` as Hex;

const executableQuote = (byte = '11'): ExecutableIntentQuote => {
  const id = `0x${byte.repeat(64)}` as Hex;
  return {
    quote: {
      id,
      provider: 'nexus-v2',
      tradeType: 'exactOutput',
      input: [],
      output: { chainId: 1, tokenAddress: TOKEN, amountRaw: 10n, minAmountRaw: 9n },
      fees: {
        depositRaw: 0n,
        fulfillmentRaw: 0n,
        protocolRaw: 0n,
        solverRaw: 0n,
        caGasRaw: 0n,
      },
      expiresAt: 2_000_000_000,
      allowances: [
        {
          chainId: 8453,
          tokenAddress: TOKEN,
          spender: SPENDER,
          owner: ACCOUNT,
          currentRaw: 0n,
          requiredRaw: 10n,
          deficitRaw: 10n,
        },
      ],
      plan: {
        steps: [
          {
            id: `approval:8453:${TOKEN}`,
            type: 'erc20_approval',
            chainId: 8453,
            tokenAddress: TOKEN,
            spender: SPENDER,
            amountRaw: 10n,
          },
          { id: 'intent-signature', type: 'intent_signature' },
          {
            id: 'native:10:0',
            type: 'native_transaction',
            chainId: 10,
            sourceIndex: 0,
            to: SPENDER,
            valueRaw: 2n,
          },
          { id: 'intent-submission', type: 'intent_submission' },
          { id: 'intent-fulfillment', type: 'intent_fulfillment' },
        ],
      },
    },
    execution: {
      provider: 'nexus-v2',
      rff: { id },
      signing: { type: 'personal_sign', message: '0x12', hash: id },
      allowances: [
        {
          chainId: 8453,
          tokenAddress: TOKEN,
          spender: SPENDER,
          owner: ACCOUNT,
          currentRaw: 0n,
          requiredRaw: 10n,
          deficitRaw: 10n,
          approval: { type: 'erc20_approve', to: TOKEN, data: '0x1234', value: '0' },
        },
      ],
      nativeTransactions: [
        {
          chainId: 10,
          sourceIndex: 0,
          kind: 'native_source_deposit',
          to: SPENDER,
          valueRaw: 2n,
          functionName: 'deposit',
          abi: [],
          vaultRequest: {},
        },
      ],
    },
  };
};

const status = (
  quote: ExecutableIntentQuote,
  value: IntentStatus['status']
): IntentStatus => ({
  id: quote.quote.id,
  provider: quote.quote.provider,
  status: value,
  substatus: value === 'fulfilled' ? 'completed' : 'awaiting_source_deposit',
});

describe('Better Intent orchestration', () => {
  it('serializes approvals, signing, native transactions, submit, and fulfillment polling', async () => {
    const quoted = executableQuote();
    const calls: string[] = [];
    const statuses = [status(quoted, 'created'), status(quoted, 'deposited'), status(quoted, 'fulfilled')];
    const events: IntentEvent[] = [];

    const result = await runIntent(
      { requestQuote: async () => quoted, onEvent: (event) => events.push(event) },
      {
        explorerUrl: 'https://explorer.example',
        now: () => 1_900_000_000_000,
        sleep: async () => undefined,
        approve: async (instruction, amountRaw) => {
          calls.push(`approve:${instruction.chainId}:${amountRaw}`);
          return { chainId: instruction.chainId, txHash: TX_HASH, txExplorerUrl: 'approval' };
        },
        sign: async () => {
          calls.push('sign');
          return '0x1234';
        },
        sendNative: async (instruction) => {
          calls.push(`native:${instruction.chainId}`);
          return { chainId: instruction.chainId, txHash: TX_HASH, txExplorerUrl: 'native' };
        },
        submit: async (request) => {
          calls.push(`submit:${String(request.rff.id)}`);
          return { quoteId: quoted.quote.id, status: 'created' };
        },
        getStatus: async () => statuses.shift() ?? status(quoted, 'fulfilled'),
      }
    );

    expect(calls).toEqual([
      'approve:8453:10',
      'sign',
      'native:10',
      `submit:${quoted.quote.id}`,
    ]);
    expect(result).toMatchObject({
      quote: quoted.quote,
      status: { status: 'fulfilled' },
      intentExplorerUrl: `https://explorer.example/explore/${quoted.quote.id}`,
    });
    expect(events.filter((event) => event.type === 'status').map((event) => event.status)).toEqual([
      'created',
      'deposited',
      'fulfilled',
    ]);
    expect(events.slice(-2)).toMatchObject([
      {
        type: 'step',
        step: { id: 'intent-fulfillment' },
        state: 'completed',
      },
      { type: 'status', status: 'fulfilled' },
    ]);
  });

  it('atomically replaces the executable quote when the hook refreshes it', async () => {
    const initial = executableQuote('11');
    const refreshed = executableQuote('22');
    const submittedRff = vi.fn();

    const result = await runIntent(
      {
        requestQuote: async () => initial,
        refreshQuote: async () => refreshed,
        onIntent: async ({ refresh, allow }) => {
          await refresh();
          allow();
        },
      },
      {
        explorerUrl: 'https://explorer.example',
        now: () => 1_900_000_000_000,
        sleep: async () => undefined,
        approve: async (instruction) => ({
          chainId: instruction.chainId,
          txHash: TX_HASH,
          txExplorerUrl: 'approval',
        }),
        sign: async () => '0x1234',
        sendNative: async (instruction) => ({
          chainId: instruction.chainId,
          txHash: TX_HASH,
          txExplorerUrl: 'native',
        }),
        submit: async (request) => {
          submittedRff(request.rff);
          return { quoteId: refreshed.quote.id, status: 'created' };
        },
        getStatus: async () => status(refreshed, 'fulfilled'),
      }
    );

    expect(result.quote.id).toBe(refreshed.quote.id);
    expect(submittedRff).toHaveBeenCalledWith({ id: refreshed.quote.id });
  });

  it('rejects expired intents instead of resolving a partial result', async () => {
    const quoted = executableQuote();
    quoted.quote.expiresAt = 1;

    await expect(
      runIntent(
        { requestQuote: async () => quoted },
        {
          explorerUrl: 'https://explorer.example',
          now: () => 2_000,
          sleep: async () => undefined,
          approve: vi.fn(),
          sign: vi.fn(),
          sendNative: vi.fn(),
          submit: vi.fn(),
          getStatus: vi.fn(),
        }
      )
    ).rejects.toThrow(/expired/i);
  });

  it('isolates user event callback failures', async () => {
    const quoted = executableQuote();

    await expect(
      runIntent(
        {
          requestQuote: async () => quoted,
          onEvent: () => {
            throw new Error('consumer callback failed');
          },
        },
        {
          explorerUrl: 'https://explorer.example',
          now: () => 1_900_000_000_000,
          sleep: async () => undefined,
          approve: async (instruction) => ({
            chainId: instruction.chainId,
            txHash: TX_HASH,
            txExplorerUrl: 'approval',
          }),
          sign: async () => '0x1234',
          sendNative: async (instruction) => ({
            chainId: instruction.chainId,
            txHash: TX_HASH,
            txExplorerUrl: 'native',
          }),
          submit: async () => ({ quoteId: quoted.quote.id, status: 'created' }),
          getStatus: async () => status(quoted, 'fulfilled'),
        }
      )
    ).resolves.toMatchObject({ status: { status: 'fulfilled' } });
  });
});
