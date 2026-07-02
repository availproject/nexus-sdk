import { describe, expect, it, vi } from 'vitest';
import type { Hex } from 'viem';

vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem');
  return {
    ...actual,
    createPublicClient: vi.fn().mockReturnValue({}),
    http: vi.fn().mockReturnValue({}),
  };
});

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
  packERC20Approve: vi.fn().mockReturnValue('0xapprove' as Hex),
}));

vi.mock('../../src/services/allowance-utils', () => ({
  erc20GetAllowance: vi.fn().mockResolvedValue(0n),
}));

import { sendExecuteTransactions, type ExecuteFeeParams } from '../../src/execute/runtime';

const TX_HASH = '0x1111111111111111111111111111111111111111111111111111111111111111' as Hex;
const ADDRESS = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Hex;

const makeChain = () =>
  ({
    id: 42161,
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
});

const makeClient = () => ({
  sendTransaction: vi.fn().mockResolvedValue(TX_HASH),
});

describe('sendExecuteTransactions feeParams', () => {
  it('spreads EIP-1559 fields when feeParams.type is eip1559', async () => {
    const client = makeClient();
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
        plan: {
          steps: [{ type: 'execute_transaction', id: 'test', chain: makeChain(), to: makeTx().to }],
          transactionStep: { type: 'execute_transaction', id: 'test', chain: makeChain(), to: makeTx().to },
        },
      },
      {
        chain: makeChain(),
        dstPublicClient: {} as never,
        address: ADDRESS,
        client: client as never,
        waitForReceipt: false,
      }
    );

    expect(client.sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        maxFeePerGas: 2_000_000_000n,
        maxPriorityFeePerGas: 100_000_000n,
      })
    );
    expect(client.sendTransaction).not.toHaveBeenCalledWith(
      expect.objectContaining({ gasPrice: expect.anything() })
    );
  });

  it('spreads gasPrice when feeParams.type is legacy', async () => {
    const client = makeClient();
    const feeParams: ExecuteFeeParams = {
      type: 'legacy',
      gasPrice: 500_000_000n,
    };

    await sendExecuteTransactions(
      {
        tx: makeTx(),
        approvalTx: null,
        feeParams,
        plan: {
          steps: [{ type: 'execute_transaction', id: 'test', chain: makeChain(), to: makeTx().to }],
          transactionStep: { type: 'execute_transaction', id: 'test', chain: makeChain(), to: makeTx().to },
        },
      },
      {
        chain: makeChain(),
        dstPublicClient: {} as never,
        address: ADDRESS,
        client: client as never,
        waitForReceipt: false,
      }
    );

    expect(client.sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        gasPrice: 500_000_000n,
      })
    );
    expect(client.sendTransaction).not.toHaveBeenCalledWith(
      expect.objectContaining({ maxFeePerGas: expect.anything() })
    );
  });

  it('spreads no fee fields when feeParams is undefined', async () => {
    const client = makeClient();

    await sendExecuteTransactions(
      {
        tx: makeTx(),
        approvalTx: null,
        plan: {
          steps: [{ type: 'execute_transaction', id: 'test', chain: makeChain(), to: makeTx().to }],
          transactionStep: { type: 'execute_transaction', id: 'test', chain: makeChain(), to: makeTx().to },
        },
      },
      {
        chain: makeChain(),
        dstPublicClient: {} as never,
        address: ADDRESS,
        client: client as never,
        waitForReceipt: false,
      }
    );

    const call = client.sendTransaction.mock.calls[0][0];
    expect(call).not.toHaveProperty('gasPrice');
    expect(call).not.toHaveProperty('maxFeePerGas');
    expect(call).not.toHaveProperty('maxPriorityFeePerGas');
  });
});
