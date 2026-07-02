import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hex, PublicClient } from 'viem';
import { recoverTypedDataAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ensureSafeForEphemeral } from '../../src/services/safe';
import {
  ensureAuthDomain,
  ensureAuthTypes,
} from '../../src/swap/safe/ensure-auth';
import { predictSafeAccountAddress } from '../../src/swap/safe/predict';
import { SAFE_SALT_NONCE } from '../../src/swap/safe/constants';

const PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
const ephemeralWallet = privateKeyToAccount(PK);
const safeAddress = predictSafeAccountAddress(ephemeralWallet.address).address;
const chainId = 42161;

type StubPublicClient = Pick<PublicClient, 'getCode'>;

const makePublicClient = (code?: Hex): StubPublicClient =>
  ({ getCode: vi.fn().mockResolvedValue(code) }) as unknown as StubPublicClient;

const makeMiddleware = () => ({
  ensureSafeAccount: vi.fn().mockResolvedValue({
    chainId,
    owner: ephemeralWallet.address,
    address: safeAddress,
    factoryAddress: '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67' as Hex,
    exists: true,
    deployTxHash: '0xabc' as Hex,
  }),
});

describe('ensureSafeForEphemeral', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips middleware when Safe already deployed', async () => {
    const publicClient = makePublicClient('0x60806040');
    const middleware = makeMiddleware();

    const result = await ensureSafeForEphemeral({
      chainId,
      ephemeralWallet,
      publicClient,
      middleware,
    });

    expect(middleware.ensureSafeAccount).not.toHaveBeenCalled();
    expect(result.address).toBe(safeAddress);
    expect(result.exists).toBe(true);
    expect(result.deployTxHash).toBeUndefined();
  });

  it('signs ensure-auth with ephemeral and POSTs middleware when not deployed', async () => {
    const publicClient = makePublicClient(undefined);
    const middleware = makeMiddleware();

    await ensureSafeForEphemeral({
      chainId,
      ephemeralWallet,
      publicClient,
      middleware,
    });

    expect(middleware.ensureSafeAccount).toHaveBeenCalledTimes(1);
    const [body] = middleware.ensureSafeAccount.mock.calls[0];
    expect(body.chainId).toBe(chainId);
    expect(body.owner.toLowerCase()).toBe(ephemeralWallet.address.toLowerCase());
    expect(body.safeAddress).toBe(safeAddress);
    expect(body.saltNonce.length).toBe(66);
    expect(body.deadline.length).toBe(66);
    expect(body.signature.length).toBe(132);

    expect(BigInt(body.saltNonce)).toBe(SAFE_SALT_NONCE);

    const recovered = await recoverTypedDataAddress({
      domain: ensureAuthDomain(BigInt(chainId)),
      types: ensureAuthTypes,
      primaryType: 'NexusSafeEnsure',
      message: {
        owner: ephemeralWallet.address,
        safeAddress,
        saltNonce: SAFE_SALT_NONCE,
        deadline: BigInt(body.deadline),
      },
      signature: body.signature,
    });
    expect(recovered.toLowerCase()).toBe(ephemeralWallet.address.toLowerCase());
  });

  it('uses default 10-minute deadline window', async () => {
    const publicClient = makePublicClient(undefined);
    const middleware = makeMiddleware();
    const before = Math.floor(Date.now() / 1000);

    await ensureSafeForEphemeral({
      chainId,
      ephemeralWallet,
      publicClient,
      middleware,
    });

    const after = Math.floor(Date.now() / 1000);
    const [body] = middleware.ensureSafeAccount.mock.calls[0];
    const deadline = Number(BigInt(body.deadline));
    expect(deadline).toBeGreaterThanOrEqual(before + 600);
    expect(deadline).toBeLessThanOrEqual(after + 600);
  });
});
