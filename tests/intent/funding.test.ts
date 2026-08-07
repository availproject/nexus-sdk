import { describe, expect, it } from 'vitest';
import { calculateIntentFunding } from '../../src/intent/funding';

describe('composite Better Intent funding', () => {
  it('funds only the non-native token and native gas shortfalls', () => {
    expect(
      calculateIntentFunding({
        outputIsNative: false,
        outputAmountRaw: 100n,
        outputBalanceRaw: 40n,
        executeValueRaw: 10n,
        estimatedGasCostRaw: 20n,
        nativeBalanceRaw: 5n,
      })
    ).toEqual({ outputAmountRaw: 60n, gasDropRaw: 25n });
  });

  it('uses one raw output unit when only a gas drop is needed', () => {
    expect(
      calculateIntentFunding({
        outputIsNative: false,
        outputAmountRaw: 100n,
        outputBalanceRaw: 100n,
        executeValueRaw: 0n,
        estimatedGasCostRaw: 20n,
        nativeBalanceRaw: 0n,
      })
    ).toEqual({ outputAmountRaw: 1n, gasDropRaw: 20n });
  });

  it('combines native output, execute value, and gas before applying the balance', () => {
    expect(
      calculateIntentFunding({
        outputIsNative: true,
        outputAmountRaw: 100n,
        outputBalanceRaw: 0n,
        executeValueRaw: 30n,
        estimatedGasCostRaw: 20n,
        nativeBalanceRaw: 40n,
      })
    ).toEqual({ outputAmountRaw: 110n, gasDropRaw: 0n });
  });

  it('skips intent funding when destination balances cover everything', () => {
    expect(
      calculateIntentFunding({
        outputIsNative: false,
        outputAmountRaw: 100n,
        outputBalanceRaw: 120n,
        executeValueRaw: 10n,
        estimatedGasCostRaw: 20n,
        nativeBalanceRaw: 30n,
      })
    ).toEqual({ outputAmountRaw: 0n, gasDropRaw: 0n });
  });
});
