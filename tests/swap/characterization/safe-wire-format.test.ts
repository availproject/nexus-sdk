import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  decodeFunctionData,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { recoverTypedDataAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  buildSafeExecuteEOACall,
  createSafeExecuteTxFromCalls,
  type SafeCall,
} from '../../../src/services/safe';
import {
  SAFE_MULTI_SEND_CALL_ONLY_ADDRESS,
} from '../../../src/swap/safe/constants';
import { safeExecTransactionAbi } from '../../../src/swap/safe/abis';
import { safeDomain, safeTxTypes } from '../../../src/swap/safe/safe-tx';
import { predictSafeAccountAddress } from '../../../src/swap/safe/predict';
import { buildMultiSendPayload } from '../../../src/swap/safe/multi-send';

const CHAIN_ID = 42161;
const PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
const ephemeralWallet = privateKeyToAccount(PK);
const safeAddress = predictSafeAccountAddress(ephemeralWallet.address).address as Address;
const target = '0xabcdef0123456789abcdef0123456789abcdef01' as Address;
const target2 = '0xfedcba9876543210fedcba9876543210fedcba98' as Address;

const makePublicClient = (nonce = 0n) =>
  ({ readContract: vi.fn().mockResolvedValue(nonce) }) as unknown as Pick<
    PublicClient,
    'readContract'
  >;

const HEX32 = /^0x[0-9a-fA-F]{64}$/;

describe('Safe wire-format characterization — sponsor (createSafeExecuteTxFromCalls)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pads fixed-width 32-byte fields (value, safeTxGas, baseGas, gasPrice)', async () => {
    const calls: SafeCall[] = [{ to: target, value: 0n, data: '0xdeadbeef' }];
    const result = await createSafeExecuteTxFromCalls({
      calls,
      chainId: CHAIN_ID,
      ephemeralWallet,
      publicClient: makePublicClient(),
      safeAddress,
    });
    expect(result.value).toMatch(HEX32);
    expect(result.safeTxGas).toMatch(HEX32);
    expect(result.baseGas).toMatch(HEX32);
    expect(result.gasPrice).toMatch(HEX32);
  });

  it('single CALL: operation=0, to=target, value=0x00…0', async () => {
    const result = await createSafeExecuteTxFromCalls({
      calls: [{ to: target, value: 0n, data: '0x' }],
      chainId: CHAIN_ID,
      ephemeralWallet,
      publicClient: makePublicClient(),
      safeAddress,
    });
    expect(result.operation).toBe(0);
    expect(result.to.toLowerCase()).toBe(target.toLowerCase());
    expect(BigInt(result.value)).toBe(0n);
  });

  it('multi-call: operation=1, to=MultiSendCallOnly, data=multiSend(packed-bytes)', async () => {
    const calls: SafeCall[] = [
      { to: target, value: 0n, data: '0xaa' },
      { to: target2, value: 0n, data: '0xbb' },
    ];
    const result = await createSafeExecuteTxFromCalls({
      calls,
      chainId: CHAIN_ID,
      ephemeralWallet,
      publicClient: makePublicClient(),
      safeAddress,
    });
    expect(result.operation).toBe(1);
    expect(result.to.toLowerCase()).toBe(SAFE_MULTI_SEND_CALL_ONLY_ADDRESS.toLowerCase());
    expect(result.data).toBe(buildMultiSendPayload(calls));
  });

  it('signature is 65 bytes (130 hex) and recovers to ephemeral via EIP-712', async () => {
    const result = await createSafeExecuteTxFromCalls({
      calls: [{ to: target, value: 0n, data: '0xfeed' }],
      chainId: CHAIN_ID,
      ephemeralWallet,
      publicClient: makePublicClient(11n),
      safeAddress,
    });
    expect(result.signature).toMatch(/^0x[0-9a-fA-F]{130}$/);

    const recovered = await recoverTypedDataAddress({
      domain: safeDomain(CHAIN_ID, safeAddress),
      types: safeTxTypes,
      primaryType: 'SafeTx',
      message: {
        to: result.to,
        value: BigInt(result.value),
        data: result.data,
        operation: result.operation,
        safeTxGas: BigInt(result.safeTxGas),
        baseGas: BigInt(result.baseGas),
        gasPrice: BigInt(result.gasPrice),
        gasToken: result.gasToken,
        refundReceiver: result.refundReceiver,
        nonce: 11n,
      },
      signature: result.signature,
    });
    expect(recovered.toLowerCase()).toBe(ephemeralWallet.address.toLowerCase());
  });
});

describe('Safe wire-format characterization — EOA-submit (buildSafeExecuteEOACall)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('produces {to=safe, value=nativeValue, data=execTransaction calldata}', async () => {
    const result = await buildSafeExecuteEOACall({
      calls: [{ to: target, value: 1_000n, data: '0xdeadbeef' }],
      chainId: CHAIN_ID,
      ephemeralWallet,
      publicClient: makePublicClient(),
      safeAddress,
      nativeValue: 1_000n,
    });
    expect(result.to).toBe(safeAddress);
    expect(result.value).toBe(1_000n);

    const { functionName, args } = decodeFunctionData({
      abi: safeExecTransactionAbi,
      data: result.data,
    });
    expect(functionName).toBe('execTransaction');
    expect((args[args.length - 1] as Hex)).toMatch(/^0x[0-9a-fA-F]{130}$/);
  });

  it('MultiSend variant: outer value=nativeValue, inner operations=DELEGATECALL', async () => {
    const result = await buildSafeExecuteEOACall({
      calls: [
        { to: target, value: 250n, data: '0xaa' },
        { to: target2, value: 250n, data: '0xbb' },
      ],
      chainId: CHAIN_ID,
      ephemeralWallet,
      publicClient: makePublicClient(),
      safeAddress,
      nativeValue: 500n,
    });
    expect(result.value).toBe(500n);
    const { args } = decodeFunctionData({
      abi: safeExecTransactionAbi,
      data: result.data,
    });
    expect((args[0] as Hex).toLowerCase()).toBe(SAFE_MULTI_SEND_CALL_ONLY_ADDRESS.toLowerCase());
    expect(args[3]).toBe(1);
  });

  it('refuses single-call mismatch between nativeValue and calls[0].value', async () => {
    await expect(
      buildSafeExecuteEOACall({
        calls: [{ to: target, value: 100n, data: '0x' }],
        chainId: CHAIN_ID,
        ephemeralWallet,
        publicClient: makePublicClient(),
        safeAddress,
        nativeValue: 999n,
      })
    ).rejects.toThrow(/Single-call native value mismatch/);
  });
});
