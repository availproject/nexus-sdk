import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hex } from 'viem';
import type { EthereumProvider } from '../../src/domain';
import type { MiddlewareClient } from '../../src/transport';
import { createNexusClient } from '../../src/core/sdk';
import { makeMiddlewareClient as makeBaseMiddlewareClient } from '../helpers/middleware-client';

const hoisted = vi.hoisted(() => ({
  createChainList: vi.fn(),
}));

vi.mock('../../src/services/chain-list', () => ({
  createChainList: hoisted.createChainList,
}));

const makeMiddlewareClient = (): MiddlewareClient =>
  makeBaseMiddlewareClient({
    getDeployment: vi.fn().mockResolvedValue({ network: 'testnet' }),
    getRFFStatus: vi.fn().mockResolvedValue({ status: 'created' }),
    configureTiming: vi.fn(),
    getSwapBalances: vi.fn().mockResolvedValue([
      {
        amount: '900',
        chainID: 42161,
        decimals: 6,
        logo: 'https://cdn.example/usdc.png',
        name: 'USD Coin',
        symbol: 'USDC',
        tokenAddress: '0x00000000000000000000000000000000000000c1' as Hex,
        value: 900,
      },
      {
        amount: '600',
        chainID: 10,
        decimals: 6,
        logo: 'https://cdn.example/usdc.png',
        name: 'USD Coin',
        symbol: 'USDC',
        tokenAddress: '0x00000000000000000000000000000000000000c1' as Hex,
        value: 600,
      },
    ]),
  });

const makeProvider = (): EthereumProvider =>
  ({
    request: vi.fn().mockImplementation(async ({ method }: { method: string }) => {
      switch (method) {
        case 'eth_accounts':
          return ['0x0000000000000000000000000000000000000aaa'];
        case 'eth_chainId':
          return '0xa4b1';
        case 'personal_sign':
          return `0x${'ab'.repeat(65)}`;
        default:
          throw new Error(`Unhandled provider method: ${method}`);
      }
    }),
  }) as unknown as EthereumProvider;

describe('createNexusClient getBalancesForSwap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.createChainList.mockReturnValue({
      getChainByID: vi.fn().mockImplementation((chainId: number) => ({
        id: chainId,
        name: chainId === 42161 ? 'Arbitrum' : 'Optimism',
        universe: 'EVM',
        custom: { icon: `https://cdn.example/${chainId}.png` },
        nativeCurrency: { decimals: 18, symbol: 'ETH' },
      })),
      getTokenByAddress: vi.fn().mockImplementation(() => {
        throw new Error('getBalancesForSwap should not query token metadata from chainList');
      }),
    });
  });

  it('returns swap-sourced balances as TokenBalance[]', async () => {
    const middlewareClient = makeMiddlewareClient();
    const client = createNexusClient({
      network: 'testnet',
      internal: { middlewareClient },
    });

    await client.initialize();
    await client.setEVMProvider(makeProvider());
    const assets = await client.getBalancesForSwap();

    expect(middlewareClient.getSwapBalances).toHaveBeenCalledWith(
      '0x0000000000000000000000000000000000000aaa'
    );
    expect(assets).toEqual([
      expect.objectContaining({
        symbol: 'USDC',
        balance: '1500',
        value: '1500.00',
        logo: 'https://cdn.example/usdc.png',
        name: 'USDC',
        chainBalances: [
          expect.objectContaining({ chain: expect.objectContaining({ id: 42161 }) }),
          expect.objectContaining({ chain: expect.objectContaining({ id: 10 }) }),
        ],
      }),
    ]);
  });
});
