import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Hex, WalletClient } from 'viem';

const hoisted = vi.hoisted(() => ({
  recoverMessageAddress: vi.fn(),
}));

// Mock the vendored stark key derivation before any imports that use it
vi.mock('../../../src/swap/wallet/stark', () => ({
  getPrivateKeyFromEthSignature: vi.fn(),
}));

vi.mock('viem', async () => {
  const actual = await vi.importActual<typeof import('viem')>('viem');
  return {
    ...actual,
    recoverMessageAddress: hoisted.recoverMessageAddress,
  };
});

import {
  buildEphemeralSignMessage,
  deriveEphemeralKey,
  deriveEphemeralKeyFromSignature,
  getEphemeralSignatureStorageKey,
  signEphemeralKeyMessage,
  verifyEphemeralSignature,
} from '../../../src/swap/wallet/derived-key';
import { getPrivateKeyFromEthSignature } from '../../../src/swap/wallet/stark';

// Deterministic mock: same signature always yields same key
const MOCK_SIGNATURE = '0xaabbccdd' + 'ee'.repeat(61) + '1b';
// Must be a valid 32-byte hex string (64 chars) for privateKeyToAccount
const MOCK_DERIVED_KEY = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
const TEST_DOMAIN = 'app.example.com';

const makeWalletClient = (signature?: string, shouldThrow = false) => ({
  signMessage: shouldThrow
    ? vi.fn().mockRejectedValue(new Error('User rejected'))
    : vi.fn().mockResolvedValue(signature ?? MOCK_SIGNATURE),
});

describe('deriveEphemeralKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPrivateKeyFromEthSignature).mockReturnValue(MOCK_DERIVED_KEY);
  });

  it('returns a PrivateKeyAccount with a valid address', async () => {
    const walletClient = makeWalletClient();
    const account = await deriveEphemeralKey(
      walletClient as unknown as WalletClient,
      '0xaaaa' as `0x${string}`,
      TEST_DOMAIN
    );

    expect(account).toBeDefined();
    expect(account.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it('is deterministic — same signature produces same key', async () => {
    const walletClient = makeWalletClient();
    const account1 = await deriveEphemeralKey(
      walletClient as unknown as WalletClient,
      '0xaaaa' as `0x${string}`,
      TEST_DOMAIN
    );
    const account2 = await deriveEphemeralKey(
      walletClient as unknown as WalletClient,
      '0xaaaa' as `0x${string}`,
      TEST_DOMAIN
    );

    expect(account1.address).toBe(account2.address);
  });

  it('calls signMessage with the SIWE-like sign message including the domain', async () => {
    const walletClient = makeWalletClient();
    await deriveEphemeralKey(
      walletClient as unknown as WalletClient,
      '0xAaAa000000000000000000000000000000000000' as `0x${string}`,
      TEST_DOMAIN
    );

    expect(walletClient.signMessage).toHaveBeenCalledTimes(1);
    const callArgs = walletClient.signMessage.mock.calls[0][0];
    expect(callArgs.message).toBe(
      [
        'Sign in to enable Avail Nexus swap',
        '',
        'This signature does not authorize any transaction.',
        '',
        'Account: 0xaaaa000000000000000000000000000000000000',
        `Domain: ${TEST_DOMAIN}`,
        'Identifier: avail-nexus',
      ].join('\n')
    );
  });

  it('passes signature to starkware key derivation', async () => {
    const walletClient = makeWalletClient();
    await deriveEphemeralKey(
      walletClient as unknown as WalletClient,
      '0xaaaa' as `0x${string}`,
      TEST_DOMAIN
    );

    expect(getPrivateKeyFromEthSignature).toHaveBeenCalledWith(MOCK_SIGNATURE);
  });

  it('signEphemeralKeyMessage returns the signature from signMessage', async () => {
    const walletClient = makeWalletClient();

    const signature = await signEphemeralKeyMessage(
      walletClient as unknown as WalletClient,
      '0xaaaa' as `0x${string}`,
      TEST_DOMAIN
    );

    expect(signature).toBe(MOCK_SIGNATURE);
  });

  it('deriveEphemeralKeyFromSignature derives the same account deterministically', () => {
    const account = deriveEphemeralKeyFromSignature(MOCK_SIGNATURE as `0x${string}`);

    expect(account.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(getPrivateKeyFromEthSignature).toHaveBeenCalledWith(MOCK_SIGNATURE);
  });

  it('left-pads short derived private keys before creating the account', () => {
    vi.mocked(getPrivateKeyFromEthSignature).mockReturnValue(MOCK_DERIVED_KEY.slice(1));

    const account = deriveEphemeralKeyFromSignature(MOCK_SIGNATURE as `0x${string}`);

    expect(account.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it('builds the expected storage key for an address + domain', () => {
    expect(
      getEphemeralSignatureStorageKey(
        '0xAaAa000000000000000000000000000000000000' as `0x${string}`,
        TEST_DOMAIN
      )
    ).toBe(`nexus-sdk-v2:ephemeral-signature:0xaaaa000000000000000000000000000000000000:${TEST_DOMAIN}`);
  });

  it('storage key changes when the domain changes', () => {
    const address = '0xAaAa000000000000000000000000000000000000' as `0x${string}`;
    expect(getEphemeralSignatureStorageKey(address, 'one.example.com')).not.toBe(
      getEphemeralSignatureStorageKey(address, 'two.example.com')
    );
  });

  it('buildEphemeralSignMessage lowercases the address', () => {
    const message = buildEphemeralSignMessage({
      address: '0xAaAa000000000000000000000000000000000000' as `0x${string}`,
      domain: TEST_DOMAIN,
    });
    expect(message).toContain('Account: 0xaaaa000000000000000000000000000000000000');
  });

  it('throws ephemeralKeyFailed when signMessage fails', async () => {
    const walletClient = makeWalletClient(undefined, true);

    await expect(
      deriveEphemeralKey(
        walletClient as unknown as WalletClient,
        '0xaaaa' as `0x${string}`,
        TEST_DOMAIN
      )
    ).rejects.toThrow(/ephemeral/i);
  });
});

describe('verifyEphemeralSignature', () => {
  const ADDRESS = '0xAaAa000000000000000000000000000000000000' as Hex;

  beforeEach(() => {
    hoisted.recoverMessageAddress.mockReset();
  });

  it('returns true when the recovered address matches the EOA (case-insensitive)', async () => {
    hoisted.recoverMessageAddress.mockResolvedValueOnce(ADDRESS.toLowerCase());

    await expect(
      verifyEphemeralSignature({
        address: ADDRESS,
        domain: TEST_DOMAIN,
        signature: MOCK_SIGNATURE as Hex,
      })
    ).resolves.toBe(true);
  });

  it('returns false when the recovered address does not match the EOA', async () => {
    hoisted.recoverMessageAddress.mockResolvedValueOnce(
      '0x1111111111111111111111111111111111111111'
    );

    await expect(
      verifyEphemeralSignature({
        address: ADDRESS,
        domain: TEST_DOMAIN,
        signature: MOCK_SIGNATURE as Hex,
      })
    ).resolves.toBe(false);
  });

  it('returns false when recovery throws (malformed signature bytes)', async () => {
    hoisted.recoverMessageAddress.mockRejectedValueOnce(new Error('invalid signature'));

    await expect(
      verifyEphemeralSignature({
        address: ADDRESS,
        domain: TEST_DOMAIN,
        signature: '0xdeadbeef' as Hex,
      })
    ).resolves.toBe(false);
  });

  it('recovers against the same message buildEphemeralSignMessage produces', async () => {
    hoisted.recoverMessageAddress.mockResolvedValueOnce(ADDRESS);

    await verifyEphemeralSignature({
      address: ADDRESS,
      domain: TEST_DOMAIN,
      signature: MOCK_SIGNATURE as Hex,
    });

    expect(hoisted.recoverMessageAddress).toHaveBeenCalledWith({
      message: buildEphemeralSignMessage({ address: ADDRESS, domain: TEST_DOMAIN }),
      signature: MOCK_SIGNATURE,
    });
  });
});
