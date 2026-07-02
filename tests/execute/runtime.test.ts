import { describe, expect, it } from 'vitest';
import type { Hex } from 'viem';
import { buildExecuteTxs } from '../../src/execute/runtime';
import { packERC20Approve } from '../../src/services/evm';
import { ARB_CHAIN, WETH, makeSwapChainList } from '../helpers/swap';

const TARGET = '0x1111111111111111111111111111111111111111' as Hex;
const SPENDER = '0x2222222222222222222222222222222222222222' as Hex;

describe('buildExecuteTxs', () => {
  it('builds a speculative approval tx and an allowance check when a token approval is set', () => {
    const result = buildExecuteTxs({
      chainList: makeSwapChainList(),
      toChainId: ARB_CHAIN,
      to: TARGET,
      value: 0n,
      data: '0xfeed' as Hex,
      tokenApproval: { tokenAddress: WETH, amount: 1000n, spender: SPENDER },
    });

    // Speculative: the approval tx is built without consulting the on-chain allowance.
    expect(result.speculativeApprovalTx).not.toBeNull();
    expect(result.speculativeApprovalTx!.to).toBe(WETH);
    expect(result.speculativeApprovalTx!.data).toBe(packERC20Approve(SPENDER, 1000n));
    expect(result.speculativeApprovalTx!.value).toBe(0n);
    expect(result.allowanceCheck).toEqual({
      tokenAddress: WETH,
      spender: SPENDER,
      requiredAllowance: 1000n,
    });
    expect(result.tx.to).toBe(TARGET);
    expect(result.tx.data).toBe('0xfeed');
  });

  it('returns no speculative approval or allowance check when no token approval is requested', () => {
    const result = buildExecuteTxs({
      chainList: makeSwapChainList(),
      toChainId: ARB_CHAIN,
      to: TARGET,
    });

    expect(result.speculativeApprovalTx).toBeNull();
    expect(result.allowanceCheck).toBeNull();
    expect(result.tx.to).toBe(TARGET);
  });
});
