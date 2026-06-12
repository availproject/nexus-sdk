import { beforeEach, describe, expect, it, vi } from 'vitest';

import { caliburExecute } from '../../src/swap/sbc';

describe('caliburExecute', () => {
  const writeContractMock = vi.fn();
  const signTypedDataMock = vi.fn();
  const estimateContractGasMock = vi.fn();
  const wallet = {
    writeContract: writeContractMock,
  } as never;
  const ephemeralWallet = {
    signTypedData: signTypedDataMock,
  } as never;
  const publicClient = {
    estimateContractGas: estimateContractGasMock,
  } as never;
  const chain = {
    id: 534352,
  } as never;

  beforeEach(() => {
    vi.clearAllMocks();
    signTypedDataMock.mockResolvedValue(`0x${'11'.repeat(65)}`);
    writeContractMock.mockResolvedValue('0xhash');
    estimateContractGasMock.mockResolvedValue(800_000n);
  });

  it('forwards the execute request to the wallet with a buffered gas estimate but no fee params', async () => {
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
      publicClient,
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
    // 1.5x buffer applied on top of eth_estimateGas to absorb the per-block tick-crossing gas
    // swing on aggregator routes (the LI.FI/Eisen failure we hit on HyperEVM).
    expect(callArgs.gas).toBe(1_200_000n);
    // Fee params remain unset — Scroll's pre-flight estimate of gasPrice/maxFeePerGas was
    // inaccurate, so we let the wallet pick fees.
    expect(callArgs.gasPrice).toBeUndefined();
    expect(callArgs.maxFeePerGas).toBeUndefined();
    expect(callArgs.maxPriorityFeePerGas).toBeUndefined();
    expect(result).toBe('0xhash');
  });

  it('falls back to a 1.5M gas limit (× 1.5x buffer) when estimation reverts', async () => {
    estimateContractGasMock.mockRejectedValueOnce(new Error('checkSignatures reverted'));

    await caliburExecute({
      actualAddress: '0x1111111111111111111111111111111111111111',
      actualWallet: wallet,
      calls: [{ to: '0x2222222222222222222222222222222222222222', value: 1n, data: '0x' }],
      chain,
      publicClient,
      signerWallet: ephemeralWallet,
      targetAddress: '0x3333333333333333333333333333333333333333',
      value: 1n,
    });

    const callArgs = writeContractMock.mock.calls[0][0];
    expect(callArgs.gas).toBe(2_250_000n);
  });
});
