import type { Hex } from 'viem';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/sdk/ca-base/utils', () => ({
  switchChain: vi.fn().mockResolvedValue(undefined),
  waitForTxReceipt: vi.fn().mockResolvedValue({
    status: 'success',
    transactionHash: '0x9999999999999999999999999999999999999999999999999999999999999999' as Hex,
    blockNumber: 1n,
    effectiveGasPrice: 1n,
    gasUsed: 21_000n,
    logs: [],
  }),
}));

import { waitForTxReceipt } from '../../src/sdk/ca-base/utils';
import {
  type ExecuteFeeParams,
  sendExecuteTransactions,
} from '../../src/services/executeTransactions';

const CHAIN_ID = 42161;
const ADDRESS = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Hex;
const APPROVAL_HASH = '0x1111111111111111111111111111111111111111111111111111111111111111' as Hex;
const EXECUTE_HASH = '0x2222222222222222222222222222222222222222222222222222222222222222' as Hex;

const makeChain = () =>
  ({
    id: CHAIN_ID,
    name: 'Arbitrum',
    nativeCurrency: { decimals: 18, name: 'ETH', symbol: 'ETH' },
    rpcUrls: { default: { http: ['https://arb.rpc'] } },
    blockExplorers: { default: { url: 'https://arbiscan.io' } },
    custom: { icon: '' },
  }) as never;

const makeTx = () => ({
  to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Hex,
  value: 0n,
  data: '0xdeadbeef' as Hex,
  gas: 123_456n,
});

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
      receipts: [{ transactionHash: APPROVAL_HASH }, { transactionHash: EXECUTE_HASH }],
    }),
    sendTransaction: vi
      .fn()
      .mockResolvedValueOnce(APPROVAL_HASH)
      .mockResolvedValueOnce(EXECUTE_HASH),
  }) as never;

describe('sendExecuteTransactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('spreads EIP-1559 fee fields and gas onto sendTransaction', async () => {
    const client = makeClient(false);
    const feeParams: ExecuteFeeParams = {
      type: 'eip1559',
      maxFeePerGas: 2_000_000_000n,
      maxPriorityFeePerGas: 100_000_000n,
    };

    await sendExecuteTransactions(
      {
        tx: makeTx(),
        approvalTx: null,
        feeParams,
      },
      {
        chain: makeChain(),
        dstPublicClient: {} as never,
        address: ADDRESS,
        client,
        waitForReceipt: false,
      }
    );

    expect(client.sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        gas: 123_456n,
        maxFeePerGas: 2_000_000_000n,
        maxPriorityFeePerGas: 100_000_000n,
      })
    );
    expect(client.sendTransaction).not.toHaveBeenCalledWith(
      expect.objectContaining({
        gasPrice: expect.anything(),
      })
    );
  });

  it('spreads legacy gasPrice and gas onto sendTransaction', async () => {
    const client = makeClient(false);
    const feeParams: ExecuteFeeParams = {
      type: 'legacy',
      gasPrice: 500_000_000n,
    };

    await sendExecuteTransactions(
      {
        tx: makeTx(),
        approvalTx: null,
        feeParams,
      },
      {
        chain: makeChain(),
        dstPublicClient: {} as never,
        address: ADDRESS,
        client,
        waitForReceipt: false,
      }
    );

    expect(client.sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        gas: 123_456n,
        gasPrice: 500_000_000n,
      })
    );
    expect(client.sendTransaction).not.toHaveBeenCalledWith(
      expect.objectContaining({
        maxFeePerGas: expect.anything(),
      })
    );
  });

  it('uses wallet_sendCalls when approval batching is supported', async () => {
    const client = makeClient(true);

    const result = await sendExecuteTransactions(
      {
        tx: makeTx(),
        approvalTx: {
          to: '0xcccccccccccccccccccccccccccccccccccccccc' as Hex,
          data: '0xapprove' as Hex,
          value: 0n,
          gas: 65_000n,
        },
      },
      {
        chain: makeChain(),
        dstPublicClient: {} as never,
        address: ADDRESS,
        client,
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
    expect(result.approvalHash).toBe(APPROVAL_HASH);
    expect(result.txHash).toBe(EXECUTE_HASH);
  });

  it('falls back to sequential sendTransaction when atomic batching is unsupported', async () => {
    const client = makeClient(false);
    const feeParams: ExecuteFeeParams = {
      type: 'legacy',
      gasPrice: 500_000_000n,
    };

    await sendExecuteTransactions(
      {
        tx: makeTx(),
        approvalTx: {
          to: '0xcccccccccccccccccccccccccccccccccccccccc' as Hex,
          data: '0xapprove' as Hex,
          value: 0n,
          gas: 65_000n,
        },
        feeParams,
      },
      {
        chain: makeChain(),
        dstPublicClient: {} as never,
        address: ADDRESS,
        client,
        waitForReceipt: false,
      }
    );

    expect(client.sendCalls).not.toHaveBeenCalled();
    expect(client.sendTransaction).toHaveBeenCalledTimes(2);
    expect(client.sendTransaction).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        gas: 65_000n,
        gasPrice: 500_000_000n,
      })
    );
    expect(client.sendTransaction).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        gas: 123_456n,
        gasPrice: 500_000_000n,
      })
    );
  });
});
