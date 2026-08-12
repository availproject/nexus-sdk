import { keccak256, type Hex, zeroAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { SAFE_OPERATION_CALL } from '../../../src/swap/safe/constants';
import { buildMultiSendPayload } from '../../../src/swap/safe/multi-send';
import {
  buildDefaultSafeTxFields,
  encodeSafeExecTransactionV2,
  hashSafeTx,
  normalizeSafeSignature,
} from '../../../src/swap/safe/safe-tx';
import { SAFE_V2_GOLDEN } from '../../fixtures/safe-v2-golden';

const fields = buildDefaultSafeTxFields({
  to: SAFE_V2_GOLDEN.singleTransaction.to,
  value: SAFE_V2_GOLDEN.singleTransaction.value,
  data: SAFE_V2_GOLDEN.singleTransaction.data,
  operation: SAFE_OPERATION_CALL,
  nonce: SAFE_V2_GOLDEN.singleTransaction.nonce,
});

describe('Safe v2 Protocol Kit 8.0.4 transaction golden vector', () => {
  it('hashes the same Safe transaction', () => {
    expect(
      hashSafeTx({
        chainId: SAFE_V2_GOLDEN.singleTransaction.chainId,
        safeAddress: SAFE_V2_GOLDEN.safeAddress,
        fields,
      })
    ).toBe(SAFE_V2_GOLDEN.singleTransaction.digest);
  });

  it('packs the same MultiSendCallOnly payload', () => {
    const payload = buildMultiSendPayload([...SAFE_V2_GOLDEN.multiSend.calls]);

    expect(payload).toBe(SAFE_V2_GOLDEN.multiSend.data);
    expect(keccak256(payload)).toBe(SAFE_V2_GOLDEN.multiSend.dataHash);
  });

  it('normalizes recovery ids into Safe ECDSA signatures', () => {
    const compactV = `${SAFE_V2_GOLDEN.singleTransaction.dummySignature.slice(0, -2)}00` as Hex;
    expect(normalizeSafeSignature(compactV)).toBe(
      `${SAFE_V2_GOLDEN.singleTransaction.dummySignature.slice(0, -2)}1b`
    );
    expect(normalizeSafeSignature(SAFE_V2_GOLDEN.singleTransaction.dummySignature)).toBe(
      SAFE_V2_GOLDEN.singleTransaction.dummySignature
    );
  });

  it('encodes execTransaction and appends attribution to the outer calldata', () => {
    expect(fields.gasToken).toBe(zeroAddress);
    const execData = encodeSafeExecTransactionV2(
      fields,
      SAFE_V2_GOLDEN.singleTransaction.dummySignature
    );

    expect(execData).toBe(SAFE_V2_GOLDEN.singleTransaction.execData);
    expect(keccak256(execData)).toBe(SAFE_V2_GOLDEN.singleTransaction.execDataHash);
  });
});
