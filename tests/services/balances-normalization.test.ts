import { describe, expect, it } from 'vitest';
import type { TokenInfo, UnifiedBalanceResponseData } from '../../src/domain';
import { Universe } from '../../src/domain/chain-abstraction';
import { aggregateBalancesByCurrency, flatBalancesToAssets } from '../../src/services/balances';
import { encodeChainIdToBytes32, parseHexToTokenBytes } from '../../src/transport/encoding';
import { makeChain, makeChainList } from '../helpers/chains';

describe('aggregateBalancesByCurrency', () => {
  it('groups bridge balances by currencyId and exposes chainBalances metadata', () => {
    const usdc: TokenInfo = {
      contractAddress: '0x0000000000000000000000000000000000000001',
      decimals: 6,
      logo: 'https://cdn.example/usdc.png',
      name: 'USD Coin',
      symbol: 'USDC',
      currencyId: 1,
    };
    const usdm: TokenInfo = {
      contractAddress: '0x0000000000000000000000000000000000000002',
      decimals: 6,
      logo: 'https://cdn.example/usdm.png',
      name: 'Mountain USD',
      symbol: 'USDM',
      currencyId: 1,
    };
    const chainOne = makeChain(1, 'Ethereum');
    const chainTwo = makeChain(10, 'Optimism');
    chainOne.custom.knownTokens = [usdc];
    chainTwo.custom.knownTokens = [usdm];
    const chainList = {
      ...makeChainList([chainOne, chainTwo], usdc),
      getTokenByAddress: (chainId: number) => {
        if (chainId === chainOne.id) return usdc;
        if (chainId === chainTwo.id) return usdm;
        throw new Error(`Unexpected chain ${chainId}`);
      },
    };

    const balances: UnifiedBalanceResponseData[] = [
      {
        chain_id: encodeChainIdToBytes32(chainOne.id),
        currencies: [
          {
            balance: '2370802',
            token_address: parseHexToTokenBytes(usdc.contractAddress),
            value: '2.37',
          },
        ],
        total_usd: '2.37',
        universe: Universe.ETHEREUM,
        errored: false,
      },
      {
        chain_id: encodeChainIdToBytes32(chainTwo.id),
        currencies: [
          {
            balance: '1000000',
            token_address: parseHexToTokenBytes(usdm.contractAddress),
            value: '1',
          },
        ],
        total_usd: '1',
        universe: Universe.ETHEREUM,
        errored: false,
      },
    ];

    const assets = aggregateBalancesByCurrency(chainList, balances);

    expect(assets).toHaveLength(1);
    expect(assets[0]?.balance).toBe('3.370802');
    expect(assets[0]?.value).toBe('3.37');
    expect(assets[0]?.name).toBe('USDC/USDM');
    expect(assets[0]?.symbol).toBe('USDC');
    expect(assets[0]?.logo).toBe('https://cdn.example/usdc.png');
    expect(assets[0]?.chainBalances.map((entry) => entry.chain.id)).toEqual([1, 10]);
    expect(assets[0]?.chainBalances[0]?.balance).toBe('2.370802');
  });
});

describe('flatBalancesToAssets', () => {
  it('groups swap balances into TokenBalance assets ordered by fiat value', () => {
    const usdc: TokenInfo = {
      contractAddress: '0x0000000000000000000000000000000000000001',
      decimals: 6,
      logo: 'https://cdn.example/usdc.png',
      name: 'USD Coin',
      symbol: 'USDC',
    };
    const weth: TokenInfo = {
      contractAddress: '0x0000000000000000000000000000000000000002',
      decimals: 18,
      logo: 'https://cdn.example/weth.png',
      name: 'Wrapped Ether',
      symbol: 'WETH',
    };
    const chainOne = makeChain(1, 'Ethereum');
    const chainTwo = makeChain(42161, 'Arbitrum');
    chainOne.custom.knownTokens = [usdc, weth];
    chainTwo.custom.knownTokens = [usdc];
    const chainList = makeChainList([chainOne, chainTwo], usdc);

    const assets = flatBalancesToAssets(chainList, [
      {
        amount: '2.5',
        chainID: 1,
        decimals: 18,
        logo: 'https://cdn.example/weth.png',
        name: 'Wrapped Ether',
        symbol: 'WETH',
        tokenAddress: weth.contractAddress,
        value: 5000,
      },
      {
        amount: '800',
        chainID: 42161,
        decimals: 6,
        logo: 'https://cdn.example/usdc.png',
        name: 'USD Coin',
        symbol: 'USDC',
        tokenAddress: usdc.contractAddress,
        value: 800,
      },
      {
        amount: '700',
        chainID: 1,
        decimals: 6,
        logo: 'https://cdn.example/usdc.png',
        name: 'USD Coin',
        symbol: 'USDC',
        tokenAddress: usdc.contractAddress,
        value: 700,
      },
    ]);

    expect(assets).toHaveLength(2);
    expect(assets[0]).toEqual(
      expect.objectContaining({
        name: 'WETH',
        symbol: 'WETH',
        balance: '2.5',
        value: '5000.00',
        logo: 'https://cdn.example/weth.png',
        chainBalances: [
          expect.objectContaining({
            balance: '2.5',
            value: '5000.00',
            symbol: 'WETH',
            contractAddress: weth.contractAddress,
            decimals: 18,
            universe: Universe.ETHEREUM,
          }),
        ],
      })
    );
    expect(assets[1]).toEqual(
      expect.objectContaining({
        name: 'USDC',
        symbol: 'USDC',
        balance: '1500',
        value: '1500.00',
        logo: 'https://cdn.example/usdc.png',
      })
    );
    expect(assets[1]?.chainBalances.map((entry) => entry.chain.id)).toEqual([42161, 1]);
  });

  it('falls back to flat balance metadata when a swap token is not in the deployment chain list', () => {
    const unknown = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F' as `0x${string}`;
    const chain = makeChain(137, 'Polygon');
    const chainList = {
      ...makeChainList([chain], {contractAddress: unknown, decimals: 6, logo: 'https://cdn.example/usdt.png', name: 'USDT0', symbol: 'USDT'}),
      getTokenByAddress: (_chainId: number, address: `0x${string}`) => {
        throw new Error(`Unknown token ${address}`);
      },
    };

    const assets = flatBalancesToAssets(chainList, [
      {
        amount: '12.34',
        chainID: 137,
        decimals: 6,
        logo: 'https://cdn.example/usdt.png',
        name: 'USDT0',
        symbol: 'USDT',
        tokenAddress: unknown,
        value: 12.34,
      },
    ]);

    expect(assets).toEqual([
      expect.objectContaining({
        name: 'USDT',
        symbol: 'USDT',
        decimals: 6,
        balance: '12.34',
        value: '12.34',
        logo: 'https://cdn.example/usdt.png',
        chainBalances: [
          expect.objectContaining({
            contractAddress: unknown,
            decimals: 6,
            balance: '12.34',
            symbol: 'USDT',
            chain: expect.objectContaining({ id: 137, name: 'Polygon' }),
          }),
        ],
      }),
    ]);
  });
});
