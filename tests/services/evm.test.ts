import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExecutionError } from '../../src/domain/errors';
import { confirmStepReceipt, getL1Fee } from '../../src/services/evm';
import * as evmService from '../../src/services/evm';

const readContract = vi.fn();

vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem');
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({ readContract })),
    fallback: vi.fn((transports) => transports[0]),
    http: vi.fn((url) => url),
  };
});

describe('getL1Fee', () => {
  beforeEach(() => {
    readContract.mockReset();
  });

  it('sums fees across multiple OP stack transactions', async () => {
    readContract.mockResolvedValueOnce(97n).mockResolvedValueOnce(143n);

    const fee = await getL1Fee(
      {
        id: 84532,
        name: 'Base Sepolia',
        rpcUrls: { default: { http: ['https://base-sepolia.example'] } },
      } as never,
      [
        {
          toAddress: '0x0000000000000000000000000000000000000001',
          input: '0x01',
        },
        {
          toAddress: '0x0000000000000000000000000000000000000002',
          input: '0x02',
        },
      ]
    );

    expect(fee).toBe(240n);
    expect(readContract).toHaveBeenCalledTimes(2);
  });
});

describe('confirmStepReceipt', () => {
  const step = { stepId: 'source_swap:42161', stepType: 'source_swap', label: 'Source swap' };
  const TX = '0xabc0000000000000000000000000000000000000000000000000000000000001' as const;

  const makeClient = (
    status: 'success' | 'reverted',
    onArgs?: (a: { confirmations: number }) => void
  ) =>
    ({
      waitForTransactionReceipt: async (a: { confirmations: number }) => {
        onArgs?.(a);
        return { status };
      },
    }) as never;

  it('returns the txHash when the receipt succeeds', async () => {
    await expect(confirmStepReceipt(makeClient('success'), TX, 42161, step)).resolves.toBe(TX);
  });

  it('throws a step-tagged ExecutionError on revert', async () => {
    const error = await confirmStepReceipt(makeClient('reverted'), TX, 42161, step).catch((e) => e);
    expect(error).toBeInstanceOf(ExecutionError);
    expect(error).toMatchObject({
      code: 'execution/tx_onchain_reverted',
      message: 'Source swap reverted on chain 42161',
      context: {
        service: 'rpc',
        stepId: 'source_swap:42161',
        stepType: 'source_swap',
        chainId: 42161,
      },
    });
  });

  it('waits 1 block on Ethereum mainnet, 2 on other chains', async () => {
    let confirmations: number | undefined;
    const capture = (a: { confirmations: number }) => {
      confirmations = a.confirmations;
    };
    await confirmStepReceipt(makeClient('success', capture), TX, 1, step);
    expect(confirmations).toBe(1);
    await confirmStepReceipt(makeClient('success', capture), TX, 42161, step);
    expect(confirmations).toBe(2);
  });
});

describe('evm service exports', () => {
  it('does not keep unused allowance write helpers without local chain switching', () => {
    expect(evmService).not.toHaveProperty('erc20SetAllowance');
  });
});
