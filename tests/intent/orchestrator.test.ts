import { describe, expect, it, vi } from 'vitest';
import type { Hex } from 'viem';
import { runIntent } from '../../src/intent/orchestrator';
import { Errors } from '../../src/domain/errors';
import { normalizeIntentQuote } from '../../src/intent/normalize';
import {
  APPROVAL_SIGNATURE, INTENT_SIGNATURE, intentSignatureRequest, sponsoredQuoteResponse,
} from '../fixtures/better-intent';
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
      output: {
        chainId: 1, tokenAddress: TOKEN, amountRaw: 10n, amountUsd: '0.00001',
        minAmountRaw: 9n, minAmountUsd: '0.000009',
      },
      fees: {
        depositRaw: 0n,
        depositUsd: '0',
        fulfillmentRaw: 0n,
        fulfillmentUsd: '0',
        protocolRaw: 0n,
        protocolUsd: '0',
        solverRaw: 0n,
        solverUsd: '0',
      },
      expiresAt: 2_000_000_000,
      sourceVerdicts: [],
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
      requiredSignatures: [{ ...intentSignatureRequest(), data: { ...intentSignatureRequest().data, hash: id } }],
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

const erc20ExecutableQuote = (): ExecutableIntentQuote => {
  const quote = executableQuote();
  quote.quote.input = [
    {
      chainId: 8453,
      tokenAddress: TOKEN,
      tokenSymbol: 'USDC',
      amountRaw: 10n,
      amountUsd: '0.00001',
      depositFeeRaw: 0n,
      depositFeeUsd: '0',
      totalRequiredRaw: 10n,
      totalRequiredUsd: '0.00001',
    },
  ];
  quote.quote.plan.steps = quote.quote.plan.steps.filter(
    (step) => step.type !== 'native_transaction'
  );
  quote.execution.nativeTransactions = [];
  return quote;
};

const status = (
  quote: ExecutableIntentQuote,
  value: IntentStatus['status']
): IntentStatus => ({
  id: quote.quote.id,
  provider: quote.quote.provider,
  status: value,
  substatus: value === 'fulfilled' ? 'completed' : 'awaiting_source_deposit',
  legs: [{ sourceIndex: 0, status: value }],
});

describe('Better Intent orchestration', () => {
  it('signs sponsored approvals and submits signature envelopes before fulfillment', async () => {
    const quoted = normalizeIntentQuote(sponsoredQuoteResponse());
    const native = executableQuote().execution.nativeTransactions[0]!;
    quoted.execution.nativeTransactions.push(native);
    const paid = { ...quoted.execution.allowances[0]!, tokenAddress: ACCOUNT, authorizationType: 'approve' as const };
    quoted.execution.allowances.unshift(paid);
    const calls: string[] = [];
    const submit = vi.fn(async () => {
      calls.push('submit');
      return { quoteId: quoted.quote.id, status: 'created' as const };
    });
    const events: IntentEvent[] = [];
    const result = await runIntent({ requestQuote: async () => quoted, onEvent: (event) => events.push(event) }, {
      explorerUrl: 'https://explorer.example', now: () => 1_900_000_000_000,
      confirmApproval: async (transaction) => transaction,
      approve: async () => { calls.push('approve'); return { chainId: 8453, txHash: TX_HASH, txExplorerUrl: '' }; },
      sign: async (instruction) => {
        calls.push(instruction.kind);
        return instruction.kind === 'intent' ? INTENT_SIGNATURE : APPROVAL_SIGNATURE;
      },
      sendNative: async (_instruction, signature) => {
        expect(signature).toBe(INTENT_SIGNATURE);
        calls.push('native');
        return { chainId: 10, txHash: TX_HASH, txExplorerUrl: '' };
      },
      submit, getStatus: async () => status(quoted, 'fulfilled'),
    });

    expect(calls).toEqual(['approve', 'sourceApproval', 'intent', 'native', 'submit']);
    expect(result.approvals).toHaveLength(1);
    expect(submit).toHaveBeenCalledWith({
      provider: 'nexus-v2', rff: quoted.execution.rff,
      signatures: [
        { kind: 'intent', universe: 'EVM', signingScheme: 'personal_sign', signature: INTENT_SIGNATURE },
        { kind: 'sourceApproval', universe: 'EVM', signingScheme: 'eip712', chainId: 8453,
          tokenAddress: TOKEN, signature: APPROVAL_SIGNATURE },
      ],
      nativeTxReceipts: [{ sourceIndex: 0, txHash: TX_HASH }],
    });
    expect(events).toContainEqual(expect.objectContaining({
      type: 'step', step: expect.objectContaining({ type: 'source_approval_signature' }), state: 'completed',
    }));
  });

  it('stops before intent signing and submission when a permit is rejected', async () => {
    const quoted = normalizeIntentQuote(sponsoredQuoteResponse());
    const approve = vi.fn();
    const sign = vi.fn().mockRejectedValue(Errors.userRejectedIntentSignature());
    const submit = vi.fn();
    const sendNative = vi.fn();
    const events: IntentEvent[] = [];
    await expect(runIntent({ requestQuote: async () => quoted, onEvent: (event) => events.push(event) }, {
      explorerUrl: '', now: () => 1_900_000_000_000, approve, sign, submit, sendNative, getStatus: vi.fn(),
      confirmApproval: async (transaction) => transaction,
    })).rejects.toThrow();
    expect(approve).not.toHaveBeenCalled();
    expect(sign).toHaveBeenCalledExactlyOnceWith(quoted.execution.requiredSignatures[1]);
    expect(submit).not.toHaveBeenCalled();
    expect(sendNative).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({
      type: 'step', state: 'failed', committed: false, step: { type: 'source_approval_signature' },
    });
  });

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
        confirmApproval: async (transaction) => transaction,
        approve: async (instruction, amountRaw) => {
          calls.push(`approve:${instruction.chainId}:${amountRaw}`);
          return { chainId: instruction.chainId, txHash: TX_HASH, txExplorerUrl: 'approval' };
        },
        sign: async () => {
          calls.push('sign');
          return '0x1234';
        },
        sendNative: async (instruction, _signature, onSubmitted) => {
          calls.push(`native:${instruction.chainId}`);
          onSubmitted?.();
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
    expect(events.filter((event) => event.type === 'status').at(-1)).toMatchObject({
      legs: [{ sourceIndex: 0, status: 'fulfilled' }],
    });
    expect(events.slice(-2)).toMatchObject([
      {
        type: 'step',
        step: { id: 'intent-fulfillment' },
        state: 'completed',
      },
      { type: 'status', status: 'fulfilled' },
    ]);
    expect(
      events.find(
        (event) =>
          event.type === 'step' &&
          event.step.type === 'intent_signature' &&
          event.state === 'completed'
      )
    ).toMatchObject({ committed: false });
    expect(
      events.find(
        (event) => event.type === 'step' && event.step.type === 'native_transaction'
      )
    ).toMatchObject({ committed: false });
    expect(
      events.find(
        (event) =>
          event.type === 'step' &&
          event.step.type === 'native_transaction' &&
          event.state === 'completed'
      )
    ).toMatchObject({ committed: true });
  });

  it('marks an ERC20 intent committed when its signature succeeds', async () => {
    const quoted = erc20ExecutableQuote();
    const events: IntentEvent[] = [];

    await runIntent(
      { requestQuote: async () => quoted, onEvent: (event) => events.push(event) },
      {
        explorerUrl: 'https://explorer.example',
        now: () => 1_900_000_000_000,
        sleep: async () => undefined,
        confirmApproval: async (transaction) => transaction,
        approve: async (instruction) => ({
          chainId: instruction.chainId,
          txHash: TX_HASH,
          txExplorerUrl: 'approval',
        }),
        sign: async () => '0x1234',
        sendNative: vi.fn(),
        submit: async () => ({ quoteId: quoted.quote.id, status: 'created' }),
        getStatus: async () => status(quoted, 'fulfilled'),
      }
    );

    expect(
      events.find(
        (event) =>
          event.type === 'step' &&
          event.step.type === 'intent_signature' &&
          event.state === 'completed'
      )
    ).toMatchObject({ committed: true });
  });

  it('emits a failed fulfillment step when status polling fails', async () => {
    const quoted = erc20ExecutableQuote();
    const events: IntentEvent[] = [];
    const pollingError = Errors.backend('Status request failed', {
      service: 'middleware',
    });

    await expect(
      runIntent(
        { requestQuote: async () => quoted, onEvent: (event) => events.push(event) },
        {
          explorerUrl: 'https://explorer.example',
          now: () => 1_900_000_000_000,
          sleep: async () => undefined,
          confirmApproval: async (transaction) => transaction,
          approve: async (instruction) => ({
            chainId: instruction.chainId,
            txHash: TX_HASH,
            txExplorerUrl: 'approval',
          }),
          sign: async () => '0x1234',
          sendNative: vi.fn(),
          submit: async () => ({ quoteId: quoted.quote.id, status: 'created' }),
          getStatus: async () => {
            throw pollingError;
          },
        }
      )
    ).rejects.toBe(pollingError);

    expect(events.at(-1)).toMatchObject({
      type: 'step',
      step: { id: 'intent-fulfillment', type: 'intent_fulfillment' },
      state: 'failed',
      committed: true,
      errorDetails: {
        category: pollingError.category,
        code: pollingError.code,
        service: 'middleware',
      },
    });
  });

  it('preserves structured SDK errors on failed step events', async () => {
    const quoted = erc20ExecutableQuote();
    const events: IntentEvent[] = [];

    await expect(
      runIntent(
        { requestQuote: async () => quoted, onEvent: (event) => events.push(event) },
        {
          explorerUrl: 'https://explorer.example',
          now: () => 1_900_000_000_000,
          sleep: async () => undefined,
          confirmApproval: async (transaction) => transaction,
          approve: async (instruction) => ({
            chainId: instruction.chainId,
            txHash: TX_HASH,
            txExplorerUrl: 'approval',
          }),
          sign: async () => {
            throw Errors.userRejectedIntentSignature();
          },
          sendNative: vi.fn(),
          submit: vi.fn(),
          getStatus: vi.fn(),
        }
      )
    ).rejects.toThrow();

    expect(events.at(-1)).toMatchObject({
      type: 'step',
      step: { type: 'intent_signature' },
      state: 'failed',
      committed: false,
      errorDetails: {
        name: 'UserActionError',
        category: 'user_action',
        code: 'user_action/intent_signature_denied',
        service: 'wallet',
        stepId: 'intent-signature',
        stepType: 'intent_signature',
      },
    });
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
        confirmApproval: async (transaction) => transaction,
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
          confirmApproval: async (transaction) => transaction,
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
          confirmApproval: async (transaction) => transaction,
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
