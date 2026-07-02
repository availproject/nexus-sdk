import { describe, expect, it } from 'vitest';
import type { Hex } from 'viem';
import { Universe } from '../../src/domain/chain-abstraction';
import { convertAddressByUniverse } from '../../src/services/addresses';

describe('convertAddressByUniverse', () => {
  it('normalizes padded EVM addresses to 20 bytes', () => {
    const normalized = `0x${'aa'.repeat(20)}` as Hex;
    const padded = `0x${'00'.repeat(12)}${'aa'.repeat(20)}` as Hex;

    expect(convertAddressByUniverse(padded, Universe.ETHEREUM)).toBe(normalized);
  });

  it('passes through 32-byte addresses for non-EVM universes', () => {
    const address = `0x${'11'.repeat(32)}` as Hex;

    expect(convertAddressByUniverse(address, Universe.SOLANA)).toBe(address);
  });

  it('passes through 32-byte addresses for unrecognized universes', () => {
    const address = `0x${'22'.repeat(32)}` as Hex;

    expect(convertAddressByUniverse(address, Universe.UNRECOGNIZED)).toBe(address);
  });

  it('reports non-EVM address length errors without the evm label', () => {
    expect(() =>
      convertAddressByUniverse(`0x${'33'.repeat(19)}` as Hex, Universe.SOLANA)
    ).toThrow(/solana/i);
  });
});
