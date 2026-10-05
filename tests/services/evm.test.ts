import { describe, expect, it, vi } from 'vitest';
import { UserRejectedRequestError, type WalletClient } from 'viem';
import { UserActionError } from '../../src/domain/errors';
import { switchChain, waitForTxReceipt } from '../../src/services/evm';
import * as evmService from '../../src/services/evm';

describe('waitForTxReceipt', () => {
  const TX = '0xabc0000000000000000000000000000000000000000000000000000000000001' as const;

  it('uses the 3-minute default and falls back to a direct receipt lookup when waiting fails', async () => {
    const waitError = new Error('receipt wait timed out');
    const waitForTransactionReceipt = vi.fn().mockRejectedValue(waitError);
    const receipt = { status: 'success' } as const;
    const getTransactionReceipt = vi.fn().mockResolvedValue(receipt);

    await expect(
      waitForTxReceipt(
        TX,
        {
          waitForTransactionReceipt,
          getTransactionReceipt,
        } as never
      )
    ).resolves.toEqual([receipt, null]);

    expect(waitForTransactionReceipt).toHaveBeenCalledWith({
      confirmations: 1,
      hash: TX,
      timeout: 180_000,
    });
    expect(getTransactionReceipt).toHaveBeenCalledWith({ hash: TX });
  });
});

describe('switchChain', () => {
  it('stops after a rejected switch without prompting to add the chain', async () => {
    const client = {
      getChainId: vi.fn().mockResolvedValue(1),
      switchChain: vi.fn().mockRejectedValue(new UserRejectedRequestError(new Error('denied'))),
      addChain: vi.fn(),
    } as unknown as WalletClient;

    const error = await switchChain(client, { id: 8453 } as never).catch((caught) => caught);

    expect(error).toBeInstanceOf(UserActionError);
    expect(error).toMatchObject({ code: 'user_action/tx_send_denied' });
    expect(client.switchChain).toHaveBeenCalledTimes(1);
    expect(client.addChain).not.toHaveBeenCalled();
  });
});

describe('evm service exports', () => {
  it('does not keep unused allowance write helpers without local chain switching', () => {
    expect(evmService).not.toHaveProperty('erc20SetAllowance');
  });
});
