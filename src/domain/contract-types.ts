import type { Hex } from 'viem';

export type GetAllowanceParams = {
  contractAddress: Hex;
  spender: Hex;
  owner: Hex;
};
