import { expect } from 'vitest';
import { ERROR_CODES, NexusError } from '../../src/domain/errors';

export const expectInvalidInput = async (fn: () => unknown | Promise<unknown>) => {
  try {
    await fn();
  } catch (error) {
    expect(error).toBeInstanceOf(NexusError);
    expect((error as NexusError).code).toBe(ERROR_CODES.INVALID_INPUT);
    return;
  }
  throw new Error('Expected invalid input error');
};
