import type { Hex } from 'viem';

export type GetAllowanceParams = {
  contractAddress: Hex;
  spender: Hex;
  owner: Hex;
};

export type SetAllowanceParams = {
  contractAddress: Hex;
  spender: Hex;
  owner: Hex;
  amount: bigint;
};

// ABI-compatible Vault.Request payload for EVM deposits.
export type VaultSourcePair = {
  universe: number;
  chainID: bigint;
  contractAddress: Hex;
  value: bigint;
  fee: bigint;
};

export type VaultDestinationPair = {
  contractAddress: Hex;
  value: bigint;
};

export type VaultParty = {
  universe: number;
  address_: Hex;
};

export type DepositRequest = {
  sources: VaultSourcePair[];
  destinations: VaultDestinationPair[];
  destinationUniverse: number;
  destinationChainID: bigint;
  recipientAddress: Hex;
  nonce: bigint;
  expiry: bigint;
  parties: VaultParty[];
};
