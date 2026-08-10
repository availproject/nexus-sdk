import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hex } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import { sweepEphemeralRefundsToEoa } from '../../src/services/init-refund-sweep';
import { predictSafeAccountAddressV2 } from '../../src/swap/safe/predict';
import { EADDRESS } from '../../src/swap/constants';
import type { ChainListType } from '../../src/domain';
import type { PublicClientList } from '../../src/swap/types';
import { makeSwapMiddlewareClient } from '../helpers/middleware-client';

vi.mock('../../src/services/safe', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../src/services/safe')>();
  return {
    ...orig,
    createSafeExecuteTxFromCalls: vi.fn().mockResolvedValue({
      chainId: 999,
      safeAddress: '0xacc1ffaf0000000000000000000000000000beef',
      to: '0xacc1ffaf0000000000000000000000000000beef',
      value: '0x0',
      data: '0xdeadbeef',
      operation: 0,
      safeTxGas: '0x0',
      baseGas: '0x0',
      gasPrice: '0x0',
      gasToken: '0x0000000000000000000000000000000000000000',
      refundReceiver: '0x0000000000000000000000000000000000000000',
      signature: '0x',
    }),
    ensureSafeForEphemeral: vi.fn().mockResolvedValue({
      chainId: 999,
      owner: '0xbbbb000000000000000000000000000000000002',
      address: '0xacc1ffaf0000000000000000000000000000beef',
      factoryAddress: '0x0',
      exists: true,
    }),
  };
});

import { createSafeExecuteTxFromCalls } from '../../src/services/safe';

const ARB_CHAIN = 42161;
const OTHER_CHAIN = 999;
const USDC_ARB = '0xaf88d065e77c8cc2239327c5edb3a432268e5831' as Hex;
const EPHEMERAL = '0xbbbb000000000000000000000000000000000002' as Hex;
const EOA = '0xaaaa000000000000000000000000000000000001' as Hex;

const makeChainList = (): ChainListType =>
  ({
    chains: [],
    getChainByID: vi.fn((id: number) => ({
      id,
      name: `Chain ${id}`,
      nativeCurrency: { decimals: 18, symbol: 'ETH', name: 'Ether', logo: '' },
      custom: { icon: '', knownTokens: [] },
    })),
    getTokenByAddress: vi.fn((_id: number, addr: Hex) =>
      addr.toLowerCase() === USDC_ARB.toLowerCase()
        ? {
            contractAddress: USDC_ARB,
            decimals: 6,
            symbol: 'USDC',
            name: 'USD Coin',
            permitVariant: 1,
            permitVersion: 2,
          }
        : undefined
    ),
    getTokenByCurrencyId: vi.fn(),
    getChainAndTokenByAddress: vi.fn(),
    getNativeToken: vi.fn(),
    getTokenInfoBySymbol: vi.fn(),
    getVaultContractAddress: vi.fn(),
    getChainAndTokenFromSymbol: vi.fn(),
  }) as unknown as ChainListType;

const makePublicClientList = (): PublicClientList =>
  ({
    get: vi.fn().mockReturnValue({
      getCode: vi.fn().mockResolvedValue(undefined),
      readContract: vi.fn().mockImplementation(({ functionName }: { functionName: string }) =>
        functionName === 'name' ? 'USD Coin' : 0n
      ),
    }),
  }) as unknown as PublicClientList;

const makeEphemeralWallet = (): PrivateKeyAccount =>
  ({
    address: EPHEMERAL,
    signTypedData: vi.fn().mockResolvedValue(`0x${'11'.repeat(64)}1b` as Hex),
  }) as unknown as PrivateKeyAccount;

describe('sweepEphemeralRefundsToEoa dispatch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fires one Safe transaction per chain and pulls ephemeral ERC-20 refunds by permit', async () => {
    const safeAddress = predictSafeAccountAddressV2(EOA, EPHEMERAL).address;
    const createSafeExecuteTx = vi.fn().mockResolvedValue({ txHash: '0xsafe' as Hex });
    const getSwapBalances = vi.fn(async (address: Hex) => {
      if (address.toLowerCase() === EPHEMERAL.toLowerCase()) {
        // ERC-20 refund at the ephemeral bridge holder; native is skipped because the Safe cannot
        // pull native value from a separate account.
        return [
          { chainID: ARB_CHAIN, tokenAddress: USDC_ARB, amount: '5', decimals: 6, symbol: 'USDC', name: 'USD Coin', logo: '', value: 5 },
          { chainID: ARB_CHAIN, tokenAddress: EADDRESS, amount: '0.5', decimals: 18, symbol: 'ETH', name: 'Ether', logo: '', value: 1500 },
        ];
      }
      if (address.toLowerCase() === safeAddress.toLowerCase()) {
        // Native refund already held by the Safe.
        return [
          { chainID: OTHER_CHAIN, tokenAddress: EADDRESS, amount: '0.3', decimals: 18, symbol: 'ETH', name: 'Ether', logo: '', value: 900 },
        ];
      }
      return [];
    });

    const middlewareClient = makeSwapMiddlewareClient({
      createSafeExecuteTx,
      getSwapBalances,
      getSafeAccountAddress: vi.fn().mockResolvedValue({ address: safeAddress }),
      ensureSafeAccount: vi.fn().mockResolvedValue({}),
    });

    await sweepEphemeralRefundsToEoa({
      ctx: {
        chainList: makeChainList(),
        middlewareClient,
        publicClientList: makePublicClientList(),
        ephemeralWallet: makeEphemeralWallet(),
        eoaAddress: EOA,
        cache: undefined,
      },
    });

    expect(createSafeExecuteTx).toHaveBeenCalledTimes(2);
    const safeBuilds = vi.mocked(createSafeExecuteTxFromCalls).mock.calls.map(([input]) => input);
    expect(safeBuilds.find((input) => input.chainId === ARB_CHAIN)?.calls).toHaveLength(2);
    expect(safeBuilds.find((input) => input.chainId === OTHER_CHAIN)?.calls[0]?.value).toBe(
      300_000_000_000_000_000n
    );
  });
});
