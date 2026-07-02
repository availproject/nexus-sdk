import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Address, Hex } from 'viem';
import { recoverTypedDataAddress, zeroAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createSafeClient } from '../../../src/swap/safe/safe-client';
import { predictSafeAccountAddress } from '../../../src/swap/safe/predict';
import {
  ensureAuthDomain,
  ensureAuthTypes,
} from '../../../src/swap/safe/ensure-auth';
import {
  SAFE_MULTI_SEND_CALL_ONLY_ADDRESS,
  SAFE_SALT_NONCE,
} from '../../../src/swap/safe/constants';
import { safeDomain, safeTxTypes } from '../../../src/swap/safe/safe-tx';

const PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
const owner = privateKeyToAccount(PK);
const safe = predictSafeAccountAddress(owner.address).address as Address;
const chainId = 1;

type StubPublicClient = {
  getCode: ReturnType<typeof vi.fn>;
  readContract: ReturnType<typeof vi.fn>;
};

const makePublicClient = (overrides: Partial<StubPublicClient> = {}): StubPublicClient => ({
  getCode: vi.fn().mockResolvedValue(undefined),
  readContract: vi.fn().mockResolvedValue(0n),
  ...overrides,
});

const makeMiddleware = (overrides?: Partial<ReturnType<typeof baseMiddleware>>) => ({
  ...baseMiddleware(),
  ...overrides,
});

function baseMiddleware() {
  return {
    getSafeAccountAddress: vi.fn().mockResolvedValue({
      chainId,
      owner: owner.address,
      address: safe,
      factoryAddress: '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67' as Hex,
      exists: false,
    }),
    ensureSafeAccount: vi.fn().mockResolvedValue({
      chainId,
      owner: owner.address,
      address: safe,
      factoryAddress: '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67' as Hex,
      exists: true,
      deployTxHash: '0xabc' as Hex,
    }),
    createSafeExecuteTx: vi.fn().mockResolvedValue({
      chainId,
      safeAddress: safe,
      txHash: '0xfeed' as Hex,
    }),
  };
}

describe('createSafeClient.getAddress', () => {
  it('returns the predicted address + on-chain existence (RPC code-check)', async () => {
    const publicClient = makePublicClient({
      getCode: vi.fn().mockResolvedValue(undefined),
    });
    const middleware = makeMiddleware();
    const client = createSafeClient({
      chainId,
      owner,
      publicClient: publicClient as never,
      middleware,
    });

    const result = await client.getAddress();
    expect(result.address).toBe(safe);
    expect(result.exists).toBe(false);
    expect(publicClient.getCode).toHaveBeenCalledWith({ address: safe });
  });

  it('reports exists=true when getCode returns non-empty bytecode', async () => {
    const publicClient = makePublicClient({
      getCode: vi.fn().mockResolvedValue('0x60806040'),
    });
    const client = createSafeClient({
      chainId,
      owner,
      publicClient: publicClient as never,
      middleware: makeMiddleware(),
    });

    const result = await client.getAddress();
    expect(result.exists).toBe(true);
  });
});

describe('createSafeClient.ensure', () => {
  it('skips the middleware call when the Safe is already deployed', async () => {
    const publicClient = makePublicClient({
      getCode: vi.fn().mockResolvedValue('0x60806040'),
    });
    const middleware = makeMiddleware();
    const client = createSafeClient({
      chainId,
      owner,
      publicClient: publicClient as never,
      middleware,
    });

    const result = await client.ensure();
    expect(middleware.ensureSafeAccount).not.toHaveBeenCalled();
    expect(result.exists).toBe(true);
  });

  it('signs the digest and calls middleware when not deployed', async () => {
    const publicClient = makePublicClient();
    const middleware = makeMiddleware();
    const client = createSafeClient({
      chainId,
      owner,
      publicClient: publicClient as never,
      middleware,
    });

    await client.ensure({ deadlineSeconds: 600 });

    expect(middleware.ensureSafeAccount).toHaveBeenCalledTimes(1);
    const [arg] = middleware.ensureSafeAccount.mock.calls[0];
    expect(arg.chainId).toBe(chainId);
    expect(arg.owner.toLowerCase()).toBe(owner.address.toLowerCase());
    expect(arg.safeAddress).toBe(safe);
    expect(arg.saltNonce.length).toBe(66);
    expect(arg.deadline.length).toBe(66);
    expect(arg.signature.length).toBe(132);

    const saltNonce = BigInt(arg.saltNonce);
    const deadline = BigInt(arg.deadline);
    expect(saltNonce).toBe(SAFE_SALT_NONCE);

    const recovered = await recoverTypedDataAddress({
      domain: ensureAuthDomain(BigInt(chainId)),
      types: ensureAuthTypes,
      primaryType: 'NexusSafeEnsure',
      message: {
        owner: owner.address,
        safeAddress: safe,
        saltNonce,
        deadline,
      },
      signature: arg.signature,
    });
    expect(recovered.toLowerCase()).toBe(owner.address.toLowerCase());
  });
});

describe('createSafeClient.execute', () => {
  it('builds a single-action SafeTx and sends it via middleware', async () => {
    const publicClient = makePublicClient({
      readContract: vi.fn().mockResolvedValue(7n), // safe nonce
    });
    const middleware = makeMiddleware();
    const client = createSafeClient({
      chainId,
      owner,
      publicClient: publicClient as never,
      middleware,
    });

    const result = await client.execute({
      to: '0xabcdef0123456789abcdef0123456789abcdef01' as Address,
      value: 0n,
      data: '0xdeadbeef',
    });

    expect(result.txHash).toBe('0xfeed');
    expect(middleware.createSafeExecuteTx).toHaveBeenCalledTimes(1);
    const [arg] = middleware.createSafeExecuteTx.mock.calls[0];
    expect(arg.operation).toBe(0);
    expect(arg.to).toBe('0xabcdef0123456789abcdef0123456789abcdef01');
    expect(arg.data).toBe('0xdeadbeef');
    expect(arg.signature.length).toBe(132);

    const recovered = await recoverTypedDataAddress({
      domain: safeDomain(chainId, safe),
      types: safeTxTypes,
      primaryType: 'SafeTx',
      message: {
        to: arg.to,
        value: BigInt(arg.value),
        data: arg.data,
        operation: arg.operation,
        safeTxGas: BigInt(arg.safeTxGas),
        baseGas: BigInt(arg.baseGas),
        gasPrice: BigInt(arg.gasPrice),
        gasToken: arg.gasToken,
        refundReceiver: arg.refundReceiver,
        nonce: 7n,
      },
      signature: arg.signature,
    });
    expect(recovered.toLowerCase()).toBe(owner.address.toLowerCase());
  });

  it('treats a reverting nonce() read as 0 (pre-deploy)', async () => {
    const publicClient = makePublicClient({
      readContract: vi.fn().mockRejectedValue(new Error('execution reverted')),
    });
    const middleware = makeMiddleware();
    const client = createSafeClient({
      chainId,
      owner,
      publicClient: publicClient as never,
      middleware,
    });

    await client.execute({
      to: '0xabcdef0123456789abcdef0123456789abcdef01' as Address,
      value: 0n,
      data: '0x',
    });

    const [arg] = middleware.createSafeExecuteTx.mock.calls[0];
    // Nonce 0 → safeTxGas/baseGas/gasPrice all 32-byte hex zeros.
    const recovered = await recoverTypedDataAddress({
      domain: safeDomain(chainId, safe),
      types: safeTxTypes,
      primaryType: 'SafeTx',
      message: {
        to: arg.to,
        value: BigInt(arg.value),
        data: arg.data,
        operation: arg.operation,
        safeTxGas: BigInt(arg.safeTxGas),
        baseGas: BigInt(arg.baseGas),
        gasPrice: BigInt(arg.gasPrice),
        gasToken: arg.gasToken,
        refundReceiver: arg.refundReceiver,
        nonce: 0n,
      },
      signature: arg.signature,
    });
    expect(recovered.toLowerCase()).toBe(owner.address.toLowerCase());
  });
});

describe('createSafeClient.executeBatch', () => {
  it('wraps calls in MultiSendCallOnly DELEGATECALL', async () => {
    const publicClient = makePublicClient({
      readContract: vi.fn().mockResolvedValue(3n),
    });
    const middleware = makeMiddleware();
    const client = createSafeClient({
      chainId,
      owner,
      publicClient: publicClient as never,
      middleware,
    });

    await client.executeBatch([
      {
        to: '0xabcdef0123456789abcdef0123456789abcdef01' as Address,
        value: 0n,
        data: '0xaa',
      },
      {
        to: '0xfedcba9876543210fedcba9876543210fedcba98' as Address,
        value: 0n,
        data: '0xbb',
      },
    ]);

    expect(middleware.createSafeExecuteTx).toHaveBeenCalledTimes(1);
    const [arg] = middleware.createSafeExecuteTx.mock.calls[0];
    expect(arg.operation).toBe(1);
    expect(arg.to.toLowerCase()).toBe(SAFE_MULTI_SEND_CALL_ONLY_ADDRESS.toLowerCase());
    expect(arg.gasToken).toBe(zeroAddress);
  });
});
