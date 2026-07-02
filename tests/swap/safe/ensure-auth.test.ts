import { describe, expect, it } from 'vitest';
import type { Address } from 'viem';
import { hashTypedData, recoverTypedDataAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  buildEnsureAuthDigest,
  ensureAuthDomain,
  ensureAuthTypes,
  signEnsureAuth,
} from '../../../src/swap/safe/ensure-auth';
import { predictSafeAccountAddress } from '../../../src/swap/safe/predict';
import {
  SAFE_PROXY_FACTORY_ADDRESS,
  SAFE_SALT_NONCE,
} from '../../../src/swap/safe/constants';

describe('buildEnsureAuthDigest', () => {
  it('equals viem.hashTypedData over the documented EIP-712 schema', () => {
    const owner: Address = '0x1111111111111111111111111111111111111111';
    const { address: safe } = predictSafeAccountAddress(owner);
    const ours = buildEnsureAuthDigest({
      chainId: 999n,
      owner,
      safe,
      saltNonce: SAFE_SALT_NONCE,
      deadline: 1234567890n,
    });
    const theirs = hashTypedData({
      domain: ensureAuthDomain(999n),
      types: ensureAuthTypes,
      primaryType: 'NexusSafeEnsure',
      message: {
        owner,
        safeAddress: safe,
        saltNonce: SAFE_SALT_NONCE,
        deadline: 1234567890n,
      },
    });
    expect(ours).toBe(theirs);
  });

  it('chainId in the domain separator changes the digest (anti-replay)', () => {
    const owner: Address = '0x1111111111111111111111111111111111111111';
    const { address: safe } = predictSafeAccountAddress(owner);
    const base = { owner, safe, saltNonce: SAFE_SALT_NONCE, deadline: 1234567890n };
    expect(buildEnsureAuthDigest({ chainId: 1n, ...base })).not.toBe(
      buildEnsureAuthDigest({ chainId: 2n, ...base })
    );
  });

  it('deadline changes the digest', () => {
    const owner: Address = '0x1111111111111111111111111111111111111111';
    const { address: safe } = predictSafeAccountAddress(owner);
    const base = { chainId: 1n, owner, safe, saltNonce: SAFE_SALT_NONCE };
    expect(buildEnsureAuthDigest({ ...base, deadline: 1n })).not.toBe(
      buildEnsureAuthDigest({ ...base, deadline: 2n })
    );
  });

  it('uses the standard EIP-712 domain shape {name, version, chainId, verifyingContract}', () => {
    const d = ensureAuthDomain(42n);
    expect(d.name).toBe('NexusSafeEnsureAuth');
    expect(d.version).toBe('1');
    expect(d.chainId).toBe(42n);
    // verifyingContract binds the digest to the Safe factory that will execute the deploy —
    // standard EIP-712 hygiene + wallet phishing-prevention surface.
    expect(d.verifyingContract).toBe(SAFE_PROXY_FACTORY_ADDRESS);
  });
});

describe('signEnsureAuth', () => {
  it('produces a signature that recovers to the owner via EIP-712', async () => {
    const pk = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
    const account = privateKeyToAccount(pk);
    const { address: safe } = predictSafeAccountAddress(account.address);
    const deadline = 4102444800n;
    const params = {
      chainId: 999n,
      owner: account.address,
      safe,
      saltNonce: SAFE_SALT_NONCE,
      deadline,
    };

    const signature = await signEnsureAuth(account, params);

    expect(signature.length).toBe(132);
    const recovered = await recoverTypedDataAddress({
      domain: ensureAuthDomain(params.chainId),
      types: ensureAuthTypes,
      primaryType: 'NexusSafeEnsure',
      message: {
        owner: params.owner,
        safeAddress: params.safe,
        saltNonce: params.saltNonce,
        deadline: params.deadline,
      },
      signature,
    });
    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase());
  });
});
