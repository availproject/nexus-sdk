import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { OrchestratorStatus, ReviewStatus } from '../types';

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
  // User rejection patterns
  USER_REJECTED: [
    /user rejected/i,
    /user denied/i,
    /user cancelled/i,
    /user refused/i,
    /action_rejected/i,
    /userRejectedRequest/i,
  ],

  // Network/connection issues
  NETWORK_ERROR: [
    /network error/i,
    /connection failed/i,
    /fetch failed/i,
    /network request failed/i,
    /rpc error/i,
    /timeout/i,
  ],

  // Insufficient funds/gas
  INSUFFICIENT_FUNDS: [
    /insufficient funds/i,
    /insufficient balance/i,
    /not enough/i,
    /exceeds balance/i,
  ],

  // Gas related errors
  GAS_ERROR: [
    /gas required exceeds allowance/i,
    /out of gas/i,
    /gas estimation failed/i,
    /gas limit/i,
  ],

  // Transaction failures
  TRANSACTION_FAILED: [
    /transaction failed/i,
    /transaction reverted/i,
    /execution reverted/i,
    /transaction underpriced/i,
  ],

  // Allowance/approval errors
  ALLOWANCE_ERROR: [/allowance/i, /approval/i, /approve/i],

  // Contract/smart contract errors
  CONTRACT_ERROR: [/contract/i, /invalid address/i, /abi/i],

  // Chain-related errors
  CHAIN_ERROR: [
    /unrecognized chain id/i,
    /unsupported chain/i,
    /chain not found/i,
    /invalid chain/i,
    /try adding the chain using wallet_addEthereumChain/i,
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
  UNKNOWN: 'An unexpected error occurred. Please try again.',
} as const;

/**
 * Extract meaningful information from error messages while removing technical details
 */
function cleanErrorMessage(message: string): string {
  // Remove version information
  message = message.replace(/Version: [^\s]+/gi, '');

  // Remove SDK/library references
  message = message.replace(/viem@[^\s]+/gi, '');
  message = message.replace(/arcana@[^\s]+/gi, '');

  // Remove duplicate text (like "Details: User rejected the request." when already in main message)
  const lines = message.split(/[.\n]/).filter((line) => line.trim());
  const uniqueLines = [...new Set(lines.map((line) => line.trim()))];

  return uniqueLines.join('. ').trim();
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
 * @param context - Optional context about where the error occurred (e.g., 'transaction', 'allowance')
 * @returns A user-friendly error message
 */
export function formatErrorForUI(error: unknown, context?: string): string {
  let errorMessage = '';

  // Extract error message from different error types
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

  // Clean the error message first
  const cleanedMessage = cleanErrorMessage(errorMessage);

  // Categorize and get user-friendly message
  const category = categorizeError(cleanedMessage);
  const userFriendlyMessage = USER_FRIENDLY_MESSAGES[category];

  // For certain categories, we might want to include some context
  if (category === 'UNKNOWN' && cleanedMessage && cleanedMessage.length < 100) {
    // If it's a short, clean message that we don't recognize, show it as-is
    return cleanedMessage;
  }

  // Add context if provided and relevant
  if (context && category !== 'USER_REJECTED') {
    return `${userFriendlyMessage} (${context})`;
  }

  return userFriendlyMessage;
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
 * Extract chain ID from error message
 * Supports both hex (0x...) and decimal formats
 */
export function extractChainIdFromError(error: unknown): number | null {
  const errorMessage = error instanceof Error ? error.message : String(error);

  // Look for hex chain ID patterns like "0x8274f"
  const hexMatch = errorMessage.match(/(?:chain id|chainid)\s*["']?(0x[a-f0-9]+)["']?/i);
  if (hexMatch) {
    const chainId = parseInt(hexMatch[1], 16);
    return isNaN(chainId) ? null : chainId;
  }

  // Look for decimal chain ID patterns
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
  // Import here to avoid circular dependency
  const { CHAIN_METADATA } = await import('../../constants');

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
