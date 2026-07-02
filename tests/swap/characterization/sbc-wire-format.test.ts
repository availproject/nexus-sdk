import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  decodeAbiParameters,
  parseAbiParameters,
  type PrivateKeyAccount,
  type PublicClient,
} from 'viem';
import { createSBCTxFromCalls, type SBCCall } from '../../../src/services/sbc';
import { CALIBUR_ADDRESS } from '../../../src/swap/constants';

const CHAIN_ID = 42161;
const EPHEMERAL_ADDRESS = '0xaabbccddee112233445566778899001122334455' as `0x${string}`;
const RECIPIENT = '0x1234567890abcdef1234567890abcdef12345678' as `0x${string}`;
const SIGNATURE = ('0x' + 'aa'.repeat(65)) as `0x${string}`;

const mockEphemeralWallet = {
  address: EPHEMERAL_ADDRESS,
  signTypedData: vi.fn().mockResolvedValue(SIGNATURE),
  signAuthorization: vi.fn().mockResolvedValue({
    contractAddress: CALIBUR_ADDRESS,
    chainId: CHAIN_ID,
    nonce: 7,
    r: '0x01' as `0x${string}`,
    s: '0x02' as `0x${string}`,
    yParity: 0,
  }),
};

const mockPublicClient = {
  getCode: vi.fn(),
  getTransactionCount: vi.fn().mockResolvedValue(7),
};

const calls: SBCCall[] = [{ to: RECIPIENT, data: '0xabcdef' as `0x${string}`, value: 1n }];

describe('SBC wire-format characterization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pads fixed-width SBC hex fields to 32 bytes', async () => {
    mockPublicClient.getCode.mockResolvedValueOnce('0xef0100' + CALIBUR_ADDRESS.slice(2));

    const result = await createSBCTxFromCalls({
      calls,
      chainID: CHAIN_ID,
      ephemeralAddress: EPHEMERAL_ADDRESS,
      ephemeralWallet: mockEphemeralWallet as unknown as PrivateKeyAccount,
      publicClient: mockPublicClient as unknown as Pick<PublicClient, 'getCode' | 'getTransactionCount'>,
    });

    expect(result.deadline).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(result.nonce).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(result.keyHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(result.calls[0]?.value).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });

  it('ABI-packs signature and hook data as (bytes, bytes)', async () => {
    mockPublicClient.getCode.mockResolvedValueOnce('0xef0100' + CALIBUR_ADDRESS.slice(2));

    const result = await createSBCTxFromCalls({
      calls,
      chainID: CHAIN_ID,
      ephemeralAddress: EPHEMERAL_ADDRESS,
      ephemeralWallet: mockEphemeralWallet as unknown as PrivateKeyAccount,
      publicClient: mockPublicClient as unknown as Pick<PublicClient, 'getCode' | 'getTransactionCount'>,
    });

    const [signature, hookData] = decodeAbiParameters(
      parseAbiParameters('bytes, bytes'),
      result.signature
    );

    expect(signature).toBe(SIGNATURE);
    expect(hookData).toBe('0x');
  });

  it('uses on-chain auth nonce when auth code is missing', async () => {
    mockPublicClient.getCode.mockResolvedValueOnce(undefined);
    mockPublicClient.getTransactionCount.mockResolvedValueOnce(7);

    await createSBCTxFromCalls({
      calls,
      chainID: CHAIN_ID,
      ephemeralAddress: EPHEMERAL_ADDRESS,
      ephemeralWallet: mockEphemeralWallet as unknown as PrivateKeyAccount,
      publicClient: mockPublicClient as unknown as PublicClient,
    });

    expect(mockPublicClient.getTransactionCount).toHaveBeenCalledWith({ address: EPHEMERAL_ADDRESS });
    expect(mockEphemeralWallet.signAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({ nonce: 7 })
    );
  });

  it('encodes authorization list with middleware field names and padded chainId', async () => {
    mockPublicClient.getCode.mockResolvedValueOnce(undefined);

    const result = await createSBCTxFromCalls({
      calls,
      chainID: CHAIN_ID,
      ephemeralAddress: EPHEMERAL_ADDRESS,
      ephemeralWallet: mockEphemeralWallet as unknown as PrivateKeyAccount,
      publicClient: mockPublicClient as unknown as PublicClient,
    });

    expect(result.authorizationList).toHaveLength(1);
    expect(result.authorizationList?.[0]?.chainId).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(
      Object.keys(result.authorizationList?.[0] as unknown as Record<string, unknown>).sort()
    ).toEqual(['address', 'chainId', 'nonce', 'r', 's', 'v']);
  });
});
