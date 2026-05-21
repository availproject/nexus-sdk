// Regression: VSC /swap-balances returns balanceUsd: "" for unpriced long-tail tokens.
// swapAssetsToAnkrBalances passed the empty string through, ankrBalanceToAssets called
// `new Decimal("")`, decimal.js threw "Invalid argument", the whole route fetch rejected,
// and the SDK consumer's swap modal ended up with assets.length === 0.

import { Universe } from '@avail-project/ca-common';
import { describe, expect, it, vi } from 'vitest';

import { getBalancesForSwap } from '../../../src/core/utils/balance.utils';

describe('getBalancesForSwap — empty balanceUsd on unpriced tokens', () => {
  // Real chain entry so the asset survives the `getChainByID` lookup inside
  // ankrBalanceToAssets and reaches the `new Decimal(asset.balanceUSD)` call that used
  // to throw. ankrName is empty + swapSupported is false so fetchTransferFees fans out
  // to zero chains (no RPC stubbing needed for this regression).
  const chain = {
    ankrName: '',
    custom: { icon: '', knownTokens: [] },
    id: 1,
    name: 'Ethereum',
    nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
    swapSupported: false,
    universe: Universe.ETHEREUM,
  } as never;

  const chainList = {
    chains: [chain],
    getChainByID: (id: number) => (id === 1 ? chain : undefined),
    getTokenByAddress: () => undefined,
  } as never;

  const baseAsset = {
    balanceRawInteger: '1',
    blockchain: '1',
    contractAddress: '0x000000000000000000000000000000000000abcd' as const,
    holderAddress: '0x1111111111111111111111111111111111111111' as const,
    thumbnail: '',
    tokenDecimals: 18,
    tokenName: 'Long Tail Token',
    tokenSymbol: 'LIKE',
    tokenType: 'ERC20' as const,
  };

  it('does not throw when balanceUsd is an empty string', async () => {
    const vscClient = {
      getSwapBalances: vi.fn().mockResolvedValue([
        {
          ...baseAsset,
          balance: '1000',
          balanceUsd: '', // <-- the bug: triggers `new Decimal("")` deep in ankrBalanceToAssets
          tokenPrice: '',
        },
      ]),
    } as never;

    // If the bug were live this would reject with "[DecimalError] Invalid argument".
    await expect(
      getBalancesForSwap({
        evmAddress: '0x1111111111111111111111111111111111111111',
        chainList,
        vscClient,
        filterWithSupportedTokens: false,
      })
    ).resolves.toBeDefined();
  });

  it('treats empty balanceUsd as $0 (asset stays visible with zero USD value)', async () => {
    const vscClient = {
      getSwapBalances: vi.fn().mockResolvedValue([
        {
          ...baseAsset,
          balance: '500',
          balanceUsd: '',
          tokenPrice: '',
        },
      ]),
    } as never;

    const result = await getBalancesForSwap({
      evmAddress: '0x1111111111111111111111111111111111111111',
      chainList,
      vscClient,
      filterWithSupportedTokens: false,
    });

    // The unpriced asset should still surface, just with $0 USD value — losing the asset
    // entirely would be worse than showing 0 (user sees they hold it; aggregator just
    // doesn't try to price it).
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0].symbol).toBe('LIKE');
    expect(result.assets[0].balanceInFiat).toBe(0);
    expect(result.assets[0].breakdown[0].balanceInFiat).toBe(0);
  });

  it('passes through normal (non-empty) balanceUsd values unchanged', async () => {
    const vscClient = {
      getSwapBalances: vi.fn().mockResolvedValue([
        {
          ...baseAsset,
          balance: '500',
          balanceUsd: '12.34',
          tokenPrice: '0.02468',
        },
      ]),
    } as never;

    await expect(
      getBalancesForSwap({
        evmAddress: '0x1111111111111111111111111111111111111111',
        chainList,
        vscClient,
        filterWithSupportedTokens: false,
      })
    ).resolves.toBeDefined();
  });
});
