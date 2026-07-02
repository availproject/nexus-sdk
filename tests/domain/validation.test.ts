import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  addressString,
  hexString,
  nonNegativeBigint,
  parseInput,
} from '../../src/domain/utils/validation';
import { expectInvalidInput } from '../helpers/expect-invalid-input';

describe('validation helpers', () => {
  it('accepts valid hex and rejects invalid hex', async () => {
    const value = parseInput(hexString, '0x1234');
    expect(value).toBe('0x1234');
    await expectInvalidInput(() => parseInput(hexString, '1234'));
  });

  it('accepts valid addresses and rejects invalid addresses', async () => {
    const address = parseInput(addressString, '0x0000000000000000000000000000000000000001');
    expect(address).toBe('0x0000000000000000000000000000000000000001');
    await expectInvalidInput(() => parseInput(addressString, '0x1234'));
  });

  it('rejects negative bigint values', async () => {
    const schema = z.object({ amount: nonNegativeBigint });
    await expectInvalidInput(() => parseInput(schema, { amount: -1n }));
  });
});
