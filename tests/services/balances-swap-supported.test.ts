import { describe, expect, it, vi } from 'vitest';
import type { Hex } from 'viem';
import { getBalancesForSwap } from '../../src/services/balances';
import type { Chain, ChainListType, TokenInfo } from '../../src/domain';
import { Universe } from '../../src/domain/chain-abstraction';
import type { MiddlewareSwapBalanceClient } from '../../src/transport';

const ARB_CHAIN = 42161;
const HYPER_EVM = 999;
const USDC_ARB = '0xaf88d065e77c8cc2239327c5edb3a432268e5831' as Hex;
const USDC_HYPER = '0xb88339Ca0000000000000000000000000000beef' as Hex;
const EVM_ADDRESS = '0x1111111111111111111111111111111111111111' as Hex;

const makeChain = (id: number, swapSupported: boolean | undefined): Chain => ({
  id,
  name: `Chain ${id}`,
  multicallAddress: '0x00000000000000000000000000000000000000aa',
  rpcUrls: { default: { http: [`https://rpc-${id}.example.com`], webSocket: [] } },
  nativeCurrency: { decimals: 18, symbol: 'ETH', name: 'Ether', logo: '' },
  custom: { icon: '', knownTokens: [] },
  blockExplorers: { default: { name: 'explorer', url: 'https://example.com' } },
  universe: Universe.ETHEREUM,
  ...(swapSupported !== undefined ? { swapSupported } : {}),
});

const usdcToken = (address: Hex): TokenInfo => ({
  contractAddress: address,
  decimals: 6,
  logo: '',
  name: 'USD Coin',
  symbol: 'USDC',
});

const makeChainList = (chains: Chain[]): ChainListType => ({
  chains,
  getVaultContractAddress: vi.fn(),
  getTokenInfoBySymbol: vi.fn(),
  getChainAndTokenFromSymbol: vi.fn() as ChainListType['getChainAndTokenFromSymbol'],
  getTokenByAddress: vi.fn(
    (chainId: number, addr: Hex) =>
      chainId === ARB_CHAIN ? usdcToken(USDC_ARB) : usdcToken(USDC_HYPER)
  ),
  getChainAndTokenByAddress: vi.fn() as ChainListType['getChainAndTokenByAddress'],
  getNativeToken: vi.fn(),
  getChainByID: vi.fn((id: number) => {
    const chain = chains.find((c) => c.id === id);
    if (!chain) throw new Error(`Chain not found: ${id}`);
    return chain;
  }),
  getTokenByCurrencyId: vi.fn(),
});

const makeMiddleware = (): MiddlewareSwapBalanceClient =>
  ({
    getSwapBalances: vi.fn().mockResolvedValue([
      {
        amount: '100',
        chainID: ARB_CHAIN,
        decimals: 6,
        symbol: 'USDC',
        tokenAddress: USDC_ARB,
        value: 100,
        logo: '',
        name: 'USDC',
      },
      {
        amount: '50',
        chainID: HYPER_EVM,
        decimals: 6,
        symbol: 'USDC',
        tokenAddress: USDC_HYPER,
        value: 50,
        logo: '',
        name: 'USDC',
      },
    ]),
  }) as unknown as MiddlewareSwapBalanceClient;

describe('getBalancesForSwap filters chains by swapSupported', () => {
  it('drops chainBalances on chains where swapSupported=false', async () => {
    const chainList = makeChainList([
      makeChain(ARB_CHAIN, true),
      makeChain(HYPER_EVM, false),
    ]);

    const result = await getBalancesForSwap({
      middlewareClient: makeMiddleware(),
      evmAddress: EVM_ADDRESS,
      chainList,
    });

    const usdc = result.find((t) => t.symbol === 'USDC');
    expect(usdc).toBeDefined();
    expect(usdc!.chainBalances.map((c) => c.chain.id)).toEqual([ARB_CHAIN]);
  });

  it('keeps chains where swapSupported is undefined (backwards compatible)', async () => {
    const chainList = makeChainList([
      makeChain(ARB_CHAIN, undefined),
      makeChain(HYPER_EVM, undefined),
    ]);

    const result = await getBalancesForSwap({
      middlewareClient: makeMiddleware(),
      evmAddress: EVM_ADDRESS,
      chainList,
    });

    const usdc = result.find((t) => t.symbol === 'USDC');
    expect(usdc).toBeDefined();
    expect(usdc!.chainBalances.map((c) => c.chain.id).sort()).toEqual(
      [ARB_CHAIN, HYPER_EVM].sort()
    );
  });
});
