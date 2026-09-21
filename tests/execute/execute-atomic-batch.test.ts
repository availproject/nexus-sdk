import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type Hex } from 'viem';

vi.mock('../../src/services/evm', () => ({
  switchChain: vi.fn().mockResolvedValue(undefined),
  waitForTxReceipt: vi.fn().mockResolvedValue([
    {
      status: 'success',
      transactionHash: '0xreceipt' as Hex,
      blockNumber: 1n,
      effectiveGasPrice: 1n,
      gasUsed: 21_000n,
    },
    null,
  ]),
  packERC20Approve: vi.fn(),
}));

import { sendExecuteTransactions } from '../../src/execute/runtime';
import { waitForTxReceipt } from '../../src/services/evm';

const CHAIN_ID = 42161;
const ADDRESS = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Hex;
const APPROVAL_HASH =
  '0x1111111111111111111111111111111111111111111111111111111111111111' as Hex;
const EXECUTE_HASH =
  '0x2222222222222222222222222222222222222222222222222222222222222222' as Hex;

const makeChain = () =>
  ({
    id: CHAIN_ID,
    name: 'Arbitrum',
    nativeCurrency: { decimals: 18, name: 'ETH', symbol: 'ETH' },
    rpcUrls: { default: { http: ['https://arb.rpc'] } },
    blockExplorers: { default: { url: 'https://arbiscan.io' } },
    custom: { icon: '' },
  }) as never;

const makeReceipt = (transactionHash: Hex) => ({
  blockHash: '0xabc' as Hex,
  blockNumber: 1n,
  gasUsed: 21_000n,
  logs: [],
  status: 'success' as const,
  transactionHash,
});

const makePlan = (withApproval: boolean) => {
  const chain = makeChain();
  const transactionStep = {
    type: 'execute_transaction' as const,
    id: 'execute-tx',
    chain,
    to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Hex,
  };

  return withApproval
    ? {
        steps: [
          {
            type: 'execute_approval' as const,
            id: 'execute-approval',
            chain,
            token: {
              contractAddress: '0xcccccccccccccccccccccccccccccccccccccccc' as Hex,
              decimals: 6,
              logo: '',
              name: 'USDC',
              symbol: 'USDC',
            },
            spender: '0xdddddddddddddddddddddddddddddddddddddddd' as Hex,
            amount: '1',
            amountRaw: '1000000',
          },
          transactionStep,
        ],
        approvalStep: {
          type: 'execute_approval' as const,
          id: 'execute-approval',
          chain,
          token: {
            contractAddress: '0xcccccccccccccccccccccccccccccccccccccccc' as Hex,
            decimals: 6,
            logo: '',
            name: 'USDC',
            symbol: 'USDC',
          },
          spender: '0xdddddddddddddddddddddddddddddddddddddddd' as Hex,
          amount: '1',
          amountRaw: '1000000',
        },
        transactionStep,
      }
    : {
        steps: [transactionStep],
        transactionStep,
      };
};

const makeClient = (atomicBatchSupported: boolean) =>
  ({
    getCapabilities: vi.fn().mockResolvedValue({
      [CHAIN_ID]: {
        atomic: { status: atomicBatchSupported ? 'supported' : 'unsupported' },
      },
    }),
    sendCalls: vi.fn().mockResolvedValue({ id: '0xcallid' }),
    waitForCallsStatus: vi.fn().mockResolvedValue({
      status: 'success',
      receipts: [makeReceipt(APPROVAL_HASH), makeReceipt(EXECUTE_HASH)],
    }),
    sendTransaction: vi
      .fn()
      .mockResolvedValueOnce(APPROVAL_HASH)
      .mockResolvedValueOnce(EXECUTE_HASH),
  });

describe('sendExecuteTransactions atomic batch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses sendTransaction directly when no approval is required', async () => {
    const client = makeClient(true);

    await sendExecuteTransactions(
      {
        tx: {
          to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Hex,
          data: '0xdeadbeef' as Hex,
          value: 0n,
        },
        approvalTx: null,
        plan: makePlan(false),
      },
      {
        chain: makeChain(),
        dstPublicClient: {} as never,
        address: ADDRESS,
        client: client as never,
        waitForReceipt: false,
      }
    );

    expect(client.getCapabilities).not.toHaveBeenCalled();
    expect(client.sendCalls).not.toHaveBeenCalled();
    expect(client.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it('uses wallet_sendCalls and emits the same two execute step types', async () => {
    const client = makeClient(true);
    const onProgress = vi.fn();

    const result = await sendExecuteTransactions(
      {
        tx: {
          to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Hex,
          data: '0xdeadbeef' as Hex,
          value: 0n,
        },
        approvalTx: {
          to: '0xcccccccccccccccccccccccccccccccccccccccc' as Hex,
          data: '0xapprove' as Hex,
          value: 0n,
        },
        plan: makePlan(true),
      },
      {
        onProgress,
        chain: makeChain(),
        dstPublicClient: {} as never,
        address: ADDRESS,
        client: client as never,
        waitForReceipt: true,
      }
    );

    expect(client.sendCalls).toHaveBeenCalledWith({
      account: ADDRESS,
      chain: expect.objectContaining({ id: CHAIN_ID }),
      forceAtomic: true,
      calls: [
        {
          to: '0xcccccccccccccccccccccccccccccccccccccccc',
          data: '0xapprove',
          value: 0n,
        },
        {
          to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          data: '0xdeadbeef',
          value: 0n,
        },
      ],
    });
    expect(client.sendTransaction).not.toHaveBeenCalled();
    expect(waitForTxReceipt).toHaveBeenCalledTimes(1);
    expect(onProgress.mock.calls.map(([update]) => `${update.stepType}:${update.state}`)).toEqual([
      'execute_approval:wallet_prompted',
      'execute_transaction:wallet_prompted',
      'execute_approval:submitted',
      'execute_transaction:submitted',
      'execute_approval:confirmed',
      'execute_transaction:confirmed',
    ]);
    expect(result.approvalHash).toBe(APPROVAL_HASH);
    expect(result.txHash).toBe(EXECUTE_HASH);
  });

  it('falls back to sequential sendTransaction when atomic batch is not supported', async () => {
    const client = makeClient(false);

    const result = await sendExecuteTransactions(
      {
        tx: {
          to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Hex,
          data: '0xdeadbeef' as Hex,
          value: 0n,
        },
        approvalTx: {
          to: '0xcccccccccccccccccccccccccccccccccccccccc' as Hex,
          data: '0xapprove' as Hex,
          value: 0n,
        },
        plan: makePlan(true),
      },
      {
        chain: makeChain(),
        dstPublicClient: {} as never,
        address: ADDRESS,
        client: client as never,
        waitForReceipt: true,
      }
    );

    expect(client.sendCalls).not.toHaveBeenCalled();
    expect(client.sendTransaction).toHaveBeenCalledTimes(2);
    expect(result.approvalHash).toBe(APPROVAL_HASH);
    expect(result.txHash).toBe(EXECUTE_HASH);
  });
});
