import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  decodeAbiParameters,
  padHex,
  type PrivateKeyAccount,
  type PublicClient,
  recoverTypedDataAddress,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  createSBCTxFromCalls,
  type SBCCall,
} from '../../../src/services/sbc';
import { CALIBUR_ADDRESS } from '../../../src/swap/constants';

const MOCK_EPHEMERAL_ADDRESS = '0xaabbccddee112233445566778899001122334455' as `0x${string}`;
const MOCK_RECIPIENT_ADDRESS = '0x1234567890abcdef1234567890abcdef12345678' as `0x${string}`;
// Valid 65-byte signature (r: 32 bytes, s: 32 bytes, v: 1 byte) = 130 hex chars + '0x'
const MOCK_SIGNATURE = ('0x' + 'aa'.repeat(65)) as `0x${string}`;

const mockEphemeralWallet = {
  address: MOCK_EPHEMERAL_ADDRESS,
  signTypedData: vi.fn().mockResolvedValue(MOCK_SIGNATURE),
  signAuthorization: vi.fn().mockResolvedValue({
    contractAddress: CALIBUR_ADDRESS,
    chainId: 42161,
    nonce: 0,
    r: '0x01' as `0x${string}`,
    s: '0x02' as `0x${string}`,
    yParity: 0,
  }),
};

const mockPublicClient = {
  getCode: vi.fn(),
  getTransactionCount: vi.fn().mockResolvedValue(0),
};

describe('createSBCTxFromCalls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEphemeralWallet.signTypedData.mockResolvedValue(MOCK_SIGNATURE);
    mockEphemeralWallet.signAuthorization.mockResolvedValue({
      contractAddress: CALIBUR_ADDRESS,
      chainId: 42161,
      nonce: 0,
      r: '0x01' as `0x${string}`,
      s: '0x02' as `0x${string}`,
      yParity: 0,
    });
  });

  it('produces valid SBCTx structure', async () => {
    mockPublicClient.getCode.mockResolvedValueOnce('0xef0100' + CALIBUR_ADDRESS.slice(2));

    const calls: SBCCall[] = [
      { to: MOCK_RECIPIENT_ADDRESS, data: '0xabcdef' as `0x${string}`, value: 0n },
    ];

    const result = await createSBCTxFromCalls({
      calls,
      chainID: 42161,
      ephemeralAddress: mockEphemeralWallet.address,
      ephemeralWallet: mockEphemeralWallet as unknown as PrivateKeyAccount,
      publicClient: mockPublicClient as unknown as Pick<PublicClient, 'getCode' | 'getTransactionCount'>,
    });

    expect(result).toBeDefined();
    expect(result.chainId).toBe(42161);
    expect(result.address).toBe(MOCK_EPHEMERAL_ADDRESS);
    expect(result.calls).toHaveLength(1);
    expect(result.revertOnFailure).toBe(true);
    expect(result.signature).toMatch(/^0x[0-9a-fA-F]+$/);
    expect(result.authorizationList).toBeUndefined();
  });

  it('deadline is within 15 minutes from now', async () => {
    mockPublicClient.getCode.mockResolvedValueOnce('0xef0100' + CALIBUR_ADDRESS.slice(2));

    const calls: SBCCall[] = [
      { to: MOCK_RECIPIENT_ADDRESS, data: '0x00' as `0x${string}`, value: 0n },
    ];

    const now = Math.floor(Date.now() / 1000);
    const result = await createSBCTxFromCalls({
      calls,
      chainID: 42161,
      ephemeralAddress: mockEphemeralWallet.address,
      ephemeralWallet: mockEphemeralWallet as unknown as PrivateKeyAccount,
      publicClient: mockPublicClient as unknown as Pick<PublicClient, 'getCode' | 'getTransactionCount'>,
    });

    const deadlineBigInt = BigInt(result.deadline);
    const deadlineNum = Number(deadlineBigInt);
    // Should be within 15 minutes + 5s tolerance
    expect(deadlineNum).toBeGreaterThanOrEqual(now + 890);
    expect(deadlineNum).toBeLessThanOrEqual(now + 905);
  });

  it('auth code already set → omits authorizationList', async () => {
    // 0xef0100 prefix = Calibur code set
    mockPublicClient.getCode.mockResolvedValueOnce('0xef0100' + CALIBUR_ADDRESS.slice(2));

    const calls: SBCCall[] = [
      { to: MOCK_RECIPIENT_ADDRESS, data: '0x00' as `0x${string}`, value: 0n },
    ];

    const result = await createSBCTxFromCalls({
      calls,
      chainID: 42161,
      ephemeralAddress: mockEphemeralWallet.address,
      ephemeralWallet: mockEphemeralWallet as unknown as PrivateKeyAccount,
      publicClient: mockPublicClient as unknown as Pick<PublicClient, 'getCode' | 'getTransactionCount'>,
    });

    expect(result.authorizationList).toBeUndefined();
  });

  it('auth code not set → includes authorizationList', async () => {
    // No code set
    mockPublicClient.getCode.mockResolvedValueOnce(undefined);

    const calls: SBCCall[] = [
      { to: MOCK_RECIPIENT_ADDRESS, data: '0x00' as `0x${string}`, value: 0n },
    ];

    const result = await createSBCTxFromCalls({
      calls,
      chainID: 42161,
      ephemeralAddress: mockEphemeralWallet.address,
      ephemeralWallet: mockEphemeralWallet as unknown as PrivateKeyAccount,
      publicClient: mockPublicClient as unknown as Pick<PublicClient, 'getCode' | 'getTransactionCount'>,
    });

    expect(result.authorizationList).toHaveLength(1);
    expect(result.authorizationList?.[0]?.address).toBe(CALIBUR_ADDRESS);
  });

  it('signTypedData is called with correct domain', async () => {
    mockPublicClient.getCode.mockResolvedValueOnce('0xef0100' + CALIBUR_ADDRESS.slice(2));

    const calls: SBCCall[] = [
      { to: MOCK_RECIPIENT_ADDRESS, data: '0x00' as `0x${string}`, value: 0n },
    ];

    await createSBCTxFromCalls({
      calls,
      chainID: 42161,
      ephemeralAddress: mockEphemeralWallet.address,
      ephemeralWallet: mockEphemeralWallet as unknown as PrivateKeyAccount,
      publicClient: mockPublicClient as unknown as Pick<PublicClient, 'getCode' | 'getTransactionCount'>,
    });

    expect(mockEphemeralWallet.signTypedData).toHaveBeenCalledTimes(1);
    const callArgs = mockEphemeralWallet.signTypedData.mock.calls[0][0];
    expect(callArgs.domain.name).toBe('Calibur');
    expect(callArgs.domain.version).toBe('1.0.0');
    expect(callArgs.domain.verifyingContract).toBe(mockEphemeralWallet.address);
    expect(callArgs.primaryType).toBe('SignedBatchedCall');
  });

  it('produces an SBC signature that recovers to the ephemeral address', async () => {
    mockPublicClient.getCode.mockResolvedValueOnce('0xef0100' + CALIBUR_ADDRESS.slice(2));

    const ephemeralWallet = privateKeyToAccount(
      '0x59c6995e998f97a5a0044966f094538e0d7d5f1b5d1b77e3b82466e0e5c6d3a3'
    );
    const calls: SBCCall[] = [
      { to: MOCK_RECIPIENT_ADDRESS, data: '0xabcdef' as `0x${string}`, value: 3n },
    ];

    const result = await createSBCTxFromCalls({
      calls,
      chainID: 42161,
      ephemeralAddress: ephemeralWallet.address,
      ephemeralWallet,
      publicClient: mockPublicClient as unknown as Pick<PublicClient, 'getCode' | 'getTransactionCount'>,
    });

    const [signature] = decodeAbiParameters(
      [{ type: 'bytes' }, { type: 'bytes' }],
      result.signature
    );

    const recovered = await recoverTypedDataAddress({
      domain: {
        name: 'Calibur',
        version: '1.0.0',
        chainId: result.chainId,
        verifyingContract: result.address,
        salt: padHex(CALIBUR_ADDRESS, { size: 32 }),
      },
      types: {
        SignedBatchedCall: [
          { name: 'batchedCall', type: 'BatchedCall' },
          { name: 'nonce', type: 'uint256' },
          { name: 'keyHash', type: 'bytes32' },
          { name: 'executor', type: 'address' },
          { name: 'deadline', type: 'uint256' },
        ],
        BatchedCall: [
          { name: 'calls', type: 'Call[]' },
          { name: 'revertOnFailure', type: 'bool' },
        ],
        Call: [
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'data', type: 'bytes' },
        ],
      },
      primaryType: 'SignedBatchedCall',
      message: {
        batchedCall: {
          calls: result.calls.map((call) => ({
            to: call.to,
            value: BigInt(call.value),
            data: call.data,
          })),
          revertOnFailure: result.revertOnFailure,
        },
        nonce: BigInt(result.nonce),
        keyHash: result.keyHash,
        executor: '0x0000000000000000000000000000000000000000',
        deadline: BigInt(result.deadline),
      },
      signature,
    });

    expect(recovered).toBe(ephemeralWallet.address);
  });
});
