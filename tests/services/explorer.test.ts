import { describe, expect, it } from 'vitest';
import { createExplorerTxURL, getIntentExplorerUrl } from '../../src/services/explorer';

describe('explorer helpers', () => {
  it('builds intent explorer URLs with the normalized /rff path', () => {
    expect(
      getIntentExplorerUrl(
        'https://explorer.avail.com',
        '0x1111111111111111111111111111111111111111111111111111111111111111'
      )
    ).toBe('https://explorer.avail.com/rff/0x1111111111111111111111111111111111111111111111111111111111111111');
  });

  it('returns an empty string when no explorer base URL is configured', () => {
    expect(
      getIntentExplorerUrl(
        '',
        '0x1111111111111111111111111111111111111111111111111111111111111111'
      )
    ).toBe('');
    expect(createExplorerTxURL('0x1234', '')).toBe('');
  });
});
