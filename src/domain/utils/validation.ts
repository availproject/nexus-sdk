import { type Hex, isAddress, isHex } from 'viem';
import { z } from 'zod';
import { Errors } from '../errors';

export const hexString = z.custom<Hex>((value) => isHex(value), {
  message: 'invalid hex',
});

export const addressString = z.custom<`0x${string}`>(
  (value) => typeof value === 'string' && isAddress(value, { strict: false }),
  {
    message: 'invalid address',
  }
);

export const nonNegativeBigint = z.bigint().refine((value) => value >= 0n, {
  message: 'must be >= 0',
});

export const positiveInt = z.number().int().positive();
export const nonNegativeInt = z.number().int().nonnegative();

export const parseInput = <T>(schema: z.ZodType<T>, input: unknown): T => {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    const prefix = issue?.path.length ? `${issue.path.join('.')}: ` : '';
    throw Errors.invalidInput(`${prefix}${issue?.message ?? 'invalid input'}`);
  }
  return result.data;
};
