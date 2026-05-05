import { CurrencyID } from '@avail-project/ca-common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VSCClient } from '../commons';

const createSBCTxFromCallsMock = vi.hoisted(() => vi.fn());
const createSafeExecuteTxFromCallsMock = vi.hoisted(() => vi.fn());
const waitForSBCTxReceiptMock = vi.hoisted(() => vi.fn());

vi.mock('./sbc', () => ({
  createSBCTxFromCalls: createSBCTxFromCallsMock,
  waitForSBCTxReceipt: waitForSBCTxReceiptMock,
}));

vi.mock('./safetx', () => ({
  createSafeExecuteTxFromCalls: createSafeExecuteTxFromCallsMock,
}));

import { performDestinationSwap } from './utils';

describe('performDestinationSwap', () => {
  type MockedDestinationVSCClient = Pick<
    VSCClient,
    'vscCreateSafeExecuteTx' | 'vscEnsureSafeAccount' | 'vscSBCTx'
  >;

  const emitter = { emit: vi.fn() } as const;
  const publicClientList = { get: vi.fn(() => ({})) } as never;
  const chainList = {
    getChainByID: vi.fn((id: number) => ({
      blockExplorers: {
        default: {
          url: `https://explorer.example/${id}`,
        },
      },
      id,
    })),
  } as never;
  const cache = { getAllowance: vi.fn(() => 0n) } as never;
  const baseInput = {
    actualAddress: '0x1111111111111111111111111111111111111111' as const,
    cache,
    calls: [],
    chain: { id: 999 } as never,
    chainList,
    COT: CurrencyID.USDC,
    emitter,
    hasDestinationSwap: true,
    publicClientList,
    signerWallet: { address: '0x2222222222222222222222222222222222222222' } as never,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    createSBCTxFromCallsMock.mockResolvedValue({ chain_id: new Uint8Array([1]) });
    createSafeExecuteTxFromCallsMock.mockResolvedValue({ chain_id: new Uint8Array([2]) });
    waitForSBCTxReceiptMock.mockResolvedValue(undefined);
  });

  it('uses the smart-account VSC flow for Safe account destinations', async () => {
    const vscClient: MockedDestinationVSCClient = {
      vscCreateSafeExecuteTx: vi.fn().mockResolvedValue([999n, '0xhash']),
      vscEnsureSafeAccount: vi.fn(),
      vscSBCTx: vi.fn(),
    };

    const result = await performDestinationSwap({
      ...baseInput,
      destinationExecution: {
        address: '0x3333333333333333333333333333333333333333',
        entryPoint: null,
        mode: 'safe_account',
      },
      vscClient: vscClient as VSCClient,
    });

    expect(vscClient.vscEnsureSafeAccount).not.toHaveBeenCalled();
    expect(vscClient.vscCreateSafeExecuteTx).toHaveBeenCalledTimes(1);
    expect(vscClient.vscSBCTx).not.toHaveBeenCalled();
    expect(createSafeExecuteTxFromCallsMock).toHaveBeenCalledTimes(1);
    expect(createSBCTxFromCallsMock).not.toHaveBeenCalled();
    expect(result).toBe('0xhash');
  });

  it('keeps the existing 7702 SBC path for delegated destinations', async () => {
    const vscClient: MockedDestinationVSCClient = {
      vscCreateSafeExecuteTx: vi.fn(),
      vscEnsureSafeAccount: vi.fn(),
      vscSBCTx: vi.fn().mockResolvedValue([[999n, '0xhash']]),
    };

    const result = await performDestinationSwap({
      ...baseInput,
      destinationExecution: {
        address: '0x2222222222222222222222222222222222222222',
        entryPoint: null,
        mode: '7702',
      },
      vscClient: vscClient as VSCClient,
    });

    expect(vscClient.vscEnsureSafeAccount).not.toHaveBeenCalled();
    expect(vscClient.vscCreateSafeExecuteTx).not.toHaveBeenCalled();
    expect(vscClient.vscSBCTx).toHaveBeenCalledTimes(1);
    expect(createSBCTxFromCallsMock).toHaveBeenCalledTimes(1);
    expect(createSafeExecuteTxFromCallsMock).not.toHaveBeenCalled();
    expect(result).toBe('0xhash');
  });
});
