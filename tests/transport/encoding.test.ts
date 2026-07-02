import { toBytes } from 'viem';
import { describe, expect, it } from 'vitest';
import { parseHexToTokenBytes } from '../../src/transport/encoding';

describe('parseHexToTokenBytes', () => {
  it('left pads 20-byte addresses to 32 bytes', () => {
    const address = '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582';
    const bytes = parseHexToTokenBytes(address);
    const raw = toBytes(address);

    expect(bytes).toHaveLength(32);
    expect(bytes.slice(0, 12)).toEqual(new Uint8Array(12));
    expect(bytes.slice(12)).toEqual(raw);
  });
});
