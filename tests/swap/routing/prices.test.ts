import Decimal from 'decimal.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Hex } from 'viem';
import { ZERO_ADDRESS } from '../../../src/domain/constants/addresses';
import { EADDRESS } from '../../../src/swap/constants';
import { createTokenPriceResolver } from '../../../src/swap/routing/prices';
import type { FlatBalance, OraclePriceResponse } from '../../../src/swap/types';
import { ARB_CHAIN, USDC_ARB, WETH } from '../../helpers/swap';

const TOKEN = '0x1111111111111111111111111111111111111111' as Hex;
const CITREA_CHAIN = 4114;

const makeInputs = (overrides?: {
  balances?: FlatBalance[];
  oraclePrices?: OraclePriceResponse;
  middlewareClient?: Record<string, unknown>;
}) => ({
  balances: overrides?.balances ?? [],
  oraclePrices: overrides?.oraclePrices ?? ([] as OraclePriceResponse),
  middlewareClient: {
    getLiFiTokenPrice: vi.fn().mockResolvedValue(null),
    getRelayTokenPrice: vi.fn().mockResolvedValue(null),
    ...overrides?.middlewareClient,
  } as never,
});

describe('createTokenPriceResolver', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses a chain-scoped oracle price without calling external providers', async () => {
    const getLiFiTokenPrice = vi.fn();
    const resolver = createTokenPriceResolver(
      makeInputs({
        oraclePrices: [
          {
            universe: 'EVM',
            chainId: ARB_CHAIN,
            tokenAddress: WETH,
            tokenSymbol: 'WETH',
            tokenDecimals: 18,
            priceUsd: new Decimal('2500'),
            timestamp: 1,
          },
        ],
        middlewareClient: { getLiFiTokenPrice },
      })
    );

    await expect(resolver.resolve(ARB_CHAIN, WETH)).resolves.toMatchObject({
      priceUsd: new Decimal('2500'),
      source: 'oracle',
    });
    expect(getLiFiTokenPrice).not.toHaveBeenCalled();
  });

  it('derives price from balance value before calling external providers', async () => {
    const getLiFiTokenPrice = vi.fn();
    const resolver = createTokenPriceResolver(
      makeInputs({
        balances: [
          {
            amount: '2',
            chainID: ARB_CHAIN,
            decimals: 18,
            logo: '',
            name: 'Token',
            symbol: 'TKN',
            tokenAddress: TOKEN,
            value: 7,
          },
        ],
        middlewareClient: { getLiFiTokenPrice },
      })
    );

    const price = await resolver.resolve(ARB_CHAIN, TOKEN);
    expect(price?.source).toBe('balance');
    expect(price?.priceUsd.eq('3.5')).toBe(true);
    expect(getLiFiTokenPrice).not.toHaveBeenCalled();
  });

  it('starts LiFi and Relay together and caches the keyed promise', async () => {
    let releaseLiFi: ((value: string) => void) | undefined;
    const getLiFiTokenPrice = vi.fn(
      () => new Promise<string>((resolve) => (releaseLiFi = resolve))
    );
    const getRelayTokenPrice = vi.fn().mockResolvedValue('2499.5');
    const resolver = createTokenPriceResolver(
      makeInputs({ middlewareClient: { getLiFiTokenPrice, getRelayTokenPrice } })
    );

    const first = resolver.resolve(ARB_CHAIN, TOKEN);
    const second = resolver.resolve(ARB_CHAIN, TOKEN);

    expect(second).toBe(first);
    await expect(first).resolves.toMatchObject({ source: 'relay' });
    expect(getLiFiTokenPrice).toHaveBeenCalledTimes(1);
    expect(getRelayTokenPrice).toHaveBeenCalledTimes(1);
    releaseLiFi?.('2500');
  });

  it('fetches Fibrous pricing directly on Citrea and normalizes native to the zero address', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ price: '64936.72' }),
    });
    vi.stubGlobal('fetch', fetch);
    const getLiFiTokenPrice = vi.fn();
    const getRelayTokenPrice = vi.fn();
    const resolver = createTokenPriceResolver(
      makeInputs({
        middlewareClient: {
          getLiFiTokenPrice,
          getRelayTokenPrice,
        },
      })
    );

    const price = await resolver.resolve(CITREA_CHAIN, EADDRESS);

    expect(price?.source).toBe('fibrous');
    expect(price?.priceUsd.eq('64936.72')).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      `https://graph.fibrous.finance/citrea/tokens/${ZERO_ADDRESS}`
    );
    expect(getLiFiTokenPrice).not.toHaveBeenCalled();
    expect(getRelayTokenPrice).not.toHaveBeenCalled();
  });

  it('normalizes native to the zero address for Relay while preserving LiFi native form', async () => {
    const getLiFiTokenPrice = vi.fn().mockResolvedValue(null);
    const getRelayTokenPrice = vi.fn().mockResolvedValue('2500');
    const resolver = createTokenPriceResolver(
      makeInputs({ middlewareClient: { getLiFiTokenPrice, getRelayTokenPrice } })
    );

    await resolver.resolve(ARB_CHAIN, EADDRESS);

    expect(getLiFiTokenPrice).toHaveBeenCalledWith(ARB_CHAIN, EADDRESS);
    expect(getRelayTokenPrice).toHaveBeenCalledWith(ARB_CHAIN, ZERO_ADDRESS);
  });

  it('does not reuse a price across chains', async () => {
    const getLiFiTokenPrice = vi
      .fn()
      .mockResolvedValueOnce('1')
      .mockResolvedValueOnce('2');
    const resolver = createTokenPriceResolver(
      makeInputs({ middlewareClient: { getLiFiTokenPrice } })
    );

    const [arb, base] = await Promise.all([
      resolver.resolve(ARB_CHAIN, USDC_ARB),
      resolver.resolve(8453, USDC_ARB),
    ]);

    expect(arb?.priceUsd.eq(1)).toBe(true);
    expect(base?.priceUsd.eq(2)).toBe(true);
    expect(getLiFiTokenPrice).toHaveBeenCalledTimes(2);
  });
});
