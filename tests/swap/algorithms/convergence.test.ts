import { describe, expect, it } from 'vitest';
import { firstSuccess } from '../../../src/swap/algorithms/convergence';

const later = <T>(ms: number, value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));
const rejectLater = (ms: number): Promise<never> =>
  new Promise((_, reject) => setTimeout(() => reject(new Error('boom')), ms));

describe('firstSuccess', () => {
  it('resolves with the first candidate to settle non-null, regardless of array order', async () => {
    await expect(firstSuccess([later(50, 'slow'), Promise.resolve('fast')])).resolves.toBe('fast');
  });

  it('does not wait for a slow losing candidate', async () => {
    const start = Date.now();
    await firstSuccess([later(1000, 'slow'), Promise.resolve('fast')]);
    expect(Date.now() - start).toBeLessThan(500);
  });

  it('waits past an early null for a later non-null', async () => {
    await expect(firstSuccess([Promise.resolve(null), later(10, 'value')])).resolves.toBe('value');
  });

  it('resolves null when every candidate settles null', async () => {
    await expect(firstSuccess([Promise.resolve(null), later(10, null)])).resolves.toBeNull();
  });

  it('treats a rejection as null and keeps waiting for the other candidate', async () => {
    await expect(firstSuccess([rejectLater(5), later(20, 'value')])).resolves.toBe('value');
  });

  it('resolves null when every candidate rejects', async () => {
    await expect(firstSuccess([rejectLater(5), rejectLater(10)])).resolves.toBeNull();
  });

  it('resolves null for an empty candidate list', async () => {
    await expect(firstSuccess([])).resolves.toBeNull();
  });
});
