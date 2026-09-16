import { parseUnits } from 'viem';
import { describe, expect, it } from 'vitest';
import { ZERO_ADDRESS } from '../../src/domain/constants/addresses';
import {
  validateSwapAndExecute,
  validateSwapExactIn,
  validateSwapExactOut,
  validateSwapMax,
} from '../../src/flows/swap-params';

const arcUsdc = '0x3600000000000000000000000000000000000000' as const;
const destination = { toChainId: 5042, toTokenAddress: arcUsdc } as const;

describe('Arc USDC destination normalization', () => {
  it('normalizes Exact In and max destinations without changing source addresses', () => {
    const input = { ...destination, sources: [{ chainId: 5042, tokenAddress: arcUsdc }] };
    for (const validate of [validateSwapExactIn, validateSwapMax]) {
      expect(validate(input)).toEqual({ ...input, toTokenAddress: ZERO_ADDRESS });
    }
    expect(input.toTokenAddress).toBe(arcUsdc);
    expect(input.sources[0].tokenAddress).toBe(arcUsdc);
  });

  it('preserves Exact Out token quantities when converting six-decimal inputs to native units', () => {
    const input = {
      ...destination,
      toAmountRaw: parseUnits('12.345678', 6),
      toNativeAmountRaw: parseUnits('0.1', 18),
    };
    expect(validateSwapExactOut(input)).toEqual({
      ...input,
      toTokenAddress: ZERO_ADDRESS,
      toAmountRaw: parseUnits('12.345678', 18),
    });
  });

  it('normalizes composite funding while preserving the contract execution and approval', () => {
    const execute = {
      to: '0x0000000000000000000000000000000000000001' as const,
      gas: 100_000n,
      tokenApproval: {
        toTokenAddress: arcUsdc,
        amount: parseUnits('12.345678', 6),
        spender: '0x0000000000000000000000000000000000000001' as const,
      },
    };
    expect(
      validateSwapAndExecute({ ...destination, toAmountRaw: parseUnits('12.345678', 6), execute })
    ).toEqual({
      ...destination,
      toTokenAddress: ZERO_ADDRESS,
      toAmountRaw: parseUnits('12.345678', 18),
      execute,
    });
  });

  it('leaves explicit native inputs and other chains unchanged', () => {
    for (const input of [
      { ...destination, toTokenAddress: ZERO_ADDRESS, toAmountRaw: parseUnits('10', 18) },
      { ...destination, toChainId: 8453, toAmountRaw: parseUnits('10', 6) },
    ]) {
      expect(validateSwapExactOut(input)).toEqual(input);
    }
  });
});
