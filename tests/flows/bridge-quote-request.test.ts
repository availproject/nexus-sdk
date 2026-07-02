import { describe, expect, it } from 'vitest';
import type { Chain, ChainListType, TokenInfo } from '../../src/domain';
import { Universe } from '../../src/domain/chain-abstraction';
import {
  assertMayanSupportedDestination,
  buildQuoteRequest,
  resolveBridgeProvider,
} from '../../src/bridge/intent/quote-request';
import { toHex } from 'viem';

const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as `0x${string}`;
const USDC_ARB = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as `0x${string}`;
const NATIVE = '0x0000000000000000000000000000000000000000' as `0x${string}`;

const makeChain = (id: number, name: string): Chain => ({
  id,
  name,
  universe: Universe.ETHEREUM,
  multicallAddress: '0x00000000000000000000000000000000000000aa',
  nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH', logo: '' },
  custom: { icon: '', knownTokens: [] },
  blockExplorers: { default: { name: 'explorer', url: 'https://example.com' } },
  rpcUrls: { default: { http: ['https://rpc.example.com'], webSocket: ['wss://rpc.example.com'] } },
});

const dstToken: TokenInfo = {
  contractAddress: USDC_ARB,
  decimals: 6,
  logo: '',
  name: 'USD Coin',
  symbol: 'USDC',
};

describe('buildQuoteRequest', () => {
  it('collects non-native equivalent tokens from all chains except destination', () => {
    const ethChain = makeChain(1, 'Ethereum');
    const arbChain = makeChain(42161, 'Arbitrum');
    const baseChain = makeChain(8453, 'Base');

    const chainList = {
      chains: [ethChain, arbChain, baseChain],
      getTokenInfoBySymbol: (chainId: number) => {
        if (chainId === 1) return { ...dstToken, contractAddress: USDC_ADDRESS };
        if (chainId === 8453) return { ...dstToken, contractAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' as `0x${string}` };
        throw new Error('not found');
      },
      getTokenByCurrencyId: () => {
        throw new Error('not found');
      },
    } as unknown as ChainListType;

    const result = buildQuoteRequest(chainList, dstToken, arbChain.id);

    expect(result.sources).toHaveLength(2);
    expect(result.sources[0]!.chain_id).toBe(toHex(1));
    expect(result.sources[0]!.contract_address).toBe(USDC_ADDRESS);
    expect(result.sources[1]!.chain_id).toBe(toHex(8453));
    expect(result.destination.chain_id).toBe(toHex(42161));
    expect(result.destination.contract_address).toBe(USDC_ARB);
  });

  it('skips chains where token is not available', () => {
    const ethChain = makeChain(1, 'Ethereum');
    const arbChain = makeChain(42161, 'Arbitrum');
    const solChain = makeChain(999, 'UnknownChain');

    const chainList = {
      chains: [ethChain, arbChain, solChain],
      getTokenInfoBySymbol: (chainId: number) => {
        if (chainId === 1) return { ...dstToken, contractAddress: USDC_ADDRESS };
        throw new Error('not found');
      },
      getTokenByCurrencyId: () => {
        throw new Error('not found');
      },
    } as unknown as ChainListType;

    const result = buildQuoteRequest(chainList, dstToken, arbChain.id);

    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]!.chain_id).toBe(toHex(1));
  });

  it('filters out native token sources', () => {
    const ethChain = makeChain(1, 'Ethereum');
    const arbChain = makeChain(42161, 'Arbitrum');

    const nativeToken: TokenInfo = {
      contractAddress: NATIVE,
      decimals: 18,
      logo: '',
      name: 'Ether',
      symbol: 'ETH',
    };

    const chainList = {
      chains: [ethChain, arbChain],
      getTokenInfoBySymbol: () => nativeToken,
      getTokenByCurrencyId: () => {
        throw new Error('not found');
      },
    } as unknown as ChainListType;

    const result = buildQuoteRequest(chainList, nativeToken, arbChain.id);

    // All sources are native, so sources array is empty
    // But request is still returned (for fulfillment fees)
    expect(result.sources).toHaveLength(0);
    expect(result.destination.chain_id).toBe(toHex(42161));
  });

  it('falls back to symbol when currencyId lookup fails on a chain', () => {
    const ethChain = makeChain(1, 'Ethereum');
    const arbChain = makeChain(42161, 'Arbitrum');

    const dstTokenWithCurrency: TokenInfo = {
      ...dstToken,
      currencyId: 1,
    };

    const chainList = {
      chains: [ethChain, arbChain],
      getTokenInfoBySymbol: (chainId: number) => {
        if (chainId === 1) return { ...dstToken, contractAddress: USDC_ADDRESS };
        throw new Error('not found');
      },
      getTokenByCurrencyId: () => {
        // currencyId lookup fails on all chains
        throw new Error('not found');
      },
    } as unknown as ChainListType;

    const result = buildQuoteRequest(chainList, dstTokenWithCurrency, arbChain.id);

    // Should fall back to symbol and find ETH chain
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]!.chain_id).toBe(toHex(1));
    expect(result.sources[0]!.contract_address).toBe(USDC_ADDRESS);
  });

  it('prefers currencyId over symbol when available', () => {
    const ethChain = makeChain(1, 'Ethereum');
    const arbChain = makeChain(42161, 'Arbitrum');

    const dstTokenWithCurrency: TokenInfo = {
      ...dstToken,
      currencyId: 1,
    };

    let usedCurrencyId = false;
    const chainList = {
      chains: [ethChain, arbChain],
      getTokenInfoBySymbol: () => {
        return { ...dstToken, contractAddress: USDC_ADDRESS };
      },
      getTokenByCurrencyId: (_chainId: number, currencyId: number) => {
        if (currencyId === 1) {
          usedCurrencyId = true;
          return { ...dstToken, contractAddress: USDC_ADDRESS };
        }
        throw new Error('not found');
      },
    } as unknown as ChainListType;

    buildQuoteRequest(chainList, dstTokenWithCurrency, arbChain.id);

    expect(usedCurrencyId).toBe(true);
  });
});

describe('resolveBridgeProvider', () => {
  const sampleRequest = {
    destination: {
      chain_id: toHex(42161),
      contract_address: USDC_ARB,
      amount: '1000000',
    },
  };

  it('returns mayan and skips the middleware call when forceMayan is true', async () => {
    let middlewareCalled = false;
    const middleware = {
      getBridgeProvider: async () => {
        middlewareCalled = true;
        return { provider: 'nexus' as const };
      },
    };

    const result = await resolveBridgeProvider(middleware, sampleRequest, true);

    expect(result).toBe('mayan');
    expect(middlewareCalled).toBe(false);
  });

  it('returns the middleware response provider when forceMayan is false', async () => {
    let receivedRequest: unknown = null;
    const middleware = {
      getBridgeProvider: async (req: typeof sampleRequest) => {
        receivedRequest = req;
        return { provider: 'nexus' as const };
      },
    };

    const result = await resolveBridgeProvider(middleware, sampleRequest, false);

    expect(result).toBe('nexus');
    expect(receivedRequest).toEqual(sampleRequest);
  });
});

describe('assertMayanSupportedDestination', () => {
  const baseChain = (overrides?: Partial<Chain & { mayanEnabled?: boolean }>): Chain =>
    ({
      ...makeChain(42161, 'Arbitrum'),
      mayanEnabled: true,
      ...overrides,
    }) as Chain & { mayanEnabled?: boolean };

  const baseToken = (overrides?: Partial<TokenInfo & { mayanEnabled?: boolean }>) =>
    ({
      ...dstToken,
      mayanEnabled: true,
      ...overrides,
    }) as TokenInfo & { mayanEnabled?: boolean };

  it('does not throw when chain and token both support mayan', () => {
    const chain = baseChain();
    const token = baseToken();
    const chainList = {
      getChainByID: () => chain,
      getTokenByAddress: () => token,
    } as unknown as ChainListType;

    expect(() => assertMayanSupportedDestination(chainList, 42161, dstToken.contractAddress)).not.toThrow();
  });

  it('throws when destination chain is not mayanEnabled', () => {
    const chain = baseChain({ mayanEnabled: false });
    const token = baseToken();
    const chainList = {
      getChainByID: () => chain,
      getTokenByAddress: () => token,
    } as unknown as ChainListType;

    expect(() => assertMayanSupportedDestination(chainList, 42161, dstToken.contractAddress)).toThrow(
      /chain 42161.*disabled for mayan/i
    );
  });

  it('throws when destination token is not mayanEnabled', () => {
    const chain = baseChain();
    const token = baseToken({ mayanEnabled: false });
    const chainList = {
      getChainByID: () => chain,
      getTokenByAddress: () => token,
    } as unknown as ChainListType;

    expect(() => assertMayanSupportedDestination(chainList, 42161, dstToken.contractAddress)).toThrow(
      /disabled for mayan/i
    );
  });
});
