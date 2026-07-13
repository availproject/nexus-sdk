import { describe, expect, it } from 'vitest';
import type { Hex } from 'viem';
import { BackendError } from '../../src/domain/errors';
import { requireSuccessfulSbcResult } from '../../src/services/sbc';
import type { SBCResult } from '../../src/swap/types';

const ADDR = '0x0000000000000000000000000000000000000001' as Hex;

describe('requireSuccessfulSbcResult', () => {
  it('returns the txHash for a successful result', () => {
    const results: SBCResult[] = [{ chainId: 1, address: ADDR, errored: false, txHash: '0xabc' }];
    expect(requireSuccessfulSbcResult(results, 1, 'ctx')).toBe('0xabc');
  });

  it('throws BackendError(backend/sbc_submit_failed) carrying the middleware envelope', () => {
    const results: SBCResult[] = [
      {
        chainId: 1,
        address: ADDR,
        errored: true,
        message: 'SBC internal call failed: TRANSFER_FROM_FAILED',
        code: 'TRANSACTION_REVERTED',
        subcode: 'TRANSFER_FROM_FAILED',
        errorId: 'err-1',
        details: { source: 'inner-call' },
      },
    ];

    const err = (() => {
      try {
        requireSuccessfulSbcResult(results, 1, 'Swap SBC');
        return undefined;
      } catch (e) {
        return e;
      }
    })();

    expect(err).toBeInstanceOf(BackendError);
    const backend = err as BackendError;
    expect(backend.code).toBe('backend/sbc_submit_failed');
    expect(backend.context.service).toBe('middleware');
    expect(backend.context.chainId).toBe(1);
    expect(backend.details).toMatchObject({
      middlewareCode: 'TRANSACTION_REVERTED',
      middlewareSubcode: 'TRANSFER_FROM_FAILED',
      errorId: 'err-1',
      middlewareDetails: { source: 'inner-call' },
    });
  });
});
