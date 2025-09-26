import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { OrchestratorStatus, ReviewStatus, SwapInputData } from '../types';
import { Abi, isAddress } from 'viem';
import {
  type BridgeParams,
  type TransferParams,
  type BridgeAndExecuteParams,
  CHAIN_METADATA,
} from '@nexus/commons';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const getButtonText = (status: OrchestratorStatus, reviewStatus: ReviewStatus) => {
  if (status === 'initializing') return 'Sign';
  if (status === 'simulation_error') return 'Try Again';
  if (reviewStatus === 'gathering_input') return 'Start Transaction';
  if (reviewStatus === 'simulating') return 'Simulating...';
  if (reviewStatus === 'needs_allowance') return 'Approve and Continue';
  if (reviewStatus === 'ready') return 'Start Transaction';
  return 'Continue';
};

export const getOperationText = (type: string) => {
  switch (type) {
    case 'bridge':
      return 'Bridging';
    case 'transfer':
      return 'Transferring';
    case 'bridgeAndExecute':
      return 'Bridge & Execute';
    case 'swap':
      return 'Swapping';
    default:
      return 'Processing';
  }
};

export const getStatusText = (stepData: any, operationType: string) => {
  if (!stepData) return 'Verifying Request';

  const { type } = stepData;
  const opText = getOperationText(operationType);

  switch (type) {
    case 'INTENT_ACCEPTED':
      return 'Intent Accepted';
    case 'INTENT_HASH_SIGNED':
      return 'Signing Transaction';
    case 'INTENT_SUBMITTED':
      return 'Submitting Transaction';
    case 'INTENT_COLLECTION':
      return 'Collecting Confirmations';
    case 'INTENT_COLLECTION_COMPLETE':
      return 'Confirmations Complete';
    case 'APPROVAL':
      return 'Approving';
    case 'TRANSACTION_SENT':
      return 'Sending Transaction';
    case 'RECEIPT_RECEIVED':
      return 'Receipt Received';
    case 'TRANSACTION_CONFIRMED':
    case 'INTENT_FULFILLED':
      return `${opText} Complete`;
    default:
      return `Processing ${opText}`;
  }
};

/**
 * Common error patterns and their user-friendly messages
 */
const ERROR_PATTERNS = {
  USER_REJECTED: [
    /user rejected/i,
    /user denied/i,
    /user cancelled/i,
    /user refused/i,
    /action_rejected/i,
    /userRejectedRequest/i,
    /transaction rejected by user/i,
    /user rejected transaction/i,
    /user canceled/i,
  ],
  NETWORK_ERROR: [
    /network error/i,
    /connection failed/i,
    /fetch failed/i,
    /network request failed/i,
    /rpc error/i,
    /timeout/i,
    /backend initialization failed/i,
    /simulation client error/i,
  ],
  INSUFFICIENT_FUNDS: [
    /insufficient funds/i,
    /insufficient balance/i,
    /not enough/i,
    /exceeds balance/i,
    /balance too low/i,
    /you don't have enough/i,
    /sender doesn't have enough/i,
    /transfer amount exceeds balance/i,
    /erc20: transfer amount exceeds balance/i,
    /erc20.*insufficient/i,
  ],
  GAS_ERROR: [
    /gas required exceeds allowance/i,
    /out of gas/i,
    /gas estimation failed/i,
    /gas limit/i,
    /intrinsic gas too low/i,
  ],
  TRANSACTION_FAILED: [
    /transaction failed/i,
    /transaction reverted/i,
    /execution reverted/i,
    /transaction underpriced/i,
    /nonce too low/i,
    /call exception/i,
    /transaction was reverted/i,
    /replacement transaction underpriced/i,
    /already known/i,
    /reverted with reason/i,
    /transaction rejected/i,
    /transaction not mined within/i,
  ],
  ALLOWANCE_ERROR: [
    /allowance/i,
    /approval/i,
    /approve/i,
    /token approval failed/i,
    /insufficient allowance/i,
  ],
  CONTRACT_ERROR: [
    /contract/i,
    /invalid address/i,
    /abi/i,
    /function not found/i,
    /contract execution failed/i,
  ],
  CHAIN_ERROR: [
    /unrecognized chain id/i,
    /unsupported chain/i,
    /chain not found/i,
    /invalid chain/i,
    /try adding the chain using wallet_addEthereumChain/i,
    /wrong network/i,
    /switch to correct network/i,
  ],
  INIT_ERROR: [
    /initialization failed/i,
    /sdk not initialized/i,
    /provider not connected/i,
    /wallet provider not connected/i,
    /setup failed/i,
  ],
  BRIDGE_ERROR: [
    /bridge failed/i,
    /bridging error/i,
    /cross-chain error/i,
    /bridge transaction failed/i,
  ],
  EXECUTE_ERROR: [
    /execute failed/i,
    /execution error/i,
    /execute phase failed/i,
    /contract execution error/i,
  ],
  SWAP_ERROR: [
    /insufficient funds/i,
    /insufficient balance/i,
    /swap failed/i,
    /swap error/i,
    /vsc sbc tx/i,
    /swap transaction failed/i,
    /slippage/i,
    /price impact/i,
    /swap intent failed/i,
    /swap execution failed/i,
    /cot not present/i,
    /chain of trust not present/i,
  ],
} as const;

/**
 * User-friendly error messages
 */
const USER_FRIENDLY_MESSAGES = {
  USER_REJECTED: "Transaction was cancelled. Please try again when you're ready to proceed.",
  NETWORK_ERROR: 'Network connection issue. Please check your internet connection and try again.',
  INSUFFICIENT_FUNDS: "You don't have enough balance to complete this transaction.",
  GAS_ERROR: 'Transaction fee estimation failed. Please try again or adjust the gas settings.',
  TRANSACTION_FAILED: 'Transaction failed to execute. This might be a temporary network issue.',
  ALLOWANCE_ERROR: 'Token approval failed. Please try approving the token again.',
  CONTRACT_ERROR: 'Smart contract interaction failed. Please try again.',
  CHAIN_ERROR: 'This network is not added to your wallet. Please add it to continue.',
  INIT_ERROR: 'Wallet connection issue. Please make sure your wallet is connected and try again.',
  BRIDGE_ERROR: 'Cross-chain transfer failed. Please try again.',
  EXECUTE_ERROR: 'Smart contract execution failed. Please try again.',
  SWAP_ERROR:
    'Swap transaction failed. The destination chain may not support this token pair. Please try a different route.',
  UNKNOWN: 'An unexpected error occurred. Please try again.',
} as const;

/**
 * Extract meaningful information from error messages while removing technical details
 */
function cleanErrorMessage(message: string): string {
  // Remove version and package information
  message = message.replace(/Version: [^\s]+/gi, '');
  message = message.replace(/viem@[^\s]+/gi, '');
  message = message.replace(/arcana@[^\s]+/gi, '');

  // Remove common error prefixes that create noise
  message = message.replace(/^Error: /gi, '');
  message = message.replace(/^RPC Error: /gi, '');

  // Handle chained error messages - extract the most meaningful part
  // Pattern: "Operation failed: Phase failed: Actual error"
  const chainedErrorMatch = message.match(
    /([^:]+operation failed|[^:]+phase failed|[^:]+error):\s*(.+)/i,
  );
  if (chainedErrorMatch) {
    const [, , actualError] = chainedErrorMatch;
    // If the actual error is meaningful, use it; otherwise keep the chain
    if (actualError && actualError.length > 10 && !actualError.includes('failed')) {
      message = actualError.trim();
    }
  }

  // Remove redundant "failed" phrases that pile up
  message = message.replace(/\b(operation|phase|transaction|execution)\s+failed:\s*/gi, '');
  message = message.replace(/\bfailed:\s*/gi, '');

  // Split by common delimiters and clean up
  const lines = message.split(/[.\n]/).filter((line) => line.trim());
  const uniqueLines = [...new Set(lines.map((line) => line.trim()))];

  // Take the first meaningful line if we have multiple
  const meaningfulLine =
    uniqueLines.find(
      (line) =>
        line.length > 5 &&
        !line.toLowerCase().includes('operation failed') &&
        !line.toLowerCase().includes('phase failed'),
    ) || uniqueLines[0];

  return meaningfulLine?.trim() || message.trim();
}

/**
 * Determine the error category based on the error message
 */
function categorizeError(errorMessage: string): keyof typeof USER_FRIENDLY_MESSAGES {
  const message = errorMessage.toLowerCase();

  for (const [category, patterns] of Object.entries(ERROR_PATTERNS)) {
    if (patterns.some((pattern) => pattern.test(message))) {
      return category as keyof typeof USER_FRIENDLY_MESSAGES;
    }
  }

  return 'UNKNOWN';
}

/**
 * Format error messages to be user-friendly for display in UI components
 *
 * @param error - The error object or string from various sources (viem, Arcana SDK, etc.)
 * @param context - Optional context about where the error occurred (e.g., 'simulation', 'bridge', 'execute')
 * @returns A user-friendly error message
 */
export function formatErrorForUI(error: unknown, context?: string): string {
  let errorMessage = '';
  if (error instanceof Error) {
    errorMessage = error.message;
  } else if (typeof error === 'string') {
    errorMessage = error;
  } else if (error && typeof error === 'object') {
    // Handle structured error objects
    const errorObj = error as any;
    errorMessage = errorObj.message || errorObj.error || errorObj.details || String(error);
  } else {
    errorMessage = String(error);
  }

  // Log the original error for developers
  console.error('Error being formatted for UI:', { error, errorMessage, context });

  // Handle specific error cases before general categorization
  if (errorMessage.includes('COT not present') || errorMessage.includes('COT not available')) {
    return 'This token pair is not supported on the selected destination chain. Please try a different token or destination chain.';
  }

  const cleanedMessage = cleanErrorMessage(errorMessage);
  const category = categorizeError(cleanedMessage);
  let userFriendlyMessage = USER_FRIENDLY_MESSAGES[category];

  // For unknown errors, try to provide more meaningful messages
  if (category === 'UNKNOWN') {
    // If we have a clean, short message that's readable, use it
    if (cleanedMessage && cleanedMessage.length < 100 && cleanedMessage.length > 5) {
      // Check if it looks like a user-friendly error already
      if (
        !cleanedMessage.includes('0x') &&
        !cleanedMessage.includes('viem@') &&
        !cleanedMessage.includes('Error:')
      ) {
        return cleanedMessage;
      }
    }

    // Provide context-specific fallback for unknown errors
    if (context === 'simulation') {
      return 'Unable to simulate this transaction. Please verify your inputs and try again.';
    } else if (context === 'transaction') {
      return 'Transaction could not be completed. Please check your wallet and try again.';
    } else if (context === 'bridge') {
      return 'Cross-chain transfer failed. Please check network connectivity and try again.';
    } else if (context === 'execute') {
      return 'Smart contract execution failed. Please verify the transaction details.';
    }

    // Log unknown errors for debugging
    console.warn('Unknown error category detected:', {
      cleanedMessage,
      originalError: error,
      context,
    });
  }

  // Add context-specific messaging
  if (context && category !== 'USER_REJECTED') {
    const contextualMessage = getContextualErrorMessage(category, context);
    if (contextualMessage) {
      return contextualMessage;
    }
    return userFriendlyMessage;
  }

  return userFriendlyMessage;
}

/**
 * Get context-specific error messages for better user experience
 */
function getContextualErrorMessage(
  category: keyof typeof USER_FRIENDLY_MESSAGES,
  context: string,
): string | null {
  const contextMap: Record<string, Partial<Record<keyof typeof USER_FRIENDLY_MESSAGES, string>>> = {
    simulation: {
      NETWORK_ERROR: 'Unable to simulate transaction. Please check your connection and try again.',
      INSUFFICIENT_FUNDS: 'Simulation shows insufficient balance for this transaction.',
      GAS_ERROR: 'Unable to estimate transaction fees. Please try again.',
      CONTRACT_ERROR: 'Contract simulation failed. Please verify the contract details.',
      CHAIN_ERROR: 'Simulation failed due to network issues. Please add the required network.',
      INIT_ERROR: 'Please connect your wallet to simulate transactions.',
    },
    bridge: {
      NETWORK_ERROR: 'Bridge service is temporarily unavailable. Please try again.',
      INSUFFICIENT_FUNDS: 'Insufficient balance for cross-chain transfer.',
      BRIDGE_ERROR: 'Cross-chain transfer failed. Please try again.',
      CHAIN_ERROR: 'Source or destination network not supported in your wallet.',
    },
    execute: {
      CONTRACT_ERROR: 'Smart contract execution failed. Please verify the contract is correct.',
      GAS_ERROR: 'Execution failed due to gas issues. Please try again.',
      EXECUTE_ERROR: 'Contract interaction failed. Please try again.',
      ALLOWANCE_ERROR: 'Token approval required before execution.',
    },
    swap: {
      NETWORK_ERROR: 'Swap service is temporarily unavailable. Please try again.',
      INSUFFICIENT_FUNDS: 'Insufficient balance to complete the swap.',
      SWAP_ERROR: 'Swap failed. Please verify your token selection and amount.',
      GAS_ERROR: 'Swap failed due to gas issues. Please try again.',
      CONTRACT_ERROR: 'Swap contract interaction failed. Please try again.',
      ALLOWANCE_ERROR: 'Token approval required for swap.',
    },
    allowance: {
      ALLOWANCE_ERROR: 'Token approval transaction failed. Please try again.',
      GAS_ERROR: 'Approval failed due to insufficient gas. Please try again.',
      CONTRACT_ERROR: 'Token contract approval failed. Please verify the token.',
    },
    initialization: {
      INIT_ERROR: 'Wallet setup failed. Please reconnect your wallet and try again.',
      NETWORK_ERROR: 'Unable to connect to Nexus services. Please try again.',
      CHAIN_ERROR: 'Unsupported network. Please switch to a supported network.',
    },
  };

  const contextMessages = contextMap[context];
  return contextMessages?.[category] || null;
}

/**
 * Check if an error indicates user rejection/cancellation
 */
export function isUserRejectionError(error: unknown): boolean {
  const errorMessage = error instanceof Error ? error.message : String(error);
  return ERROR_PATTERNS.USER_REJECTED.some((pattern) => pattern.test(errorMessage));
}

/**
 * Check if an error is related to an unrecognized chain
 */
export function isChainError(error: unknown): boolean {
  const errorMessage = error instanceof Error ? error.message : String(error);
  return ERROR_PATTERNS.CHAIN_ERROR.some((pattern) => pattern.test(errorMessage));
}

/**
 * Format swap-specific error messages for better user experience
 *
 * @param error - The error object or string from swap operations
 * @returns A user-friendly error message specific to swap operations
 */
export function formatSwapError(error: unknown): string {
  // Use the general error formatter with swap context
  return formatErrorForUI(error, 'swap');
}

/**
 * Check if an error is swap-related
 */
export function isSwapError(error: unknown): boolean {
  const errorMessage = error instanceof Error ? error.message : String(error);
  return ERROR_PATTERNS.SWAP_ERROR.some((pattern) => pattern.test(errorMessage));
}

/**
 * Extract chain ID from error message
 * Supports both hex (0x...) and decimal formats
 */
export function extractChainIdFromError(error: unknown): number | null {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const hexMatch = errorMessage.match(/(?:chain id|chainid)\s*["']?(0x[a-f0-9]+)["']?/i);
  if (hexMatch) {
    const chainId = parseInt(hexMatch[1], 16);
    return isNaN(chainId) ? null : chainId;
  }
  const decimalMatch = errorMessage.match(/(?:chain id|chainid)\s*["']?(\d+)["']?/i);
  if (decimalMatch) {
    const chainId = parseInt(decimalMatch[1], 10);
    return isNaN(chainId) ? null : chainId;
  }

  return null;
}

/**
 * Add a chain to the user's wallet using wallet_addEthereumChain
 */
export async function addChainToWallet(
  chainId: number,
  provider: { request: (args: { method: string; params?: any[] }) => Promise<any> },
): Promise<boolean> {
  const chainMetadata = CHAIN_METADATA[chainId];
  if (!chainMetadata) {
    console.error(`Chain metadata not found for chain ID: ${chainId}`);
    return false;
  }

  if (!provider) {
    console.error('No provider available');
    return false;
  }

  try {
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: `0x${chainId.toString(16)}`,
          chainName: chainMetadata.name,
          nativeCurrency: chainMetadata.nativeCurrency,
          rpcUrls: chainMetadata.rpcUrls,
          blockExplorerUrls: chainMetadata.blockExplorerUrls,
          iconUrls: [chainMetadata.logo],
        },
      ],
    });
    return true;
  } catch (error) {
    console.error('Failed to add chain to wallet:', error);
    return false;
  }
}

/**
 * Find ABI fragment for given function name (optionally matching parameter count)
 */
export function findAbiFragment(abi: Abi, functionName: string, paramCount?: number) {
  return (abi as any[]).find(
    (item) =>
      item.type === 'function' &&
      item.name === functionName &&
      (paramCount === undefined || (item.inputs || []).length === paramCount),
  );
}

export const getContentKey = (status: string, additionalStates?: string[]): string => {
  if (['processing', 'success', 'error'].includes(status)) {
    return 'processor';
  }

  if (status === 'set_allowance') {
    return 'allowance';
  }

  if (additionalStates?.includes(status)) {
    return status;
  }

  return 'review';
};

export const formatCost = (cost: string) => {
  const numCost = parseFloat(cost);
  if (isNaN(numCost)) return 'Invalid';
  if (numCost < 0) return 'Invalid';
  if (numCost === 0) return 'Free';
  if (numCost < 0.001) return '< 0.001';
  return numCost.toFixed(6);
};

export function truncateAddress(
  address: string,
  startLength: number = 6,
  endLength: number = 4,
): string {
  if (!isAddress(address)) return address;

  if (address.length <= startLength + endLength + 2) return address;

  return `${address.slice(0, startLength)}...${address.slice(-endLength)}`;
}

export const getModalTitle = (status: OrchestratorStatus, modalTitle: string) => {
  if (status === 'set_allowance') return 'Approve Token Allowance';
  return modalTitle;
};

export const getPrimaryButtonText = (status: OrchestratorStatus, reviewStatus: ReviewStatus) => {
  if (status === 'set_allowance') return 'Approve & Continue';
  return getButtonText(status, reviewStatus);
};

// Union type utility functions for handling different transaction input structures
type TransactionInputData =
  | Partial<BridgeParams>
  | Partial<TransferParams>
  | Partial<BridgeAndExecuteParams>
  | Partial<SwapInputData>
  | null
  | undefined;

/**
 * Safely extract token field from union transaction input data
 */
export function getTokenFromInputData(data: TransactionInputData): string | undefined {
  if (!data) return undefined;

  // For SwapInputData, check fromTokenAddress first, then other fields
  if ('fromTokenAddress' in data && typeof data.fromTokenAddress === 'string') {
    return data.fromTokenAddress;
  }

  // For SwapConfig, check nested inputs structure
  if ('inputs' in data && data.inputs) {
    const inputs = data.inputs as any;
    return inputs.inputToken || inputs.fromToken || inputs.token || inputs.fromTokenAddress;
  }

  // For other transaction types, access directly
  if ('token' in data && typeof data.token === 'string') {
    return data.token;
  }

  return undefined;
}

/**
 * Safely extract amount field from union transaction input data
 */
export function getAmountFromInputData(data: TransactionInputData): string | number | undefined {
  if (!data) return undefined;

  // For SwapInputData, check fromAmount first, then amount
  if ('fromAmount' in data && data.fromAmount !== undefined) {
    return data.fromAmount;
  }

  // For SwapConfig, check nested inputs structure
  if ('inputs' in data && data.inputs) {
    const inputs = data.inputs as any;
    return inputs.amount || inputs.fromAmount;
  }

  // For other transaction types, access directly
  if ('amount' in data) {
    return data.amount;
  }

  return undefined;
}

/**
 * Safely extract chainId from union transaction input data
 */
export function getChainIdFromInputData(data: TransactionInputData): number | undefined {
  if (!data) return undefined;

  // For SwapConfig, check nested inputs structure first
  if ('inputs' in data && data.inputs) {
    const inputs = data.inputs as any;
    return inputs.chainId || inputs.toChainID;
  }

  // For other transaction types, access directly
  if ('chainId' in data && typeof data.chainId === 'number') {
    return data.chainId;
  }

  if ('toChainId' in data && typeof data.toChainId === 'number') {
    return data.toChainId;
  }

  return undefined;
}
