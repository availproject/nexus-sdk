import { describe, expect, it } from 'vitest';
import type { Hex } from 'viem';
import {
  createAllowanceApprovalStepId,
  createBridgeFillStepId,
  createExecuteApprovalStepId,
  createExecuteTransactionStepId,
  createRequestSigningStepId,
  createRequestSubmissionStepId,
  createVaultDepositStepId,
} from '../../src/services/step-ids';

describe('step ids', () => {
  it('builds deterministic bridge and execute step ids', () => {
    expect(createAllowanceApprovalStepId(11155111, '0xABCDEF' as Hex)).toBe(
      'allowance_approval:11155111:0xabcdef'
    );
    expect(createRequestSigningStepId()).toBe('request_signing');
    expect(createRequestSubmissionStepId()).toBe('request_submission');
    expect(createVaultDepositStepId(11155111, '0xABCDEF' as Hex)).toBe(
      'vault_deposit:11155111:0xabcdef'
    );
    expect(createBridgeFillStepId(421614)).toBe('bridge_fill:421614');
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
