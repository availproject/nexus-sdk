import type { Hex } from 'viem';

export type GetSafeAccountAddressRequest = {
  chainId: number;
  owner: Hex;
};

export type GetSafeAccountAddressResponse = {
  chainId: number;
  owner: Hex;
  address: Hex;
  factoryAddress: Hex;
  exists: boolean;
};

export type EnsureSafeAccountRequest = {
  chainId: number;
  owner: Hex;
  safeAddress: Hex;
  saltNonce: Hex; // 32-byte hex (66 chars)
  deadline: Hex; // 32-byte hex (66 chars)
  signature: Hex; // 65-byte hex (132 chars)
};

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

export type CreateSafeExecuteTxResponse = {
  chainId: number;
  safeAddress: Hex;
  txHash: Hex;
};
