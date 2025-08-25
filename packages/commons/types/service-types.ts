import type { TransactionReceipt } from 'viem';
import type { SUPPORTED_TOKENS, EthereumProvider } from './index';

/**
 * Service-specific types for the adapter architecture
 */

/**
 * Transaction handling options
 */
export interface TransactionOptions {
  enableTransactionPolling?: boolean;
  transactionTimeout?: number;
  waitForReceipt?: boolean;
  receiptTimeout?: number;
  requiredConfirmations?: number;
}

/**
 * Transaction result with receipt information
 */
export interface TransactionResult {
  receipt?: TransactionReceipt;
  confirmations?: number;
  gasUsed?: string;
  effectiveGasPrice?: string;
}

/**
 * Execute preparation result
 */
export interface ExecutePreparation {
  provider: EthereumProvider;
  fromAddress: string;
  encodedData: `0x${string}`;
  value?: string;
}

/**
 * Approval transaction result
 */
export interface ApprovalResult {
  transactionHash?: string;
  wasNeeded: boolean;
  error?: string;
  confirmed?: boolean;
}

/**
 * Chain switching result
 */
export interface ChainSwitchResult {
  success: boolean;
  error?: string;
}

/**
 * Token approval info for service operations
 */
export interface TokenApprovalInfo {
  token: SUPPORTED_TOKENS;
  amount: string;
  spenderAddress: string;
  chainId: number;
}
