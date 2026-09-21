import type { Hex } from 'viem';

const normalizeAddress = (address: Hex): string => address.toLowerCase();

export const createExecuteApprovalStepId = (chainId: number, tokenAddress: Hex): string =>
  `execute_approval:${chainId}:${normalizeAddress(tokenAddress)}`;

export const createExecuteTransactionStepId = (chainId: number, to: Hex): string =>
  `execute_transaction:${chainId}:${normalizeAddress(to)}`;
