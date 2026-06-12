import Decimal from 'decimal.js';
import type { Hex } from 'viem';
import { describe, expect, it, vi } from 'vitest';
import { SwapMode } from '../../src/commons';
import { ZERO_ADDRESS } from '../../src/core/constants';
import { createSwapIntent } from '../../src/swap/intent';

describe('createSwapIntent', () => {
  it('falls back to zero gas value when a gas quote has no USD output value', () => {
    const chainList = {
      getChainByID: vi.fn(() => ({
        custom: { icon: '' },
        id: 999,
        name: 'HyperEVM',
        nativeCurrency: { decimals: 18, symbol: 'ETH' },
      })),
    };

    const route = {
      type: 'EXACT_IN',
      source: { creationTime: 1, executions: {}, swaps: [] },
      bridge: null,
      destination: {
        chainId: 999,
        eoaToDestinationAccount: null,
        execution: {
          address: '0x1111111111111111111111111111111111111111',
          entryPoint: null,
          mode: 'safe_account',
        },
        getDstSwap: vi.fn(async () => null),
        inputAmount: { max: new Decimal(1), min: new Decimal(1) },
        swap: {
          creationTime: 1,
          tokenSwap: null,
          gasSwap: {
            quote: {
              output: {
                amount: '0.0001',
                amountRaw: 100_000_000_000_000n,
                contractAddress: ZERO_ADDRESS,
                decimals: 18,
                symbol: 'ETH',
              },
            },
          },
        },
      },
      buffer: { amount: '0' },
      dstTokenInfo: {
        contractAddress: '0xcccccccccccccccccccccccccccccccccccccccc' as Hex,
        decimals: 6,
        symbol: 'USDC',
      },
      extras: { aggregators: [], assetsUsed: [], balances: [], oraclePrices: [] },
    } as never;

    const intent = createSwapIntent(
      route,
      {
        mode: SwapMode.EXACT_IN,
        data: {
          from: [
            {
              amount: 1_000_000n,
              chainId: 999,
              tokenAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Hex,
            },
          ],
          toChainId: 999,
          toTokenAddress: '0xcccccccccccccccccccccccccccccccccccccccc' as Hex,
        },
      },
      chainList as never
    );

    expect(intent.destination.gas.amount).toBe('0.0001');
    expect(intent.destination.gas.value).toBe('0');
  });

  it('uses oracle price for destination USD value when there is no dst swap (non-COT dst)', async () => {
    // Regression for the same-token bridge path (USDT→USDT, ETH→ETH): no dst swap means
    // there's no aggregator-quoted USD value. The previous fallback assumed `dstAmount ≈
    // dstValue`, which is only true when dst token IS COT (USDC, ~$1). For ETH at $3000,
    // that fallback would show 1 ETH as $1 — wildly wrong.
    const NATIVE_ETH: Hex = '0x0000000000000000000000000000000000000000';
    const chainList = {
      getChainByID: vi.fn(() => ({
        custom: { icon: '' },
        id: 10,
        name: 'Optimism',
        nativeCurrency: { decimals: 18, symbol: 'ETH' },
      })),
    };

    const route = {
      type: 'EXACT_IN',
      source: { creationTime: 1, executions: {}, swaps: [] },
      bridge: {
        amount: new Decimal(1),
        assets: [],
        chainID: 10,
        decimals: 18,
        recipientAddress: '0xaaaa000000000000000000000000000000000000',
        tokenAddress: NATIVE_ETH,
        estimatedFees: { caGas: '0', solver: '0', protocol: '0', gasSupplied: '0' },
      },
      destination: {
        chainId: 10,
        eoaToDestinationAccount: null,
        execution: {
          address: '0xaaaa000000000000000000000000000000000000',
          entryPoint: null,
          mode: 'direct_eoa',
        },
        getDstSwap: vi.fn(async () => null),
        inputAmount: { max: new Decimal(1), min: new Decimal(1) },
        swap: { creationTime: 1, tokenSwap: null, gasSwap: null },
      },
      buffer: { amount: '0' },
      dstTokenInfo: { contractAddress: NATIVE_ETH, decimals: 18, symbol: 'ETH' },
      extras: {
        aggregators: [],
        assetsUsed: [],
        balances: [],
        oraclePrices: [
          {
            chainId: 10,
            tokenAddress: NATIVE_ETH,
            priceUsd: new Decimal(3000),
            tokensPerUsd: new Decimal(1).div(3000),
          },
        ],
      },
    } as never;

    const intent = createSwapIntent(
      route,
      {
        mode: SwapMode.EXACT_IN,
        data: {
          from: [{ amount: 1_000_000_000_000_000_000n, chainId: 42161, tokenAddress: NATIVE_ETH }],
          toChainId: 10,
          toTokenAddress: NATIVE_ETH,
        },
      },
      chainList as never
    );

    // 1 ETH × $3000/ETH = $3000 (NOT $1 from the dstAmount-as-USD fallback)
    expect(intent.destination.amount).toBe('1');
    expect(intent.destination.value).toBe('3000');
  });
});
