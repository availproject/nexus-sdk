import { describe, expect, it, vi } from 'vitest';
import { resolveCOT, resolveSwapSettlement } from '../../src/swap/cot';
import type { ChainListType, TokenInfo } from '../../src/domain';
import { CurrencyID } from '../../src/swap/cot';
import { SwapMode } from '../../src/swap/types';
import { EADDRESS } from '../../src/swap/constants';
import {
  ARB_CHAIN,
  BASE_CHAIN,
  OP_CHAIN,
  DAI,
  USDC_ARB,
  USDC_BASE,
  USDT_ARB,
  USDT_BASE,
  USDT_OP,
  makeSwapChainList,
} from '../helpers/swap';

const makeChainList = (overrides?: {
  getTokenByCurrencyId?: ChainListType['getTokenByCurrencyId'];
}): ChainListType => ({
  chains: [],
  getVaultContractAddress: vi.fn(),
  getTokenInfoBySymbol: vi.fn(),
  getChainAndTokenFromSymbol: vi.fn() as any,
  getTokenByAddress: vi.fn(),
  getChainAndTokenByAddress: vi.fn(),
  getNativeToken: vi.fn(),
  getChainByID: vi.fn() as any,
  getTokenByCurrencyId: overrides?.getTokenByCurrencyId ?? vi.fn().mockImplementation(() => {
    throw new Error('token not found');
  }),
});

describe('resolveCOT', () => {
  it('resolves COT from chainList when currencyId matches a token', () => {
    const token: TokenInfo = {
      contractAddress: '0xNewUSDC00000000000000000000000000000000',
      decimals: 6,
      logo: '',
      name: 'USDC',
      symbol: 'USDC',
      permitVariant: 2,
      permitVersion: 1,
      currencyId: 1,
    };
    const chainList = makeChainList({
      getTokenByCurrencyId: vi.fn().mockReturnValue(token),
    });

    const result = resolveCOT(1, chainList, 1);

    expect(result.address).toBe('0xNewUSDC00000000000000000000000000000000');
    expect(result.decimals).toBe(6);
    expect(result.permitVariant).toBe(2);
    expect(result.permitVersion).toBe(1);
    expect(result.currencyId).toBe(1);
  });

  it('throws when the requested currencyId token is missing from chainList', () => {
    const chainList = makeChainList();

    expect(() => resolveCOT(1, chainList, CurrencyID.USDC)).toThrow(
      /No COT with currencyId=1 on chain 1/
    );
  });

  it('defaults currencyId to USDC when not provided', () => {
    const token: TokenInfo = {
      contractAddress: '0xNewUSDC00000000000000000000000000000000',
      decimals: 6,
      logo: '',
      name: 'USDC',
      symbol: 'USDC',
      permitVariant: 2,
      permitVersion: 1,
      currencyId: CurrencyID.USDC,
    };
    const chainList = makeChainList({
      getTokenByCurrencyId: vi.fn().mockReturnValue(token),
    });

    const result = resolveCOT(1, chainList);

    expect(result.currencyId).toBe(CurrencyID.USDC);
    expect(result.address).toBe(token.contractAddress);
  });

  it('throws when currencyId is not 1 and chainList has no match', () => {
    const chainList = makeChainList();

    expect(() => resolveCOT(1, chainList, 99)).toThrow(/No COT with currencyId=99/);
  });

  it('throws for non-default currencyId when chainList has no match', () => {
    const chainList = makeChainList();

    expect(() => resolveCOT(1, chainList, 3)).toThrow(/No COT with currencyId=3/);
  });

  it('returns numeric permitVariant from chainList token metadata', () => {
    const token: TokenInfo = {
      contractAddress: '0xNewUSDC00000000000000000000000000000000',
      decimals: 6,
      logo: '',
      name: 'USDC',
      symbol: 'USDC',
      permitVariant: 2,
      permitVersion: 1,
      currencyId: CurrencyID.USDC,
    };
    const chainList = makeChainList({
      getTokenByCurrencyId: vi.fn().mockReturnValue(token),
    });

    const result = resolveCOT(1, chainList, CurrencyID.USDC);

    expect(typeof result.permitVariant).toBe('number');
  });
});

describe('resolveSwapSettlement', () => {
  const chainList = makeSwapChainList();
  const cot = CurrencyID.USDC;

  it('EXACT_IN all-same-family non-COT token → bridges that token directly', () => {
    expect(
      resolveSwapSettlement(
        chainList,
        SwapMode.EXACT_IN,
        [
          { chainId: ARB_CHAIN, tokenAddress: USDT_ARB },
          { chainId: OP_CHAIN, tokenAddress: USDT_OP },
        ],
        BASE_CHAIN,
        USDT_BASE,
        cot
      )
    ).toEqual({ currencyId: CurrencyID.USDT, sameTokenBridge: true });
  });

  it('EXACT_IN mixed families → falls back to the COT', () => {
    expect(
      resolveSwapSettlement(
        chainList,
        SwapMode.EXACT_IN,
        [
          { chainId: ARB_CHAIN, tokenAddress: USDT_ARB },
          { chainId: ARB_CHAIN, tokenAddress: DAI },
        ],
        BASE_CHAIN,
        USDT_BASE,
        cot
      )
    ).toEqual({ currencyId: CurrencyID.USDC, sameTokenBridge: false });
  });

  it('EXACT_IN destination IS the COT → COT, no same-token bridge', () => {
    expect(
      resolveSwapSettlement(
        chainList,
        SwapMode.EXACT_IN,
        [{ chainId: ARB_CHAIN, tokenAddress: USDC_ARB }],
        BASE_CHAIN,
        USDC_BASE,
        cot
      )
    ).toEqual({ currencyId: CurrencyID.USDC, sameTokenBridge: false });
  });

  it('EXACT_OUT never takes the same-token bridge even when all sources match', () => {
    expect(
      resolveSwapSettlement(
        chainList,
        SwapMode.EXACT_OUT,
        [{ chainId: ARB_CHAIN, tokenAddress: USDT_ARB }],
        BASE_CHAIN,
        USDT_BASE,
        cot
      )
    ).toEqual({ currencyId: CurrencyID.USDC, sameTokenBridge: false });
  });

  it('EXACT_IN with no sources → COT (families unknown up front)', () => {
    expect(
      resolveSwapSettlement(chainList, SwapMode.EXACT_IN, [], BASE_CHAIN, USDT_BASE, cot)
    ).toEqual({ currencyId: CurrencyID.USDC, sameTokenBridge: false });
  });

  it('EXACT_IN all-native same family (ETH→ETH) → bridges native directly', () => {
    expect(
      resolveSwapSettlement(
        chainList,
        SwapMode.EXACT_IN,
        [
          { chainId: ARB_CHAIN, tokenAddress: EADDRESS },
          { chainId: OP_CHAIN, tokenAddress: EADDRESS },
        ],
        BASE_CHAIN,
        EADDRESS,
        cot
      )
    ).toEqual({ currencyId: CurrencyID.ETH, sameTokenBridge: true });
  });
});
