import { beforeEach, describe, expect, it, vi } from 'vitest';

import { caliburExecute } from '../../src/swap/sbc';

describe('caliburExecute', () => {
  const writeContractMock = vi.fn();
  const signTypedDataMock = vi.fn();
  const wallet = {
    writeContract: writeContractMock,
  } as never;
  const ephemeralWallet = {
    signTypedData: signTypedDataMock,
  } as never;
  const chain = {
    id: 534352,
  } as never;

  beforeEach(() => {
    vi.clearAllMocks();
    signTypedDataMock.mockResolvedValue(`0x${'11'.repeat(65)}`);
    writeContractMock.mockResolvedValue('0xhash');
  });

  it('forwards the execute request to the wallet without gas/fee params (wallet estimates)', async () => {
    const result = await caliburExecute({
      actualAddress: '0x1111111111111111111111111111111111111111',
      actualWallet: wallet,
      calls: [
        {
          to: '0x2222222222222222222222222222222222222222',
          value: 1n,
          data: '0x1234',
        },
      ],
      chain,
      signerWallet: ephemeralWallet,
      targetAddress: '0x3333333333333333333333333333333333333333',
      value: 1n,
    });

    expect(writeContractMock).toHaveBeenCalledTimes(1);
    const callArgs = writeContractMock.mock.calls[0][0];
    expect(callArgs).toMatchObject({
      account: '0x1111111111111111111111111111111111111111',
      address: '0x3333333333333333333333333333333333333333',
      chain,
      functionName: 'execute',
      value: 1n,
    });
    // Explicitly verify the wallet-managed-gas contract: no preset gas limit, no preset
    // fee params. The user's wallet estimates against the signed payload at submit time.
    expect(callArgs.gas).toBeUndefined();
    expect(callArgs.gasPrice).toBeUndefined();
    expect(callArgs.maxFeePerGas).toBeUndefined();
    expect(callArgs.maxPriorityFeePerGas).toBeUndefined();
    expect(result).toBe('0xhash');
  });
});
