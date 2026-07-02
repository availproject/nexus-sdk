import { type Address, type Hex, hashTypedData, type LocalAccount, zeroAddress } from 'viem';
import type { SafeOperation } from './constants';

export type SafeTxFields = {
  to: Address;
  value: bigint;
  data: Hex;
  operation: SafeOperation;
  safeTxGas: bigint;
  baseGas: bigint;
  gasPrice: bigint;
  gasToken: Address;
  refundReceiver: Address;
  nonce: bigint;
};

// Safe v1.4.1 uses a minimal EIP-712 domain: no name, no version, only chainId + verifyingContract.
// Drift from this shape changes the domain separator and the signature won't verify on-chain.
export const safeDomain = (chainId: number | bigint, safeAddress: Address) => ({
  chainId: BigInt(chainId),
  verifyingContract: safeAddress,
});

export const safeTxTypes = {
  SafeTx: [
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'data', type: 'bytes' },
    { name: 'operation', type: 'uint8' },
    { name: 'safeTxGas', type: 'uint256' },
    { name: 'baseGas', type: 'uint256' },
    { name: 'gasPrice', type: 'uint256' },
    { name: 'gasToken', type: 'address' },
    { name: 'refundReceiver', type: 'address' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const;

export function hashSafeTx(args: {
  chainId: number | bigint;
  safeAddress: Address;
  fields: SafeTxFields;
}): Hex {
  return hashTypedData({
    domain: safeDomain(args.chainId, args.safeAddress),
    types: safeTxTypes,
    primaryType: 'SafeTx',
    message: args.fields,
  });
}

export async function signSafeTx(args: {
  account: LocalAccount;
  chainId: number | bigint;
  safeAddress: Address;
  fields: SafeTxFields;
}): Promise<Hex> {
  return args.account.signTypedData({
    domain: safeDomain(args.chainId, args.safeAddress),
    types: safeTxTypes,
    primaryType: 'SafeTx',
    message: args.fields,
  });
}

// Sponsored flow: refund-related fields stay zero so the Safe doesn't pay/refund anyone — the
// sponsor pays L1 gas via the middleware-broadcast tx.
export function buildDefaultSafeTxFields(args: {
  to: Address;
  value: bigint;
  data: Hex;
  operation: SafeOperation;
  nonce: bigint;
}): SafeTxFields {
  return {
    to: args.to,
    value: args.value,
    data: args.data,
    operation: args.operation,
    safeTxGas: 0n,
    baseGas: 0n,
    gasPrice: 0n,
    gasToken: zeroAddress,
    refundReceiver: zeroAddress,
    nonce: args.nonce,
  };
}
