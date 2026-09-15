import { describe, expect, it } from 'vitest';
import { createExplorerTxURL } from '../../src/services/explorer';

describe('explorer helpers', () => {
  it('returns an empty string when no explorer base URL is configured', () => {
    expect(createExplorerTxURL('0x1234', '')).toBe('');
  });
});
