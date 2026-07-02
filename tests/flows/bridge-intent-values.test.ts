import Decimal from 'decimal.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Hex } from 'viem';
import type { BridgeIntentDraft, OraclePriceResponse, TokenBalance } from '../../src/domain';
import { Universe } from '../../src/domain/chain-abstraction';
import { buildBridgeIntent } from '../../src/bridge/intent/builder';
import { makeChain, makeChainList } from '../helpers/chains';
import { makeMiddlewareClient } from '../helpers/middleware-client';

const getBalancesForBridge = vi.fn();

vi.mock('../../src/services/balances', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/balances')>(
    '../../src/services/balances'
  );
  return {
    ...actual,
    getBalancesForBridge: (...args: Parameters<typeof actual.getBalancesForBridge>) =>
      getBalancesForBridge(...args),
  };
});

const TOKEN_ADDRESS = '0x0000000000000000000000000000000000000001' as Hex;
const NATIVE_ADDRESS = '0x0000000000000000000000000000000000000000' as Hex;

const USDC_ASSET: TokenBalance = {
  balance: '15',
  value: '15.00',
  chainBalances: [
    {
      balance: '10',
      value: '10.00',
      chain: { id: 1, logo: '', name: 'Ethereum' },
      contractAddress: TOKEN_ADDRESS,
      decimals: 6,
      symbol: 'USDC',
      universe: Universe.ETHEREUM,
    },
    {
      balance: '5',
      value: '0.00',
      chain: { id: 10, logo: '', name: 'Optimism' },
      contractAddress: TOKEN_ADDRESS,
      decimals: 6,
      symbol: 'USDC',
      universe: Universe.ETHEREUM,
    },
  ],
  decimals: 6,
  logo: '',
  name: 'USDC',
  symbol: 'USDC',
};

const NATIVE_ASSET: TokenBalance = {
  balance: '1',
  value: '2500.00',
  chainBalances: [
    {
      balance: '1',
      value: '2500.00',
      chain: { id: 10, logo: '', name: 'Optimism' },
      contractAddress: NATIVE_ADDRESS,
      decimals: 18,
      symbol: 'ETH',
      universe: Universe.ETHEREUM,
    },
  ],
  decimals: 18,
  logo: '',
  name: 'ETH',
  symbol: 'ETH',
};

describe('buildBridgeIntent value resolver', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('prefers balance-derived USD values and falls back to oracle pricing even when nativeAmount is zero', async () => {
    getBalancesForBridge.mockResolvedValue([USDC_ASSET, NATIVE_ASSET]);

    const chain1 = makeChain(1, 'Ethereum');
    const chain2 = makeChain(10, 'Optimism');
    const token = {
      contractAddress: TOKEN_ADDRESS,
      decimals: 6,
      symbol: 'USDC',
      name: 'USD Coin',
      logo: '',
    };
    const chainList = makeChainList([chain1, chain2], token);
    const middlewareClient = makeMiddlewareClient({
      getOraclePrices: async () =>
        [
          {
            universe: 'EVM',
            chainId: 10,
            priceUsd: new Decimal(2),
            tokenAddress: TOKEN_ADDRESS,
            tokenSymbol: 'USDC',
            tokenDecimals: 6,
            timestamp: 1,
          },
        ] satisfies OraclePriceResponse,
    });

    let capturedInput:
      | Parameters<NonNullable<Parameters<typeof buildBridgeIntent>[0]['createIntent']>>[0]
      | undefined;

    await buildBridgeIntent({
      tokenAmount: 6_000_000n,
      dstToken: token,
      nativeAmount: 0n,
      dstChainId: chain2.id,
      dstChainUniverse: Universe.ETHEREUM,
      dstChainNativeDecimals: 18,
      deps: {
        chainList,
        middlewareClient,
        evm: {
          address: '0x0000000000000000000000000000000000000002',
        },
      },
      createIntent: async (input): Promise<BridgeIntentDraft> => {
        capturedInput = input;
        return {
          availableSources: [],
          selectedSources: [],
          destination: {
            amount: new Decimal('6'),
            amountRaw: 6_000_000n,
            value: new Decimal('0'),
            nativeAmount: new Decimal('0'),
            nativeAmountRaw: 0n,
            nativeAmountValue: new Decimal('0'),
            nativeAmountInToken: new Decimal('0'),
            nativeToken: {
              contractAddress: NATIVE_ADDRESS,
              decimals: 18,
              symbol: 'ETH',
              name: 'Ether',
              logo: '',
            },
            chain: { id: chain2.id, name: chain2.name, logo: chain2.custom.icon },
            token,
            universe: Universe.ETHEREUM,
          },
          fees: {
            caGas: '0',
            deposit: '0',
            fulfillment: '0',
            protocol: '0',
            solver: '0',
          },
          recipientAddress: '0x0000000000000000000000000000000000000002',
          provider: 'nexus',
        };
      },
    });

    expect(capturedInput).toBeDefined();
    expect(
      capturedInput?.resolveUsdValue({
        amount: new Decimal('3'),
        chainId: 1,
        tokenAddress: TOKEN_ADDRESS,
        symbol: 'USDC',
      }).toFixed(2)
    ).toBe('3.00');
    expect(
      capturedInput?.resolveUsdValue({
        amount: new Decimal('3'),
        chainId: 10,
        tokenAddress: TOKEN_ADDRESS,
        symbol: 'USDC',
      }).toFixed(2)
    ).toBe('6.00');
    expect(
      capturedInput?.resolveUsdValue({
        amount: new Decimal('1'),
        chainId: 999,
        tokenAddress: '0x9999999999999999999999999999999999999999',
        symbol: 'MISSING',
      }).toFixed(2)
    ).toBe('0.00');
  });
});
