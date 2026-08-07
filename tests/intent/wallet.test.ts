import { decodeFunctionData, erc20Abi, type Hex, type TransactionReceipt } from 'viem';
import { describe, expect, it, vi } from 'vitest';
import type { Chain } from '../../src/domain';
import { Universe } from '../../src/domain/chain-abstraction';
import { createIntentWallet } from '../../src/intent/wallet';

const ACCOUNT = '0x00000000000000000000000000000000000000aa' as Hex;
const TOKEN = '0x00000000000000000000000000000000000000bb' as Hex;
const SPENDER = '0x00000000000000000000000000000000000000cc' as Hex;
const TX_HASH = `0x${'33'.repeat(32)}` as Hex;

const chain = (id: number): Chain => ({
  id,
  name: `Chain ${id}`,
  universe: Universe.ETHEREUM,
  multicallAddress: ACCOUNT,
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18, logo: '' },
  custom: { icon: '', knownTokens: [] },
  blockExplorers: { default: { name: 'Explorer', url: 'https://explorer.example' } },
  rpcUrls: { default: { http: [`https://rpc-${id}.example`], webSocket: [] } },
});

describe('Better Intent wallet execution', () => {
  it('encodes a caller-selected ERC-20 approval amount and confirms it', async () => {
    const sendTransaction = vi.fn().mockResolvedValue(TX_HASH);
    const wallet = createIntentWallet({
      address: ACCOUNT,
      provider: { request: vi.fn() },
      walletClient: {
        getChainId: vi.fn().mockResolvedValue(1),
        switchChain: vi.fn(),
        addChain: vi.fn(),
        sendTransaction,
      },
      chainList: { getChainByID: (id: number) => chain(id) },
      confirm: vi.fn().mockResolvedValue(undefined),
    });

    const result = await wallet.approve(
      {
        chainId: 1,
        tokenAddress: TOKEN,
        spender: SPENDER,
        owner: ACCOUNT,
        currentRaw: 0n,
        requiredRaw: 10n,
        deficitRaw: 10n,
        approval: { type: 'erc20_approve', to: TOKEN, data: '0x1234', value: '0' },
      },
      20n
    );

    const transaction = sendTransaction.mock.calls[0]?.[0];
    expect(decodeFunctionData({ abi: erc20Abi, data: transaction.data })).toMatchObject({
      functionName: 'approve',
      args: [SPENDER, 20n],
    });
    expect(result).toMatchObject({
      chainId: 1,
      txHash: TX_HASH,
      txExplorerUrl: `https://explorer.example/tx/${TX_HASH}`,
    });
  });

  it('uses personal_sign with the middleware-provided message', async () => {
    const request = vi.fn().mockResolvedValue('0x1234');
    const wallet = createIntentWallet({
      address: ACCOUNT,
      provider: { request },
      walletClient: {},
      chainList: { getChainByID: (id: number) => chain(id) },
      confirm: vi.fn(),
    });

    await expect(wallet.sign('0x1122')).resolves.toBe('0x1234');
    expect(request).toHaveBeenCalledWith({
      method: 'personal_sign',
      params: ['0x1122', ACCOUNT],
    });
  });

  it('rejects approval instructions owned by another account', async () => {
    const wallet = createIntentWallet({
      address: ACCOUNT,
      provider: { request: vi.fn() },
      walletClient: {},
      chainList: { getChainByID: (id: number) => chain(id) },
      confirm: vi.fn<() => Promise<TransactionReceipt | undefined>>(),
    });

    await expect(
      wallet.approve(
        {
          chainId: 1,
          tokenAddress: TOKEN,
          spender: SPENDER,
          owner: '0x00000000000000000000000000000000000000dd',
          currentRaw: 0n,
          requiredRaw: 10n,
          deficitRaw: 10n,
        },
        10n
      )
    ).rejects.toThrow(/does not match connected account/);
  });
});
