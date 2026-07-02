import { type Address, type Hex, hashTypedData, type LocalAccount } from 'viem';
import { SAFE_PROXY_FACTORY_ADDRESS } from './constants';

export type EnsureAuthParams = {
  chainId: bigint;
  owner: Address;
  safe: Address;
  saltNonce: bigint;
  deadline: bigint;
};

// EIP-712 domain for the off-chain ensure-deploy authorization. Full {name, version, chainId,
// verifyingContract} shape so wallets render a phishing-prevention surface and the digest is
// bound to the Safe factory whose deploy the signature authorizes. The middleware must compute
// the byte-identical domain or recovery will fail.
export const ensureAuthDomain = (chainId: bigint) => ({
  name: 'NexusSafeEnsureAuth',
  version: '1',
  chainId,
  verifyingContract: SAFE_PROXY_FACTORY_ADDRESS,
});

export const ensureAuthTypes = {
  NexusSafeEnsure: [
    { name: 'owner', type: 'address' },
    { name: 'safeAddress', type: 'address' },
    { name: 'saltNonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

export function buildEnsureAuthDigest(params: EnsureAuthParams): Hex {
  return hashTypedData({
    domain: ensureAuthDomain(params.chainId),
    types: ensureAuthTypes,
    primaryType: 'NexusSafeEnsure',
    message: {
      owner: params.owner,
      safeAddress: params.safe,
      saltNonce: params.saltNonce,
      deadline: params.deadline,
    },
  });
}

// EIP-712 typed-data signature. Local accounts produce it via `signTypedData`; browser wallets
// produce the byte-identical signature via `eth_signTypedData_v4`, which is the broadly-supported
// path (whereas raw-hash signing isn't available in standard wallets).
export async function signEnsureAuth(
  account: LocalAccount,
  params: EnsureAuthParams
): Promise<Hex> {
  return account.signTypedData({
    domain: ensureAuthDomain(params.chainId),
    types: ensureAuthTypes,
    primaryType: 'NexusSafeEnsure',
    message: {
      owner: params.owner,
      safeAddress: params.safe,
      saltNonce: params.saltNonce,
      deadline: params.deadline,
    },
  });
}
