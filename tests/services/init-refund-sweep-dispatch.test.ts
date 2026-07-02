import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hex } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import { sweepEphemeralRefundsToEoa } from '../../src/services/init-refund-sweep';
import { predictSafeAccountAddress } from '../../src/swap/safe/predict';
import { EADDRESS } from '../../src/swap/constants';
import type { ChainListType } from '../../src/domain';
import type { PublicClientList } from '../../src/swap/types';
import { makeSwapMiddlewareClient } from '../helpers/middleware-client';

vi.mock('../../src/swap/wallet/capabilities', () => ({
  chainSupports7702: (chain: { id: number }) => chain.id === 42161,
}));

vi.mock('../../src/services/sbc', () => ({
  createSBCTxFromCalls: vi.fn().mockResolvedValue({
    chainId: 42161,
    address: '0x0000000000000000000000000000000000000001' as Hex,
    calls: [],
    deadline: '0x1' as Hex,
    keyHash: '0x0' as Hex,
    nonce: '0x1' as Hex,
    revertOnFailure: true,
    signature: '0x1234' as Hex,
  }),
  requireSuccessfulSbcResult: vi.fn(() => '0xtxhash' as Hex),
}));

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

import { createSBCTxFromCalls } from '../../src/services/sbc';
import { createSafeExecuteTxFromCalls } from '../../src/services/safe';

const ARB_CHAIN = 42161; // 7702 → ephemeral
const NON7702_CHAIN = 999; // non-7702 → safe
const USDC_ARB = '0xaf88d065e77c8cc2239327c5edb3a432268e5831' as Hex;
const EPHEMERAL = '0xbbbb000000000000000000000000000000000002' as Hex;
const EOA = '0xaaaa000000000000000000000000000000000001' as Hex;

const makeChainList = (): ChainListType =>
  ({
    chains: [],
    getChainByID: vi.fn((id: number) => ({
      id,
      supports7702: id === ARB_CHAIN,
      name: `Chain ${id}`,
      nativeCurrency: { decimals: 18, symbol: 'ETH', name: 'Ether', logo: '' },
      custom: { icon: '', knownTokens: [] },
    })),
    getTokenByAddress: vi.fn((_id: number, addr: Hex) =>
      addr.toLowerCase() === USDC_ARB.toLowerCase()
        ? { contractAddress: USDC_ARB, decimals: 6 }
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
      readContract: vi.fn(),
    }),
  }) as unknown as PublicClientList;

const makeEphemeralWallet = (): PrivateKeyAccount =>
  ({ address: EPHEMERAL, signTypedData: vi.fn().mockResolvedValue('0x1234' as Hex) }) as unknown as PrivateKeyAccount;

describe('sweepEphemeralRefundsToEoa dispatch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fires one batched SBC per 7702 chain and one Safe tx per non-7702 chain (native value carried)', async () => {
    const safeAddress = predictSafeAccountAddress(EPHEMERAL).address;
    const createSafeExecuteTx = vi.fn().mockResolvedValue({ txHash: '0xsafe' as Hex });
    const submitSBCs = vi
      .fn()
      .mockResolvedValue([
        { chainId: ARB_CHAIN, address: '0x0000000000000000000000000000000000000abc' as Hex, errored: false, txHash: '0xsbc' as Hex },
      ]);

    const getSwapBalances = vi.fn(async (address: Hex) => {
      if (address.toLowerCase() === EPHEMERAL.toLowerCase()) {
        // 7702 chain: USDC + ETH → batched into one SBC
        return [
          { chainID: ARB_CHAIN, tokenAddress: USDC_ARB, amount: '5', decimals: 6, symbol: 'USDC', name: 'USD Coin', logo: '', value: 5 },
          { chainID: ARB_CHAIN, tokenAddress: EADDRESS, amount: '0.5', decimals: 18, symbol: 'ETH', name: 'Ether', logo: '', value: 1500 },
        ];
      }
      if (address.toLowerCase() === safeAddress.toLowerCase()) {
        // non-7702 chain: single native → Safe execTransaction, SafeTx.value = 0.3 ETH
        return [
          { chainID: NON7702_CHAIN, tokenAddress: EADDRESS, amount: '0.3', decimals: 18, symbol: 'ETH', name: 'Ether', logo: '', value: 900 },
        ];
      }
      return [];
    });

    const middlewareClient = makeSwapMiddlewareClient({
      submitSBCs,
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

    // 7702 chain → one SBC, batched (USDC transfer + ETH native)
    expect(submitSBCs).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createSBCTxFromCalls).mock.calls[0]![0].calls).toHaveLength(2);
    // non-7702 chain → one Safe tx; single native send carries the amount as nativeValue
    expect(createSafeExecuteTx).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createSafeExecuteTxFromCalls).mock.calls[0]![0].nativeValue).toBe(
      300_000_000_000_000_000n
    );
  });
});
