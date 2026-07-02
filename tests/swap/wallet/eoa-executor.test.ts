import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  dispatchViaEoa,
  executeViaEoa,
  waitForDispatchedEoaCalls,
} from '../../../src/swap/wallet/eoa-executor';
import type { Hex, WalletClient } from 'viem';
import { makeChain } from '../../helpers/chains';

const MOCK_CALL_ID = '0xcallid123';
const CHAIN = makeChain(42161, 'Arbitrum');

const makeWalletClient = () => {
  let currentChainId = 1;
  return {
    getChainId: vi.fn(async () => currentChainId),
    switchChain: vi.fn(async ({ id }: { id: number }) => {
      currentChainId = id;
      return CHAIN;
    }),
    addChain: vi.fn(),
    sendCalls: vi.fn().mockResolvedValue({ id: MOCK_CALL_ID }),
    waitForCallsStatus: vi.fn().mockResolvedValue({
      status: 'success',
      receipts: [{ transactionHash: '0xabc123' as Hex }],
    }),
  } as unknown as WalletClient & {
    getChainId: ReturnType<typeof vi.fn>;
    switchChain: ReturnType<typeof vi.fn>;
    sendCalls: ReturnType<typeof vi.fn>;
    waitForCallsStatus: ReturnType<typeof vi.fn>;
  };
};

const MOCK_CALLS = [
  { to: '0x1111111111111111111111111111111111111111' as Hex, data: '0xabcdef' as Hex, value: 0n },
];

describe('executeViaEoa', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends calls via walletClient.sendCalls and returns txHash', async () => {
    const walletClient = makeWalletClient();

    const result = await executeViaEoa({
      walletClient,
      calls: MOCK_CALLS,
      chain: CHAIN,
      address: '0xaaaa' as Hex,
    });

    expect(result.txHash).toBe('0xabc123');
    expect(walletClient.sendCalls).toHaveBeenCalledWith(
      expect.objectContaining({
        calls: MOCK_CALLS,
        chain: CHAIN,
        account: '0xaaaa',
        experimental_fallback: true,
      }),
    );
  });

  it('passes timeout to waitForCallsStatus', async () => {
    const walletClient = makeWalletClient();

    await executeViaEoa({
      walletClient,
      calls: MOCK_CALLS,
      chain: CHAIN,
      address: '0xaaaa' as Hex,
      maxWaitMs: 5000,
    });

    expect(walletClient.waitForCallsStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        id: MOCK_CALL_ID,
        timeout: 5000,
      }),
    );
  });

  it('throws when waitForCallsStatus returns failure', async () => {
    const walletClient = makeWalletClient();
    walletClient.waitForCallsStatus.mockResolvedValue({
      status: 'failure',
      receipts: [],
    });

    await expect(
      executeViaEoa({
        walletClient,
        calls: MOCK_CALLS,
        chain: CHAIN,
        address: '0xaaaa' as Hex,
      }),
    ).rejects.toThrow(/failed/i);
  });

  it('throws when no receipt txHash on success', async () => {
    const walletClient = makeWalletClient();
    walletClient.waitForCallsStatus.mockResolvedValue({
      status: 'success',
      receipts: [],
    });

    await expect(
      executeViaEoa({
        walletClient,
        calls: MOCK_CALLS,
        chain: CHAIN,
        address: '0xaaaa' as Hex,
      }),
    ).rejects.toThrow(/no receipt/i);
  });

  it('handles single call correctly', async () => {
    const walletClient = makeWalletClient();
    const singleCall = { to: '0x2222222222222222222222222222222222222222' as Hex, data: '0x00' as Hex, value: 100n };

    const result = await executeViaEoa({
      walletClient,
      calls: [singleCall],
      chain: CHAIN,
      address: '0xaaaa' as Hex,
    });

    expect(result.txHash).toBe('0xabc123');
    expect(walletClient.sendCalls).toHaveBeenCalledWith(
      expect.objectContaining({
        calls: [singleCall],
      }),
    );
  });

  it('dispatchViaEoa sends calls without waiting for receipts', async () => {
    const walletClient = makeWalletClient();

    const dispatched = await dispatchViaEoa({
      walletClient,
      calls: MOCK_CALLS,
      chain: CHAIN,
      address: '0xaaaa' as Hex,
    });

    expect(dispatched).toEqual({
      id: MOCK_CALL_ID,
      chainId: 42161,
      address: '0xaaaa',
    });
    expect(walletClient.sendCalls).toHaveBeenCalledTimes(1);
    expect(walletClient.waitForCallsStatus).not.toHaveBeenCalled();
  });

  it('dispatchViaEoa switches to the target chain before wallet_sendCalls', async () => {
    const walletClient = makeWalletClient();

    await dispatchViaEoa({
      walletClient,
      calls: MOCK_CALLS,
      chain: CHAIN,
      address: '0xaaaa' as Hex,
    });

    expect(walletClient.switchChain).toHaveBeenCalledWith({ id: CHAIN.id });
    expect(walletClient.sendCalls).toHaveBeenCalledWith(
      expect.objectContaining({
        chain: CHAIN,
      })
    );
    expect(walletClient.switchChain.mock.invocationCallOrder[0]).toBeLessThan(
      walletClient.sendCalls.mock.invocationCallOrder[0]
    );
  });

  it('waitForDispatchedEoaCalls waits only when explicitly asked', async () => {
    const walletClient = makeWalletClient();

    const txHash = await waitForDispatchedEoaCalls({
      walletClient,
      dispatch: {
        id: MOCK_CALL_ID,
        chainId: 42161,
        address: '0xaaaa' as Hex,
      },
      maxWaitMs: 5000,
    });

    expect(txHash).toBe('0xabc123');
    expect(walletClient.waitForCallsStatus).toHaveBeenCalledWith({
      id: MOCK_CALL_ID,
      timeout: 5000,
    });
  });
});
