import { describe, expect, it } from 'vitest';
import type {
  SwapExactInParams,
  SwapExactOutParams,
  SwapAndExecuteParams,
  SwapMaxParams,
} from '../../src/swap/types';

describe('swap type renames', () => {
  it('SwapExactInParams accepts new field names', () => {
    const input: SwapExactInParams = {
      sources: [{ chainId: 1, tokenAddress: '0x01', amountRaw: 100n }],
      toChainId: 42161,
      toTokenAddress: '0x02',
    };
    expect(input.sources).toHaveLength(1);
  });

  it('SwapExactOutParams accepts new field names', () => {
    const input: SwapExactOutParams = {
      toChainId: 42161,
      toTokenAddress: '0x02',
      toAmountRaw: 1000000n,
      sources: [{ chainId: 1, tokenAddress: '0x01' }],
    };
    expect(input.toAmountRaw).toBe(1000000n);
  });

  it('SwapAndExecuteParams accepts new field names', () => {
    const input: SwapAndExecuteParams = {
      toChainId: 42161,
      toTokenAddress: '0x02',
      toAmountRaw: 1000000n,
      execute: { to: '0x03', gas: 100000n },
    };
    expect(input.toAmountRaw).toBe(1000000n);
  });

  it('SwapMaxParams accepts new field names', () => {
    const input: SwapMaxParams = {
      toChainId: 42161,
      toTokenAddress: '0x02',
      sources: [{ chainId: 1, tokenAddress: '0x01' }],
    };
    expect(input.sources).toHaveLength(1);
  });
});
