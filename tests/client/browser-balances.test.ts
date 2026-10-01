import { expect, it } from 'vitest';
import type { IntentBalance } from '../../src';
import { groupBalances } from '../../example/browser/src/lib/nexus';

it('preserves verification per holding when balances with the same symbol are grouped', () => {
  const balances: IntentBalance[] = [true, false].map((verified, index) => ({
    chainId: index + 1,
    tokenAddress: '0x0000000000000000000000000000000000000001',
    name: 'USD Coin', symbol: 'USDC', decimals: 6, isNative: false, verified,
    providers: [{ id: 'relay' }], balanceRaw: 1_000_000n, valueUsd: 1,
    priceSource: 'relay', usable: true,
  }));
  const client = { getSupportedChains: () => [] } as unknown as Parameters<typeof groupBalances>[0];
  const assets = groupBalances(client, balances);
  expect(assets).toHaveLength(1);
  expect(assets[0]).toMatchObject({ balance: '2', value: '2' });
  expect(assets[0]!.chainBalances).toMatchObject([
    { chain: { id: 1 }, verified: true },
    { chain: { id: 2 }, verified: false },
  ]);
});
