import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account, Hex, PublicClient, WalletClient } from 'viem';
import { PermitVariant } from '../../src/domain/permits';
import { signPermitForAddressAndValue } from '../../src/services/allowance-utils';
import { makeChain } from '../helpers/chains';

const contractReads = vi.hoisted(() => ({
  name: vi.fn(),
  nonces: vi.fn(),
}));

vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>();
  return {
    ...actual,
    getContract: vi.fn(() => ({
      address: '0x0000000000000000000000000000000000000001' as Hex,
      read: contractReads,
    })),
  };
});

const TOKEN = '0x0000000000000000000000000000000000000001' as Hex;
const OWNER = '0x0000000000000000000000000000000000000002' as Hex;
const SPENDER = '0x0000000000000000000000000000000000000003' as Hex;
const SOURCE_CHAIN = makeChain(42161, 'Arbitrum');

describe('signPermitForAddressAndValue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contractReads.name.mockResolvedValue('USD Coin');
    contractReads.nonces.mockResolvedValue(7n);
  });

  it('switches to the supplied chain before signing and uses that chain in the typed data domain', async () => {
    let currentChainId = 1;
    const walletClient = {
      getChainId: vi.fn(async () => currentChainId),
      switchChain: vi.fn(async ({ id }: { id: number }) => {
        currentChainId = id;
        return SOURCE_CHAIN;
      }),
      addChain: vi.fn(),
      request: vi.fn().mockResolvedValue('0x1'),
      signTypedData: vi.fn().mockResolvedValue(`0x${'aa'.repeat(65)}` as Hex),
    } as unknown as WalletClient & {
      getChainId: ReturnType<typeof vi.fn>;
      switchChain: ReturnType<typeof vi.fn>;
      signTypedData: ReturnType<typeof vi.fn>;
    };

    await signPermitForAddressAndValue(
      {
        tokenAddress: TOKEN,
        decimals: 6,
        permitVariant: PermitVariant.EIP2612Canonical,
        permitContractVersion: 2,
      },
      SOURCE_CHAIN,
      walletClient,
      {} as PublicClient,
      { address: OWNER, type: 'json-rpc' } as Account,
      SPENDER,
      123n
    );

    expect(walletClient.switchChain).toHaveBeenCalledWith({ id: SOURCE_CHAIN.id });
    expect(walletClient.signTypedData).toHaveBeenCalledTimes(1);
    expect(walletClient.signTypedData.mock.calls[0]?.[0]?.domain).toEqual(
      expect.objectContaining({
        chainId: BigInt(SOURCE_CHAIN.id),
      })
    );
    expect(walletClient.switchChain.mock.invocationCallOrder[0]).toBeLessThan(
      walletClient.signTypedData.mock.invocationCallOrder[0]
    );
  });
});
