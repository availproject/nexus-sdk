import { describe, expect, it } from 'vitest';
import type { Hex } from 'viem';
import {
  createExecuteApprovalStepId,
  createExecuteTransactionStepId,
} from '../../src/services/step-ids';

describe('step ids', () => {
  it('builds deterministic execute step ids', () => {
    expect(createExecuteApprovalStepId(421614, '0xABCDEF' as Hex)).toBe(
      'execute_approval:421614:0xabcdef'
    );
    expect(
      createExecuteTransactionStepId(
        421614,
        '0xABCD00000000000000000000000000000000EF12' as Hex
      )
    ).toBe('execute_transaction:421614:0xabcd00000000000000000000000000000000ef12');
  });
});
