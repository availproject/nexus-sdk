import Decimal from 'decimal.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hex } from 'viem';
import type { Chain, ChainListType } from '../../src/domain';
import { Universe } from '../../src/domain/chain-abstraction';
import {
  deductSwapNativeReserveFees,
  getBalancesForSwap,
} from '../../src/services/balances';
import { EADDRESS } from '../../src/swap/constants';
import type { FlatBalance } from '../../src/swap/types';
import type { MiddlewareSwapBalanceClient } from '../../src/transport';

const mocks = vi.hoisted(() => ({
  estimateReserve: vi.fn(),
  getCode: vi.fn(),
}));

vi.mock('../../src/services/evm', () => ({
  createPublicClientWithFallback: vi.fn(() => ({ getCode: mocks.getCode })),
}));

vi.mock('../../src/services/swap-native-reserve-fee', () => ({
  estimateRepresentativeSwapNativeReserveFee: mocks.estimateReserve,
}));

const MONAD_CHAIN_ID = 143;
const EOA = '0x1111111111111111111111111111111111111111' as Hex;
const DELEGATED_CODE = `0xef0100${'22'.repeat(20)}` as Hex;

const monad: Chain = {
  id: MONAD_CHAIN_ID,
  name: 'Monad',
  multicallAddress: '0x00000000000000000000000000000000000000aa',
  rpcUrls: { default: { http: ['https://rpc.monad.example.com'], webSocket: [] } },
  nativeCurrency: { decimals: 18, symbol: 'MON', name: 'Monad', logo: '' },
  custom: { icon: '', knownTokens: [] },
  blockExplorers: { default: { name: 'explorer', url: 'https://example.com' } },
  universe: Universe.ETHEREUM,
};

const chainList = {
  chains: [monad],
  getChainByID: vi.fn(() => monad),
} as unknown as ChainListType;

const mon = (amount: string): FlatBalance => ({
  amount,
  chainID: MONAD_CHAIN_ID,
  decimals: 18,
  symbol: 'MON',
  tokenAddress: EADDRESS,
  value: new Decimal(amount).toNumber(),
  logo: '',
  name: 'Monad',
});

const erc20 = (): FlatBalance => ({
  amount: '20',
  chainID: MONAD_CHAIN_ID,
  decimals: 18,
  symbol: 'TEST',
  tokenAddress: '0x3333333333333333333333333333333333333333',
  value: 20,
  logo: '',
  name: 'Test',
});

const middleware = (balances: FlatBalance[]): MiddlewareSwapBalanceClient =>
  ({ getSwapBalances: vi.fn().mockResolvedValue(balances) }) as MiddlewareSwapBalanceClient;

describe('Monad delegated EOA native reserve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.estimateReserve.mockResolvedValue(10_000_000_000_000_000n);
    mocks.getCode.mockResolvedValue(undefined);
  });

  it('reserves an additional 10 MON and preserves the total balance when delegated', async () => {
    mocks.getCode.mockResolvedValue(DELEGATED_CODE);

    const [asset] = await getBalancesForSwap({
      middlewareClient: middleware([mon('20')]),
      evmAddress: EOA,
      chainList,
    });

    expect(asset).toMatchObject({
      balance: '9.99',
      totalBalance: '20',
      usableBalance: '9.99',
      chainBalances: [
        expect.objectContaining({
          balance: '9.990000000000000000',
          totalBalance: '20',
          usableBalance: '9.990000000000000000',
        }),
      ],
    });
    expect(mocks.getCode).toHaveBeenCalledWith({ address: EOA });
  });

  it('clamps a delegated MON balance below the combined reserve to zero', async () => {
    mocks.getCode.mockResolvedValue(DELEGATED_CODE);

    const [asset] = await getBalancesForSwap({
      middlewareClient: middleware([mon('5')]),
      evmAddress: EOA,
      chainList,
    });

    expect(asset).toMatchObject({
      balance: '0',
      totalBalance: '5',
      usableBalance: '0',
    });
  });

  it('does not reserve 10 MON when the EOA is not delegated', async () => {
    const [asset] = await getBalancesForSwap({
      middlewareClient: middleware([mon('20')]),
      evmAddress: EOA,
      chainList,
    });

    expect(asset).toMatchObject({
      balance: '19.99',
      totalBalance: '20',
      usableBalance: '19.99',
    });
  });

  it('does not check delegation without a positive MON balance', async () => {
    await getBalancesForSwap({
      middlewareClient: middleware([erc20()]),
      evmAddress: EOA,
      chainList,
    });

    expect(mocks.getCode).not.toHaveBeenCalled();
    expect(mocks.estimateReserve).not.toHaveBeenCalled();
  });

  it('checks delegation without waiting for fee estimation to finish', async () => {
    let resolveFee!: (fee: bigint) => void;
    mocks.estimateReserve.mockReturnValue(
      new Promise<bigint>((resolve) => {
        resolveFee = resolve;
      })
    );

    const deduction = deductSwapNativeReserveFees(chainList, [mon('20')], EOA);

    await vi.waitFor(() => expect(mocks.getCode).toHaveBeenCalledWith({ address: EOA }));
    resolveFee(10_000_000_000_000_000n);
    await deduction;
  });
});
