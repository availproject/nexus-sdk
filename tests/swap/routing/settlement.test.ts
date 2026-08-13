import { describe, expect, it, vi } from 'vitest';
import type { ChainListType } from '../../../src/domain';
import { CurrencyID } from '../../../src/swap/cot';
import { selectStableSettlement } from '../../../src/swap/routing/settlement';
import {
  ARB_CHAIN,
  BASE_CHAIN,
  OP_CHAIN,
  USDC_ARB,
  USDC_BASE,
  USDT_ARB,
  USDT_BASE,
  USDT_OP,
  WETH,
  makeSwapChainListWithUsdtCot,
} from '../../helpers/swap';

describe('selectStableSettlement', () => {
  it('selects the family with the fewest source and destination swap legs', () => {
    expect(
      selectStableSettlement({
        chainList: makeSwapChainListWithUsdtCot(),
        currentCurrencyId: CurrencyID.USDC,
        destinationChainId: BASE_CHAIN,
        destinationTokenAddress: USDC_BASE,
        scoreHoldings: [
          { chainID: ARB_CHAIN, tokenAddress: USDT_ARB },
          { chainID: OP_CHAIN, tokenAddress: USDT_OP },
          { chainID: BASE_CHAIN, tokenAddress: USDT_BASE },
          { chainID: ARB_CHAIN, tokenAddress: USDC_ARB },
        ],
      })
    ).toBe(CurrencyID.USDT);
  });

  it('retains the current family on equal scores', () => {
    expect(
      selectStableSettlement({
        chainList: makeSwapChainListWithUsdtCot(),
        currentCurrencyId: CurrencyID.USDC,
        destinationChainId: BASE_CHAIN,
        destinationTokenAddress: WETH,
        scoreHoldings: [
          { chainID: ARB_CHAIN, tokenAddress: USDC_ARB },
          { chainID: ARB_CHAIN, tokenAddress: USDT_ARB },
        ],
      })
    ).toBe(CurrencyID.USDC);
  });

  it('rejects a candidate missing from any eligible source chain outside the scored prefix', () => {
    const chainList = makeSwapChainListWithUsdtCot();
    const getTokenByCurrencyId = chainList.getTokenByCurrencyId.bind(chainList);
    chainList.getTokenByCurrencyId = vi.fn((chainId: number, currencyId: number) => {
      if (chainId === OP_CHAIN && currencyId === CurrencyID.USDT) {
        throw new Error('USDT unavailable');
      }
      return getTokenByCurrencyId(chainId, currencyId);
    }) as ChainListType['getTokenByCurrencyId'];

    expect(
      selectStableSettlement({
        chainList,
        currentCurrencyId: CurrencyID.USDC,
        destinationChainId: BASE_CHAIN,
        destinationTokenAddress: USDT_BASE,
        scoreHoldings: [{ chainID: ARB_CHAIN, tokenAddress: USDT_ARB }],
        eligibilityHoldings: [
          { chainID: ARB_CHAIN, tokenAddress: USDT_ARB },
          { chainID: OP_CHAIN, tokenAddress: USDT_OP },
        ],
      })
    ).toBe(CurrencyID.USDC);
  });
});
