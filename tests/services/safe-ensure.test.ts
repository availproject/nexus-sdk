import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hex, PublicClient } from 'viem';
import { recoverTypedDataAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  ensureSafeForEphemeral,
  startSafeDeploymentsForChains,
} from '../../src/services/safe';
import {
  ensureAuthDomainV2,
  ensureAuthTypesV2,
} from '../../src/swap/safe/ensure-auth';
import { predictSafeAccountAddressV2 } from '../../src/swap/safe/predict';
import { SAFE_V2_SALT_NONCE } from '../../src/swap/safe/constants';

const PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
const ephemeralWallet = privateKeyToAccount(PK);
const eoaAddress = '0xeeee000000000000000000000000000000000001' as const;
const safeAddress = predictSafeAccountAddressV2(eoaAddress, ephemeralWallet.address).address;
const chainId = 42161;

type StubPublicClient = Pick<PublicClient, 'getCode'>;

const makePublicClient = (code?: Hex): StubPublicClient =>
  ({ getCode: vi.fn().mockResolvedValue(code) }) as unknown as StubPublicClient;

const makeMiddleware = () => ({
  ensureSafeAccount: vi.fn().mockResolvedValue({
    chainId,
    eoaAddress,
    ephemeralAddress: ephemeralWallet.address,
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
      eoaAddress,
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
      eoaAddress,
      ephemeralWallet,
      publicClient,
      middleware,
    });

    expect(middleware.ensureSafeAccount).toHaveBeenCalledTimes(1);
    const [body] = middleware.ensureSafeAccount.mock.calls[0];
    expect(body.chainId).toBe(chainId);
    expect(body.eoaAddress.toLowerCase()).toBe(eoaAddress.toLowerCase());
    expect(body.ephemeralAddress.toLowerCase()).toBe(ephemeralWallet.address.toLowerCase());
    expect(body.safeAddress).toBe(safeAddress);
    expect(body).not.toHaveProperty('saltNonce');
    expect(body.deadline).toMatch(/^\d+$/);
    expect(body.signature.length).toBe(132);

    const recovered = await recoverTypedDataAddress({
      domain: ensureAuthDomainV2(BigInt(chainId)),
      types: ensureAuthTypesV2,
      primaryType: 'NexusSafeEnsureV2',
      message: {
        eoaAddress,
        ephemeralAddress: ephemeralWallet.address,
        safeAddress,
        saltNonce: SAFE_V2_SALT_NONCE,
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
      eoaAddress,
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

  it('starts every unique chain deployment without waiting for another chain', async () => {
    const secondChainId = 10;
    const middleware = makeMiddleware();
    const safeAccounts = {
      getSafeAccount: vi.fn((requestedChainId: number) => ({
        address: safeAddress,
        factoryAddress: '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67' as Hex,
        deployed: requestedChainId === chainId,
      })),
      setSafeDeployed: vi.fn(),
    };

    const deployments = startSafeDeploymentsForChains({
      chainIds: [chainId, secondChainId, chainId],
      eoaAddress,
      ephemeralWallet,
      safeAccounts,
      cacheReady: Promise.resolve(),
      middleware,
    });

    expect([...deployments.keys()]).toEqual([chainId, secondChainId]);
    await Promise.all(deployments.values());
    expect(safeAccounts.getSafeAccount).toHaveBeenCalledTimes(2);
    expect(middleware.ensureSafeAccount).toHaveBeenCalledTimes(1);
    expect(middleware.ensureSafeAccount).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: secondChainId, safeAddress })
    );
    expect(safeAccounts.setSafeDeployed).toHaveBeenCalledWith(secondChainId, true);
  });
});
