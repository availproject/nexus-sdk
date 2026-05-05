import { beforeEach, describe, expect, it, vi } from 'vitest';

const estimateFeeContextMock = vi.hoisted(() => vi.fn());
const finalizeFeeEstimatesMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/services/feeEstimation', () => ({
  estimateFeeContext: estimateFeeContextMock,
  finalizeFeeEstimates: finalizeFeeEstimatesMock,
}));

import { caliburExecute } from '../../../../src/swap/sbc';

describe('caliburExecute', () => {
  const estimateGasMock = vi.fn();
  const writeContractMock = vi.fn();
  const signTypedDataMock = vi.fn();
  const publicClient = {
    estimateGas: estimateGasMock,
  } as never;
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
    estimateGasMock.mockResolvedValue(1_100_000n);
    estimateFeeContextMock.mockResolvedValue({
      chainId: 534352,
      recommendation: {
        maxFeePerGas: 10n,
        maxPriorityFeePerGas: 2n,
      },
      overheads: [{ l1Fee: 25n, extraGas: 0n }],
    });
    finalizeFeeEstimatesMock.mockReturnValue([
      {
        l1Fee: 25n,
        l2Fee: 75n,
        total: 100n,
        recommended: {
          gasLimit: 1_320_000n,
          maxFeePerGas: 11n,
          maxPriorityFeePerGas: 2n,
          totalMaxCost: 14_520_025n,
          useLegacyPricing: false,
        },
      },
    ]);
    writeContractMock.mockResolvedValue('0xhash');
  });

  it('estimates the exact execute request and passes explicit gas and fee params to the wallet', async () => {
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

    expect(estimateGasMock).toHaveBeenCalledTimes(1);
    expect(estimateFeeContextMock).toHaveBeenCalledTimes(1);
    expect(finalizeFeeEstimatesMock).toHaveBeenCalledTimes(1);
    expect(writeContractMock).toHaveBeenCalledWith(
      expect.objectContaining({
        account: '0x1111111111111111111111111111111111111111',
        address: '0x3333333333333333333333333333333333333333',
        chain,
        functionName: 'execute',
        gas: 1_320_000n,
        maxFeePerGas: 11n,
        maxPriorityFeePerGas: 2n,
      })
    );
    expect(result).toBe('0xhash');
  });
});
