import { describe, expect, it, vi } from 'vitest';
import Decimal from 'decimal.js';
import type { Hex } from 'viem';
import {
  classifyFastPath,
  greedyUsdPrefix,
  selectRoughEligibleSources,
} from '../../src/swap/route';
import { CurrencyID } from '../../src/swap/cot';
import { EADDRESS } from '../../src/swap/constants';
import { SwapMode } from '../../src/swap/types';
import type { ChainListType } from '../../src/domain';
import {
  ARB_CHAIN,
  BASE_CHAIN,
  OP_CHAIN,
  USDC_ARB,
  USDC_BASE,
  USDC_OP,
  USDT_ARB,
  USDT_BASE,
  USDT_OP,
  WETH,
  makeSwapChainList,
  makeSwapChainListWithUsdtCot as makeChainListWithUsdtCot,
} from '../helpers/swap';

type Member = { chainID: number; tokenAddress: Hex };

const classify = (over: {
  chainList?: ChainListType;
  members: Member[];
  dstTokenAddress: Hex;
  needsTokenSwap: boolean;
  hasGasRequest?: boolean;
  toAmountRaw?: bigint;
  mode?: SwapMode;
  cotCurrencyId?: number;
}) =>
  classifyFastPath({
    chainList: over.chainList ?? makeSwapChainList(),
    members: over.members,
    dstChainId: BASE_CHAIN,
    dstTokenAddress: over.dstTokenAddress,
    cotCurrencyId: over.cotCurrencyId ?? CurrencyID.USDC,
    needsTokenSwap: over.needsTokenSwap,
    hasGasRequest: over.hasGasRequest ?? false,
    toAmountRaw: over.toAmountRaw ?? 1_000_000n,
    mode: over.mode ?? SwapMode.EXACT_OUT,
  });

describe('classifyFastPath', () => {
  it('A (direct): all members on the destination chain + a token swap is needed', () => {
    expect(
      classify({
        members: [
          { chainID: BASE_CHAIN, tokenAddress: WETH },
          { chainID: BASE_CHAIN, tokenAddress: USDC_BASE },
        ],
        dstTokenAddress: WETH,
        needsTokenSwap: true,
      })
    ).toEqual({ kind: 'direct' });
  });

  it('A does not fire when a member is off the destination chain (falls to family checks)', () => {
    // Cross-chain WETH→WETH: WETH is non-mesh → no family → null (default COT flow).
    expect(
      classify({
        members: [
          { chainID: BASE_CHAIN, tokenAddress: WETH },
          { chainID: ARB_CHAIN, tokenAddress: WETH },
        ],
        dstTokenAddress: WETH,
        needsTokenSwap: true,
      })
    ).toBeNull();
  });

  it('A does not fire when toToken IS the COT (needsTokenSwap false) — the no-bridge COT-dst path owns it', () => {
    expect(
      classify({
        members: [{ chainID: BASE_CHAIN, tokenAddress: USDC_BASE }],
        dstTokenAddress: USDC_BASE,
        needsTokenSwap: false,
      })
    ).toBeNull();
  });

  it('B1 (same-token-out): EXACT_OUT, uniform non-COT family == destination family, no gas', () => {
    expect(
      classify({
        members: [
          { chainID: ARB_CHAIN, tokenAddress: USDT_ARB },
          { chainID: OP_CHAIN, tokenAddress: USDT_OP },
        ],
        dstTokenAddress: USDT_BASE,
        needsTokenSwap: true,
        mode: SwapMode.EXACT_OUT,
      })
    ).toEqual({ kind: 'same-token-out', familyId: CurrencyID.USDT });
  });

  it('B1 is disqualified by a gas request → falls back to the default flow (null)', () => {
    expect(
      classify({
        members: [
          { chainID: ARB_CHAIN, tokenAddress: USDT_ARB },
          { chainID: OP_CHAIN, tokenAddress: USDT_OP },
        ],
        dstTokenAddress: USDT_BASE,
        needsTokenSwap: true,
        hasGasRequest: true,
        mode: SwapMode.EXACT_OUT,
      })
    ).toBeNull();
  });

  it('B1 does not fire on EXACT_IN (that is the existing buildSameTokenBridgeRoute path)', () => {
    // Same-family but EXACT_IN: the classifier leaves it to the EXACT_IN same-token dispatch.
    expect(
      classify({
        members: [{ chainID: ARB_CHAIN, tokenAddress: USDT_ARB }],
        dstTokenAddress: USDT_BASE,
        needsTokenSwap: true,
        mode: SwapMode.EXACT_IN,
      })
    ).toBeNull();
  });

  it('B2 (dynamic-cot): uniform stable family distinct from dst family + COT, resolving on the dst chain', () => {
    expect(
      classify({
        chainList: makeChainListWithUsdtCot(),
        members: [
          { chainID: ARB_CHAIN, tokenAddress: USDT_ARB },
          { chainID: OP_CHAIN, tokenAddress: USDT_OP },
        ],
        dstTokenAddress: WETH, // non-mesh destination
        needsTokenSwap: true,
        mode: SwapMode.EXACT_IN,
      })
    ).toEqual({ kind: 'dynamic-cot', familyId: CurrencyID.USDT });
  });

  it('B2 does not fire when all members are already on the dst chain (no bridge to optimize)', () => {
    // USDT@Base → USDC@Base: same-chain, toToken IS the COT so A/B1 skip. B2 would settle in USDT but
    // saves nothing (a USDT→USDC swap is one hop either way) — the "some member off-chain" guard drops it.
    expect(
      classify({
        chainList: makeChainListWithUsdtCot(),
        members: [{ chainID: BASE_CHAIN, tokenAddress: USDT_BASE }],
        dstTokenAddress: USDC_BASE, // == COT → needsTokenSwap false
        needsTokenSwap: false,
        mode: SwapMode.EXACT_IN,
      })
    ).toBeNull();
  });

  it('B2 does not fire when the family COT cannot be resolved on the destination chain', () => {
    // Default chainList: USDT has no getTokenByCurrencyId entry → resolveCOT throws → null.
    expect(
      classify({
        members: [
          { chainID: ARB_CHAIN, tokenAddress: USDT_ARB },
          { chainID: OP_CHAIN, tokenAddress: USDT_OP },
        ],
        dstTokenAddress: WETH,
        needsTokenSwap: true,
        mode: SwapMode.EXACT_IN,
      })
    ).toBeNull();
  });

  it('B2 excludes ETH — a native (ETH family) source to a non-mesh destination is null', () => {
    expect(
      classify({
        chainList: makeChainListWithUsdtCot(),
        members: [
          { chainID: ARB_CHAIN, tokenAddress: EADDRESS as Hex },
          { chainID: OP_CHAIN, tokenAddress: EADDRESS as Hex },
        ],
        dstTokenAddress: WETH,
        needsTokenSwap: true,
        mode: SwapMode.EXACT_IN,
      })
    ).toBeNull();
  });

  it('B2 is a no-op when the family IS the COT (USDC everywhere → today’s default flow)', () => {
    expect(
      classify({
        members: [
          { chainID: ARB_CHAIN, tokenAddress: USDC_ARB },
          { chainID: OP_CHAIN, tokenAddress: USDC_OP },
        ],
        dstTokenAddress: WETH,
        needsTokenSwap: true,
        mode: SwapMode.EXACT_IN,
      })
    ).toBeNull();
  });

  it('strict-ALL: a mixed-family member set disqualifies every family path (null)', () => {
    expect(
      classify({
        chainList: makeChainListWithUsdtCot(),
        members: [
          { chainID: ARB_CHAIN, tokenAddress: USDT_ARB },
          { chainID: OP_CHAIN, tokenAddress: USDC_OP },
        ],
        dstTokenAddress: WETH,
        needsTokenSwap: true,
        mode: SwapMode.EXACT_IN,
      })
    ).toBeNull();
  });

  it('a non-mesh source (WETH) to a non-mesh destination is null', () => {
    expect(
      classify({
        members: [{ chainID: ARB_CHAIN, tokenAddress: WETH }],
        dstTokenAddress: WETH,
        needsTokenSwap: true,
        mode: SwapMode.EXACT_IN,
      })
    ).toBeNull();
  });
});

describe('RES — greedyUsdPrefix / selectRoughEligibleSources', () => {
  const holdings = [
    { chainID: BASE_CHAIN, tokenAddress: USDC_BASE, value: 5 },
    { chainID: ARB_CHAIN, tokenAddress: USDC_ARB, value: 5 },
    { chainID: OP_CHAIN, tokenAddress: USDC_OP, value: 5 },
  ];

  it('greedyUsdPrefix returns the leading prefix that first reaches the target, including the tipping member', () => {
    // target 8 → add 5 (<8), add 5 (=10 ≥ 8, but the check runs BEFORE the 3rd) → prefix = first two.
    expect(greedyUsdPrefix(holdings, new Decimal(8))).toEqual([holdings[0], holdings[1]]);
  });

  it('greedyUsdPrefix returns everything when the target exceeds total value', () => {
    expect(greedyUsdPrefix(holdings, new Decimal(999))).toEqual(holdings);
  });

  it('selectRoughEligibleSources KEEPS dst-chain members and applies the headroom to the target', () => {
    // dstUsd 9 × (1 + 0.01) = 9.09 → 5 (<9.09), 10 (≥9.09) → first two, and the BASE (dst) member stays.
    const res = selectRoughEligibleSources(holdings, new Decimal(9));
    expect(res).toEqual([holdings[0], holdings[1]]);
    expect(res.some((h) => h.chainID === BASE_CHAIN)).toBe(true);
  });
});
