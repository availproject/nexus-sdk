import { Hex } from 'viem';

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
