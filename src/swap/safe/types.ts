import type { Address, Hex } from 'viem';

/** @deprecated V1 Safe request. Use GetSafeAccountAddressV2Request. */
export type GetSafeAccountAddressRequest = {
  chainId: number;
  owner: Hex;
};

/** @deprecated V1 Safe response. Use GetSafeAccountAddressV2Response. */
export type GetSafeAccountAddressResponse = {
  chainId: number;
  owner: Hex;
  address: Hex;
  factoryAddress: Hex;
  exists: boolean;
};

/** @deprecated V1 Safe request. Use EnsureSafeAccountV2Request. */
export type EnsureSafeAccountRequest = {
  chainId: number;
  owner: Hex;
  safeAddress: Hex;
  saltNonce: Hex; // 32-byte hex (66 chars)
  deadline: Hex; // 32-byte hex (66 chars)
  signature: Hex; // 65-byte hex (132 chars)
};

/** @deprecated V1 Safe response. Use EnsureSafeAccountV2Response. */
export type EnsureSafeAccountResponse = {
  chainId: number;
  owner: Hex;
  address: Hex;
  factoryAddress: Hex;
  exists: boolean;
  // Non-null ONLY when our broadcast was the winning successful deploy. Race-loss (another caller
  // won) or already-deployed yield exists=true with deployTxHash undefined.
  deployTxHash?: Hex;
};

/** @deprecated V1 Safe request. Use CreateSafeExecuteTxV2Request. */
export type CreateSafeExecuteTxRequest = {
  chainId: number;
  safeAddress: Hex;
  to: Hex;
  value: Hex; // 32-byte hex
  data: Hex;
  operation: 0 | 1; // CALL=0, DELEGATECALL=1 (only with MultiSendCallOnly)
  safeTxGas: Hex; // 32-byte hex
  baseGas: Hex; // 32-byte hex
  gasPrice: Hex; // 32-byte hex
  gasToken: Hex;
  refundReceiver: Hex;
  signature: Hex; // variable-length Safe multisig blob
};

/** @deprecated V1 Safe response. Use CreateSafeExecuteTxV2Response. */
export type CreateSafeExecuteTxResponse = {
  chainId: number;
  safeAddress: Hex;
  txHash: Hex;
};

export type GetSafeAccountAddressV2Request = {
  chainId: number;
  eoaAddress: Address;
  ephemeralAddress: Address;
};

export type GetSafeAccountAddressV2Response = GetSafeAccountAddressV2Request & {
  address: Address;
  factoryAddress: Address;
  exists: boolean;
};

export type EnsureSafeAccountV2Request = GetSafeAccountAddressV2Request & {
  safeAddress: Address;
  deadline: string;
  signature: Hex;
};

export type EnsureSafeAccountV2Response = GetSafeAccountAddressV2Response & {
  deployTxHash?: Hex;
};

export type CreateSafeExecuteTxV2Request = GetSafeAccountAddressV2Request & {
  safeAddress: Address;
  to: Address;
  value: string;
  data: Hex;
  operation: 0 | 1;
  safeTxGas: string;
  baseGas: string;
  gasPrice: string;
  gasToken: Address;
  refundReceiver: Address;
  nonce: string;
  signature: Hex;
};

export type CreateSafeExecuteTxV2Response = {
  chainId: number;
  safeAddress: Address;
  txHash: Hex;
};
