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
      extras: { aggregators: [], assetsUsed: [], balances: [], oraclePrices: {} },
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
});
