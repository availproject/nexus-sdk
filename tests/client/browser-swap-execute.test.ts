import { expect, it, vi } from 'vitest';
import type { SwapAndExecuteHookData } from '../../src';
import { EXACT_IN_SWAP_TAB, SWAP_AND_EXECUTE_TAB } from '../../example/browser/src/lib/tabs';
import { getDepositTokenOptions } from '../../example/browser/src/lib/deposit';
import { mapStatusToPhase } from '../../example/browser/src/hooks/useExecutionProgress';
import type { ExecuteContext } from '../../example/browser/src/lib/types';

type NexusClient = ExecuteContext['client'];

const ACCOUNT = '0x00000000000000000000000000000000000000aa' as const;
const setup = () => {
  let completed = new Set<string>();
  const swapAndExecute = vi.fn<NexusClient['swapAndExecute']>();
  const ctx = {
    client: { swapAndExecute, getSupportedChains: () => [] } as unknown as NexusClient,
    address: ACCOUNT, chainId: 8453, tokenSymbol: 'USDC',
    tokenAddress: getDepositTokenOptions(8453).find((token) => token.symbol === 'USDC')!.tokenAddress,
    amount: '1', sourceOptions: [], selectedSources: [],
    onSwapIntent: vi.fn(), onSwapExecIntent: vi.fn(),
    setCompletedSteps: (update) => { completed = typeof update === 'function' ? update(completed) : update; },
    setStatusMessage: vi.fn(), handleProgressEvent: vi.fn(),
  } satisfies ExecuteContext;
  return { ctx, swapAndExecute, completed: () => completed };
};

it('requests an exact-input quote with catalog decimals and no connected address', async () => {
  const { ctx } = setup();
  const source = {
    id: '1:usdc', chainId: 1, chainName: 'Ethereum', chainLogo: '',
    tokenAddress: ACCOUNT, symbol: 'USDC', decimals: 6, balance: '0', value: '0',
  };
  const review = new Error('quote reached review');
  const swapWithExactIn = vi.fn().mockRejectedValue(review);
  const client = {
    swapWithExactIn,
    getToken: async () => ({ address: ctx.tokenAddress, decimals: 18 }),
  } as unknown as NexusClient;
  await expect(EXACT_IN_SWAP_TAB.execute({
    ...ctx, client, address: undefined, sourceOptions: [source],
    selectedSources: [source.id], sourceAmounts: { [source.id]: '1.234567' },
  })).rejects.toBe(review);
  expect(swapWithExactIn).toHaveBeenCalledExactlyOnceWith({
    toChainId: ctx.chainId, toTokenAddress: ctx.tokenAddress,
    sources: [{ chainId: 1, tokenAddress: ACCOUNT, amountRaw: 1234567n }],
  }, expect.objectContaining({ hooks: { onIntent: ctx.onSwapIntent } }));
});

it('uses the composite hook and completes a fully funded deposit after execution returns', async () => {
  const { ctx, swapAndExecute, completed } = setup();
  const zero = { amountRaw: 0n, amount: '0' };
  const data: SwapAndExecuteHookData = {
    allow: vi.fn(), deny: vi.fn(), refresh: vi.fn(),
    intent: {
      swapRequired: false,
      executeRequirement: {
        chain: { id: 8453, name: 'Base' }, to: ACCOUNT,
        token: { address: ctx.tokenAddress!, symbol: 'USDC', decimals: 6, amountRaw: 1_000_000n, amount: '1' },
        gas: { ...zero, address: ACCOUNT, symbol: 'ETH', decimals: 18,
          estimatedGasUnits: 420_000n, approvalGasUnits: 0n, l1FeeRaw: 0n, priceTier: 'medium',
          feeParams: { type: 'eip1559', maxFeePerGas: 100n, maxPriorityFeePerGas: 1n } },
        tokenApproval: null, nativeValue: null,
      },
      available: { token: { amountRaw: 1_000_000n, amount: '1' }, gas: zero },
      shortfall: { token: zero, gas: zero },
    },
  };
  swapAndExecute.mockImplementation(async (params, options) => {
    expect(params.execute.gas).toBeGreaterThan(0n);
    await options?.hooks?.onIntent?.(data);
    expect(ctx.onSwapExecIntent).toHaveBeenCalledExactlyOnceWith(data);
    await options?.beforeExecute?.();
    expect(ctx.handleProgressEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'step', state: 'started', step: expect.objectContaining({ type: 'execute_transaction' }),
    }));
    expect(completed().has('TRANSACTION_CONFIRMED')).toBe(false);
    return { swapSkipped: true, execute: { txHash: '0x1234', txExplorerUrl: 'https://explorer.test/tx/0x1234' } };
  });

  const result = await SWAP_AND_EXECUTE_TAB.execute(ctx);
  expect(completed().has('TRANSACTION_CONFIRMED')).toBe(true);
  expect(ctx.handleProgressEvent).toHaveBeenLastCalledWith({ type: 'status', status: 'completed' });
  expect(ctx.handleProgressEvent).toHaveBeenCalledWith(expect.objectContaining({
    type: 'step', state: 'completed', step: expect.objectContaining({ type: 'execute_transaction' }),
    txHash: '0x1234', explorerUrl: 'https://explorer.test/tx/0x1234',
  }));
  expect(result.hashes).toContainEqual({ label: 'Deposit tx', value: '0x1234', href: 'https://explorer.test/tx/0x1234' });
});

it('keeps execution incomplete after a funding intent is fulfilled', async () => {
  const { ctx, swapAndExecute, completed } = setup();
  swapAndExecute.mockImplementation(async (_params, options) => {
    options?.onEvent?.({ type: 'status', status: 'fulfilled', substatus: 'completed', intentId: '0x1234', legs: [] });
    expect(completed().has('SWAP_COMPLETE')).toBe(true);
    expect(completed().has('TRANSACTION_CONFIRMED')).toBe(false);
    throw new Error('destination execution failed');
  });
  await expect(SWAP_AND_EXECUTE_TAB.execute(ctx)).rejects.toThrow('destination execution failed');
  expect(ctx.handleProgressEvent).not.toHaveBeenCalledWith({ type: 'status', status: 'completed' });
});

it('distinguishes funding fulfillment from composite execution completion', () => {
  expect(mapStatusToPhase('fulfilled', 'swap')).toBe('completed');
  expect(mapStatusToPhase('fulfilled', 'swapAndExecute')).toBe('executing');
  expect(mapStatusToPhase('completed', 'swapAndExecute')).toBe('completed');
});
