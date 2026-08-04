import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account, Hex, PublicClient, WalletClient } from 'viem';
import type { TokenInfo } from '../../src/domain';
import { PermitVariant } from '../../src/domain/permits';
import { signPermitForAddressAndValue } from '../../src/services/allowance-utils';
import { executeAllowances } from '../../src/services/allowances';
import { minutesFromNow } from '../../src/services/time';
import { makeChain, makeChainList } from '../helpers/chains';
import { makeMiddlewareClient } from '../helpers/middleware-client';

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
  afterEach(() => {
    vi.useRealTimers();
  });

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
      123n,
      456n
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

  it('uses a 15-minute deadline for bridge allowance permits', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T00:00:00.000Z'));

    const signTypedData = vi.fn().mockResolvedValue(
      `0x${'0'.repeat(63)}1${'0'.repeat(63)}2${'1b'}` as Hex
    );
    const walletClient = {
      getChainId: vi.fn().mockResolvedValue(SOURCE_CHAIN.id),
      signTypedData,
    } as unknown as WalletClient;
    const token: TokenInfo = {
      contractAddress: TOKEN,
      decimals: 6,
      logo: '',
      name: 'USD Coin',
      symbol: 'USDC',
      permitVariant: PermitVariant.EIP2612Canonical,
      permitVersion: 2,
    };

    await executeAllowances({
      sources: [{ chainID: SOURCE_CHAIN.id, tokenContract: TOKEN, amount: 123n }],
      options: {
        evm: { address: OWNER, client: walletClient },
        chainList: makeChainList([SOURCE_CHAIN], token),
        middlewareClient: makeMiddlewareClient({
          createApprovals: vi.fn().mockResolvedValue([
            {
              chainId: SOURCE_CHAIN.id,
              address: OWNER,
              errored: false,
            },
          ]),
        }),
      },
      dstChain: SOURCE_CHAIN,
    });

    expect(signTypedData.mock.calls[0]?.[0]?.message.deadline).toBe(minutesFromNow(15));
  });
});
