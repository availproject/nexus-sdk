import { describe, expect, it, vi } from 'vitest';
import type { Hex } from 'viem';

const readContract = vi.hoisted(() => vi.fn().mockResolvedValue(0n));

vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem');
  return {
    ...actual,
    createPublicClient: vi.fn().mockReturnValue({ readContract }),
    http: vi.fn().mockReturnValue({}),
  };
});

import { buildExecuteTxs, createExecuteTxContext } from '../../src/execute/runtime';
import { packERC20Approve } from '../../src/services/evm';
import { ARB_CHAIN, WETH, makeSwapChainList } from '../helpers/swap';

const TARGET = '0x1111111111111111111111111111111111111111' as Hex;
const SPENDER = '0x2222222222222222222222222222222222222222' as Hex;

describe('buildExecuteTxs', () => {
  it('keeps the speculative approval when the current allowance is insufficient', async () => {
    const chainList = makeSwapChainList();
    const token = chainList.getTokenByAddress(ARB_CHAIN, WETH)!;

    const result = await createExecuteTxContext({
      chainList,
      ownerAddress: TARGET,
      toChainId: ARB_CHAIN,
      to: TARGET,
      tokenApproval: { token, amount: 1000n, spender: SPENDER },
    });

    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: 'allowance',
        args: [TARGET, SPENDER],
      })
    );
    expect(result.approvalTx?.data).toBe(packERC20Approve(SPENDER, 1000n));
    expect(result.approvalContext).toEqual({
      token,
      spender: SPENDER,
      amount: 1000n,
    });
  });

  it('drops the speculative approval when the current allowance is sufficient', async () => {
    readContract.mockResolvedValueOnce(1000n);
    const chainList = makeSwapChainList();
    const token = chainList.getTokenByAddress(ARB_CHAIN, WETH)!;

    const result = await createExecuteTxContext({
      chainList,
      ownerAddress: TARGET,
      toChainId: ARB_CHAIN,
      to: TARGET,
      tokenApproval: { token, amount: 1000n, spender: SPENDER },
    });

    expect(result.approvalTx).toBeNull();
    expect(result.approvalContext).toBeNull();
  });

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
