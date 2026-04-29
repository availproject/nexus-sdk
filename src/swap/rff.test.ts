import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createVaultFundingAndAllowanceCalls } from './rff';

const createPermitOnlyApprovalTxMock = vi.hoisted(() => vi.fn());

vi.mock('./utils', async () => {
  const actual = await vi.importActual<typeof import('./utils')>('./utils');
  return {
    ...actual,
    createPermitOnlyApprovalTx: createPermitOnlyApprovalTxMock,
  };
});

describe('createVaultFundingAndAllowanceCalls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createPermitOnlyApprovalTxMock.mockResolvedValue({
      data: '0xpermit',
      to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      value: 0n,
    });
  });

  it('funds ephemeral from the Calibur wrapper and signs an ephemeral vault permit', async () => {
    const calls = await createVaultFundingAndAllowanceCalls({
      allowance: 0n,
      chainID: 999,
      evm: {
        address: '0x2222222222222222222222222222222222222222',
        client: { address: '0x2222222222222222222222222222222222222222' } as never,
      },
      publicClientList: { get: vi.fn(() => ({})) } as never,
      sourceExecution: {
        address: '0x3333333333333333333333333333333333333333',
        entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
        mode: 'calibur_account',
      },
      tokenAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      valueRaw: 1_000_000n,
      vaultAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    });

    expect(calls[0]).toEqual(
      expect.objectContaining({
        to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        value: 0n,
      })
    );
    expect(createPermitOnlyApprovalTxMock).toHaveBeenCalledWith({
      amount: 1_000_000n,
      chainId: 999,
      contractAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      owner: '0x2222222222222222222222222222222222222222',
      publicClient: {},
      signerWallet: { address: '0x2222222222222222222222222222222222222222' },
      spender: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    });
    expect(calls[1]).toEqual({
      data: '0xpermit',
      to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      value: 0n,
    });
  });

  it('keeps the existing approve call for 7702 bridge deposits', async () => {
    const calls = await createVaultFundingAndAllowanceCalls({
      allowance: 0n,
      chainID: 1,
      evm: {
        address: '0x2222222222222222222222222222222222222222',
        client: { address: '0x2222222222222222222222222222222222222222' } as never,
      },
      publicClientList: { get: vi.fn(() => ({})) } as never,
      sourceExecution: {
        address: '0x2222222222222222222222222222222222222222',
        entryPoint: null,
        mode: '7702',
      },
      tokenAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      valueRaw: 1_000_000n,
      vaultAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    });

    expect(createPermitOnlyApprovalTxMock).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(
      expect.objectContaining({
        to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        value: 0n,
      })
    );
  });
});
