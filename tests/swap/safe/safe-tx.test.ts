import { describe, expect, it } from 'vitest';
import type { Address, Hex } from 'viem';
import { hashTypedData, recoverTypedDataAddress, zeroAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  type SafeTxFields,
  buildDefaultSafeTxFields,
  hashSafeTx,
  safeDomain,
  safeTxTypes,
  signSafeTx,
} from '../../../src/swap/safe/safe-tx';

const owner = privateKeyToAccount(
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
);
const safe: Address = '0x9eAc574979eCC3B7944C9cECFc8804ad72AE5cf9';
const target: Address = '0xabcdef0123456789abcdef0123456789abcdef01';

const baseFields: SafeTxFields = {
  to: target,
  value: 0n,
  data: '0xdeadbeef',
  operation: 0,
  safeTxGas: 0n,
  baseGas: 0n,
  gasPrice: 0n,
  gasToken: zeroAddress,
  refundReceiver: zeroAddress,
  nonce: 0n,
};

describe('hashSafeTx', () => {
  it('matches viem.hashTypedData with the same domain + types + message', () => {
    const ours = hashSafeTx({ chainId: 1, safeAddress: safe, fields: baseFields });
    const theirs = hashTypedData({
      domain: safeDomain(1, safe),
      types: safeTxTypes,
      primaryType: 'SafeTx',
      message: baseFields,
    });
    expect(ours).toBe(theirs);
  });

  it('uses the minimal Safe domain (only chainId + verifyingContract)', () => {
    const d = safeDomain(42, safe);
    expect(d.chainId).toBe(42n);
    expect(d.verifyingContract).toBe(safe);
    expect('name' in d).toBe(false);
    expect('version' in d).toBe(false);
  });
});

describe('signSafeTx', () => {
  it('produces a signature that recovers to the owner', async () => {
    const signature = await signSafeTx({
      account: owner,
      chainId: 1,
      safeAddress: safe,
      fields: baseFields,
    });
    expect(signature.length).toBe(132);
    const recovered = await recoverTypedDataAddress({
      domain: safeDomain(1, safe),
      types: safeTxTypes,
      primaryType: 'SafeTx',
      message: baseFields,
      signature,
    });
    expect(recovered.toLowerCase()).toBe(owner.address.toLowerCase());
  });
});

describe('buildDefaultSafeTxFields', () => {
  it('zeros refund-related fields by default', () => {
    const fields = buildDefaultSafeTxFields({
      to: target,
      value: 0n,
      data: '0xcafe' as Hex,
      operation: 0,
      nonce: 5n,
    });
    expect(fields.safeTxGas).toBe(0n);
    expect(fields.baseGas).toBe(0n);
    expect(fields.gasPrice).toBe(0n);
    expect(fields.gasToken).toBe(zeroAddress);
    expect(fields.refundReceiver).toBe(zeroAddress);
    expect(fields.nonce).toBe(5n);
  });
});
