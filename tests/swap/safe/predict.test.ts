import { describe, expect, it } from 'vitest';
import { predictSafeAccountAddress } from '../../../src/swap/safe/predict';
import { SAFE_PROXY_FACTORY_ADDRESS } from '../../../src/swap/safe/constants';

describe('predictSafeAccountAddress', () => {
  it('matches the cross-repo golden vector for owner 0x1111…', () => {
    const result = predictSafeAccountAddress('0x1111111111111111111111111111111111111111');
    expect(result.address).toBe('0x9eAc574979eCC3B7944C9cECFc8804ad72AE5cf9');
    expect(result.factoryAddress).toBe(SAFE_PROXY_FACTORY_ADDRESS);
  });

  it('returns a non-empty initializer (setup() calldata)', () => {
    const result = predictSafeAccountAddress('0x1111111111111111111111111111111111111111');
    expect(result.initializer.startsWith('0x')).toBe(true);
    expect(result.initializer.length).toBeGreaterThan(2);
  });

  it('produces deterministic addresses (same owner → same address)', () => {
    const owner = '0xabcdef0123456789abcdef0123456789abcdef01' as const;
    const a = predictSafeAccountAddress(owner);
    const b = predictSafeAccountAddress(owner);
    expect(a.address).toBe(b.address);
  });

  it('produces distinct addresses for distinct owners', () => {
    const a = predictSafeAccountAddress('0x1111111111111111111111111111111111111111');
    const b = predictSafeAccountAddress('0x2222222222222222222222222222222222222222');
    expect(a.address).not.toBe(b.address);
  });
});
