import { describe, expect, it } from 'vitest';
import { isUserRejectedRequest } from '../../src/services/is-user-rejected-request';

describe('isUserRejectedRequest', () => {
  it('recognizes a plain EIP-1193 user rejection', () => {
    expect(
      isUserRejectedRequest({
        code: 4001,
        message: 'User rejected the request.',
      })
    ).toBe(true);
  });

  it('does not classify another provider error as a rejection', () => {
    expect(isUserRejectedRequest({ code: -32603, message: 'Internal JSON-RPC error.' })).toBe(
      false
    );
  });
});
