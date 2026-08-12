import { describe, expect, it } from 'vitest';
import { encodeFunctionData, erc20Abi, type Hex } from 'viem';
import { buildRefundSweepCall } from '../../src/services/init-refund-sweep';
import { EADDRESS } from '../../src/swap/constants';

const USDC = '0xaf88d065e77c8cc2239327c5edb3a432268e5831' as Hex;
const EOA = '0x1111111111111111111111111111111111111111' as Hex;

describe('buildRefundSweepCall', () => {
  it('builds an ERC20 transfer(EOA, amount) call with value 0', () => {
    const call = buildRefundSweepCall(USDC, 1_000_000n, EOA);
    expect(call.to).toBe(USDC);
    expect(call.value).toBe(0n);
    expect(call.data).toBe(
      encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [EOA, 1_000_000n] })
    );
  });

  it('builds a native value-send straight to the EOA with empty calldata', () => {
    const call = buildRefundSweepCall(EADDRESS, 5_000_000_000_000_000n, EOA);
    expect(call.to).toBe(EOA);
    expect(call.value).toBe(5_000_000_000_000_000n);
    expect(call.data).toBe('0x');
  });
});
