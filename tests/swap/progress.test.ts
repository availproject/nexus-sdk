import { describe, expect, it } from 'vitest';
import type { Hex } from 'viem';
import type { SwapEvent, SwapPlan } from '../../src/domain';
import { createSwapProgressEmitter } from '../../src/swap/progress';

const STEP_ID =
  'allowance:source:10:0x0000000000000000000000000000000000000001';

const makePlan = (method: 'approval' | 'permit'): SwapPlan => ({
  hasBridge: false,
  hasDestinationSwap: false,
  steps: [
    {
      type: 'allowance',
      id: STEP_ID,
      method,
      chain: { id: 10, name: 'Optimism', logo: '' },
      token: {
        contractAddress: '0x0000000000000000000000000000000000000001',
        symbol: 'USDC',
        decimals: 6,
      },
      spender: '0x0000000000000000000000000000000000000002',
      amount: {
        contractAddress: '0x0000000000000000000000000000000000000001',
        symbol: 'USDC',
        decimals: 6,
        amount: '1',
        amountRaw: 1_000_000n,
      },
    },
  ],
});

describe('createSwapProgressEmitter', () => {
  it('maps EOA approval updates onto the matching allowance plan step', () => {
    const events: SwapEvent[] = [];
    const emitter = createSwapProgressEmitter((event) => events.push(event));
    emitter.emitPlanConfirmed(makePlan('approval'));

    emitter.emitExecutionProgress({
      stepType: 'allowance',
      stepId: STEP_ID,
      chainId: 10,
      state: 'wallet_prompted',
    });
    emitter.emitExecutionProgress({
      stepType: 'allowance',
      stepId: STEP_ID,
      chainId: 10,
      state: 'submitted',
      txHash: '0xapproval' as Hex,
      explorerUrl: 'https://explorer.example/tx/0xapproval',
    });

    expect(events.slice(1)).toEqual([
      expect.objectContaining({
        type: 'plan_progress',
        stepType: 'allowance',
        state: 'wallet_prompted',
        step: expect.objectContaining({ id: STEP_ID, method: 'approval' }),
      }),
      expect.objectContaining({
        type: 'plan_progress',
        stepType: 'allowance',
        state: 'submitted',
        txHash: '0xapproval',
        step: expect.objectContaining({ id: STEP_ID }),
      }),
    ]);
  });

  it('maps a signed permit onto the matching allowance plan step', () => {
    const events: SwapEvent[] = [];
    const emitter = createSwapProgressEmitter((event) => events.push(event));
    emitter.emitPlanConfirmed(makePlan('permit'));

    emitter.emitExecutionProgress({
      stepType: 'allowance',
      stepId: STEP_ID,
      chainId: 10,
      state: 'signed',
    });

    expect(events[1]).toMatchObject({
      type: 'plan_progress',
      stepType: 'allowance',
      state: 'signed',
      step: { id: STEP_ID, method: 'permit' },
    });
  });
});
