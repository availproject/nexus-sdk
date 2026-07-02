import { describe, expect, it, vi } from 'vitest';
import type { Hex } from 'viem';
import { getBalancesForSwap } from '../../src/services/balances';
import { EADDRESS } from '../../src/swap/constants';
import type { Chain, ChainListType } from '../../src/domain';
import { Universe } from '../../src/domain/chain-abstraction';
import type { MiddlewareSwapBalanceClient } from '../../src/transport';

// 0.01 ETH representative reserve fee
vi.mock('../../src/services/swap-native-reserve-fee', () => ({
  estimateRepresentativeSwapNativeReserveFee: vi.fn().mockResolvedValue(10_000_000_000_000_000n),
}));

const ARB_CHAIN = 42161;
const EVM_ADDRESS = '0x1111111111111111111111111111111111111111' as Hex;

const makeChain = (id: number): Chain => ({
  id,
  name: `Chain ${id}`,
  multicallAddress: '0x00000000000000000000000000000000000000aa',
  rpcUrls: { default: { http: [`https://rpc-${id}.example.com`], webSocket: [] } },
  nativeCurrency: { decimals: 18, symbol: 'ETH', name: 'Ether', logo: '' },
  custom: { icon: '', knownTokens: [] },
  blockExplorers: { default: { name: 'explorer', url: 'https://example.com' } },
  universe: Universe.ETHEREUM,
});

const makeChainList = (): ChainListType =>
  ({
    chains: [makeChain(ARB_CHAIN)],
    getChainByID: vi.fn((id: number) => makeChain(id)),
    getTokenByAddress: vi.fn(),
    getNativeToken: vi.fn(),
    getTokenByCurrencyId: vi.fn(),
    getVaultContractAddress: vi.fn(),
    getTokenInfoBySymbol: vi.fn(),
    getChainAndTokenFromSymbol: vi.fn(),
    getChainAndTokenByAddress: vi.fn(),
  }) as unknown as ChainListType;

const makeMiddleware = (): MiddlewareSwapBalanceClient =>
  ({
    getSwapBalances: vi.fn().mockResolvedValue([
      {
        amount: '1',
        chainID: ARB_CHAIN,
        decimals: 18,
        symbol: 'ETH',
        tokenAddress: EADDRESS,
        value: 3000,
        logo: '',
        name: 'Ether',
      },
    ]),
  }) as unknown as MiddlewareSwapBalanceClient;

describe('getBalancesForSwap deductNativeReserve flag', () => {
  it('deducts the native gas reserve by default (unchanged behaviour)', async () => {
    const result = await getBalancesForSwap({
      middlewareClient: makeMiddleware(),
      evmAddress: EVM_ADDRESS,
      chainList: makeChainList(),
    });
    const eth = result.find((t) => t.symbol === 'ETH');
    expect(Number(eth!.chainBalances[0]!.balance)).toBeCloseTo(0.99, 6); // 1 - 0.01 reserve
  });

  it('returns the full native balance when deductNativeReserve=false', async () => {
    const result = await getBalancesForSwap({
      middlewareClient: makeMiddleware(),
      evmAddress: EVM_ADDRESS,
      chainList: makeChainList(),
      deductNativeReserve: false,
    });
    const eth = result.find((t) => t.symbol === 'ETH');
    expect(eth!.chainBalances[0]!.balance).toBe('1'); // full, no reserve deducted
  });
});
