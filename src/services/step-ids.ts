import type { Hex } from 'viem';

const normalizeAddress = (address: Hex): string => address.toLowerCase();

export const createAllowanceApprovalStepId = (chainId: number, tokenAddress: Hex): string =>
  `allowance_approval:${chainId}:${normalizeAddress(tokenAddress)}`;

export const createRequestSigningStepId = (): string => 'request_signing';

export const createRequestSubmissionStepId = (): string => 'request_submission';

export const createVaultDepositStepId = (chainId: number, tokenAddress: Hex): string =>
  `vault_deposit:${chainId}:${normalizeAddress(tokenAddress)}`;

export const createBridgeFillStepId = (destinationChainId: number): string =>
  `bridge_fill:${destinationChainId}`;

export const createExecuteApprovalStepId = (chainId: number, tokenAddress: Hex): string =>
  `execute_approval:${chainId}:${normalizeAddress(tokenAddress)}`;

export const createExecuteTransactionStepId = (chainId: number, to: Hex): string =>
  `execute_transaction:${chainId}:${normalizeAddress(to)}`;

export const createSourceSwapStepId = (chainId: number): string => `source_swap:${chainId}`;

export const createEoaToEphemeralTransferStepId = (chainId: number): string =>
  `eoa_to_ephemeral_transfer:${chainId}`;

export const createBridgeDepositStepId = (chainId: number): string => `bridge_deposit:${chainId}`;

export const createBridgeIntentSubmissionStepId = (): string => 'bridge_intent_submission';

export const createDestinationSwapStepId = (chainId: number): string =>
  `destination_swap:${chainId}`;
