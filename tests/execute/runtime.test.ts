import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Hex } from 'viem';

const readContract = vi.hoisted(() => vi.fn().mockResolvedValue(0n));

vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem');
  return {
    ...actual,
    createPublicClient: vi.fn().mockReturnValue({
      readContract,
      estimateGas: vi.fn().mockResolvedValue(21_000n),
      estimateFeesPerGas: vi.fn().mockResolvedValue({ gasPrice: 1n }),
    }),
    http: vi.fn().mockReturnValue({}),
  };
});

import { buildExecuteTxs, createExecuteTxContext } from '../../src/execute/runtime';
import * as runtime from '../../src/execute/runtime';
import { execute, simulateExecute } from '../../src/execute/execute';
import { createChainList } from '../../src/services/chain-list';
import { packERC20Approve } from '../../src/services/evm';
import { testChains } from '../fixtures/chains';
import { ARB_CHAIN, WETH, makeSwapChainList } from '../helpers/swap';

const TARGET = '0x1111111111111111111111111111111111111111' as Hex;
const SPENDER = '0x2222222222222222222222222222222222222222' as Hex;

afterEach(() => vi.restoreAllMocks());

it.each([['execute', execute], ['simulateExecute', simulateExecute]] as const)('%s approves the requested contract when another token shares its symbol', async (_method, run) => {
  const chainList = createChainList(testChains);
  const selected = chainList.getTokenByAddress(1, testChains[0].tokens[1].address);
  chainList.getChainByID(1).custom.knownTokens.unshift({
    ...selected, contractAddress: SPENDER,
  });
  const send = vi.spyOn(runtime, 'sendExecuteTransactions').mockResolvedValue({
    txHash: '0x1234', receipt: undefined, approvalHash: undefined,
  });
  readContract.mockClear();

  await run({
    toChainId: 1, to: TARGET,
    tokenApproval: { toTokenAddress: selected.contractAddress, amount: 1000n, spender: SPENDER },
  }, {
    chainList, evm: { address: TARGET, walletClient: {} as never },
  });

  expect(readContract).toHaveBeenCalledWith(expect.objectContaining({
    address: selected.contractAddress, functionName: 'allowance', args: [TARGET, SPENDER],
  }));
  if (run === execute) {
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      approvalTx: expect.objectContaining({ to: selected.contractAddress, data: packERC20Approve(SPENDER, 1000n) }),
    }), expect.anything());
  }
});

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
