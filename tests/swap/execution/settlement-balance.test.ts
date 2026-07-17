import type { Hex } from 'viem';
import { describe, expect, it, vi } from 'vitest';
import { EADDRESS } from '../../../src/swap/constants';
import { readSettlementBalanceRaw } from '../../../src/swap/execution/settlement-balance';
import type { PublicClientList } from '../../../src/swap/types';

const HOLDER = '0x0000000000000000000000000000000000000001' as Hex;
const TOKEN = '0x0000000000000000000000000000000000000002' as Hex;

const makeClients = () => {
  const publicClient = {
    getBalance: vi.fn().mockResolvedValue(7n),
    readContract: vi.fn().mockResolvedValue(11n),
  };
  const publicClientList = {
    get: vi.fn().mockReturnValue(publicClient),
  } as unknown as PublicClientList;
  return { publicClient, publicClientList };
};

describe('readSettlementBalanceRaw', () => {
  it('reads native settlement through getBalance', async () => {
    const { publicClient, publicClientList } = makeClients();

    await expect(
      readSettlementBalanceRaw({
        chainId: 1,
        tokenAddress: EADDRESS,
        holderAddress: HOLDER,
        publicClientList,
      })
    ).resolves.toBe(7n);
    expect(publicClient.getBalance).toHaveBeenCalledWith({ address: HOLDER });
    expect(publicClient.readContract).not.toHaveBeenCalled();
  });

  it('reads ERC-20 settlement through balanceOf', async () => {
    const { publicClient, publicClientList } = makeClients();

    await expect(
      readSettlementBalanceRaw({
        chainId: 1,
        tokenAddress: TOKEN,
        holderAddress: HOLDER,
        publicClientList,
      })
    ).resolves.toBe(11n);
    expect(publicClient.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: TOKEN,
        functionName: 'balanceOf',
        args: [HOLDER],
      })
    );
    expect(publicClient.getBalance).not.toHaveBeenCalled();
  });
});
