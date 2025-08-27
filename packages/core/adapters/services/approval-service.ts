import { BaseService } from '../core/base-service';
import {
  getTokenContractAddress,
  extractErrorMessage,
  logger,
  TOKEN_METADATA,
  type ApprovalResult,
  type ApprovalInfo,
  type SUPPORTED_TOKENS,
  type SUPPORTED_CHAINS_IDS,
} from '@nexus/commons';
import { parseUnits, formatUnits } from 'viem';

/**
 * Internal constants for ERC20 function selectors
 */
const FUNCTION_SELECTORS = {
  ALLOWANCE: '0xdd62ed3e', // allowance(address,address)
  APPROVE: '0x095ea7b3', // approve(address,uint256)
} as const;

/**
 * Internal constants for adapter behavior
 */
const ADAPTER_CONSTANTS = {
  // Default 1% buffer (100 bps). Can be overridden per-call via ExecuteParams.approvalBufferBps
  APPROVAL_BUFFER_BPS_DEFAULT: 100n,
  DEFAULT_DECIMALS: 18,
  MAX_APPROVAL_AMOUNT: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
} as const;

/**
 * Service responsible for handling contract approvals
 */
export class ApprovalService extends BaseService {
  /**
   * Check if approval is needed for a token spending operation
   */
  async checkApprovalNeeded(
    tokenApproval: { token: SUPPORTED_TOKENS; amount: string },
    spenderAddress: string,
    chainId: number,
    approvalBufferBps?: number,
  ): Promise<ApprovalInfo> {
    this.ensureInitialized();

    const accounts = (await this.evmProvider.request({
      method: 'eth_accounts',
    })) as string[];

    if (!accounts || accounts.length === 0) {
      throw new Error('No accounts available');
    }

    const ownerAddress = accounts[0];
    const tokenContractAddress = getTokenContractAddress(
      tokenApproval.token,
      chainId as SUPPORTED_CHAINS_IDS,
    );

    if (!tokenContractAddress) {
      throw new Error(
        `Token contract address not found for ${tokenApproval.token} on chain ${chainId}`,
      );
    }

    try {
      // Convert amount to proper token units - handle both decimal and integer formats
      let amountInWei: bigint;

      // Get token metadata for decimal handling
      const tokenMetadata = TOKEN_METADATA[tokenApproval.token.toUpperCase()];
      const decimals = tokenMetadata?.decimals || ADAPTER_CONSTANTS.DEFAULT_DECIMALS;

      try {
        // Handle both decimal strings (user-friendly) and integer strings (already converted)
        // This matches the logic from the legacy adapter
        if (tokenApproval.amount.includes('.')) {
          // Decimal amount - user-friendly format like "0.01"
          amountInWei = parseUnits(tokenApproval.amount, decimals);
        } else {
          // Integer amount - likely already in wei/micro format like "10000"
          amountInWei = BigInt(tokenApproval.amount);
        }
      } catch (error) {
        throw new Error(
          `Failed to parse amount ${tokenApproval.amount} for ${tokenApproval.token}: ${extractErrorMessage(error, 'amount parsing')}`,
        );
      }

      // Prepare the allowance call data
      const allowanceCallData = `${FUNCTION_SELECTORS.ALLOWANCE}${ownerAddress.slice(2).padStart(64, '0')}${spenderAddress.slice(2).padStart(64, '0')}`;

      // Call the contract to get current allowance
      const allowanceResponse = await this.evmProvider.request({
        method: 'eth_call',
        params: [
          {
            to: tokenContractAddress,
            data: allowanceCallData,
          },
          'latest',
        ],
      });

      const currentAllowance = BigInt(allowanceResponse as string);

      // Add a small buffer to avoid repeated approvals due to minor amount differences
      const bufferBps =
        approvalBufferBps !== undefined && approvalBufferBps >= 0
          ? BigInt(approvalBufferBps)
          : ADAPTER_CONSTANTS.APPROVAL_BUFFER_BPS_DEFAULT;
      const requiredAmountWithBuffer = amountInWei + (amountInWei * bufferBps) / 10000n;

      const needsApproval = currentAllowance < requiredAmountWithBuffer;

      return {
        needsApproval,
        currentAllowance,
        requiredAmount: amountInWei,
        tokenAddress: tokenContractAddress,
        spenderAddress,
        token: tokenApproval.token,
        chainId,
        hasPendingApproval: !needsApproval,
      };
    } catch (error) {
      throw new Error(
        `Failed to check approval for ${tokenApproval.token}: ${extractErrorMessage(error, 'approval check')}`,
      );
    }
  }

  /**
   * Ensure contract approval is in place for token spending
   */
  async ensureContractApproval(
    tokenApproval: { token: SUPPORTED_TOKENS; amount: string },
    spenderAddress: string,
    chainId: number,
    waitForConfirmation: boolean = false,
    approvalBufferBps?: number,
  ): Promise<ApprovalResult> {
    this.ensureInitialized();

    try {
      // Check if approval is needed
      const approvalInfo = await this.checkApprovalNeeded(
        tokenApproval,
        spenderAddress,
        chainId,
        approvalBufferBps,
      );

      // Skip approval if sufficient allowance exists
      if (!approvalInfo.needsApproval) {
        return {
          wasNeeded: false,
          confirmed: true,
        };
      }

      const accounts = (await this.evmProvider.request({
        method: 'eth_accounts',
      })) as string[];

      if (!accounts || accounts.length === 0) {
        return {
          wasNeeded: true,
          error: 'No accounts available',
        };
      }

      const fromAddress = accounts[0];

      // Calculate buffer amount with proper decimal handling for MetaMask display
      const bufferBps =
        approvalBufferBps !== undefined && approvalBufferBps >= 0
          ? BigInt(approvalBufferBps)
          : ADAPTER_CONSTANTS.APPROVAL_BUFFER_BPS_DEFAULT;
      const requiredAmountWithBuffer =
        approvalInfo.requiredAmount + (approvalInfo.requiredAmount * bufferBps) / 10000n;

      // Get token decimals for proper formatting
      const tokenMetadata = TOKEN_METADATA[tokenApproval.token.toUpperCase()];
      const tokenDecimals = tokenMetadata?.decimals || ADAPTER_CONSTANTS.DEFAULT_DECIMALS;
      // Convert to human-readable format first, then back to wei for better MetaMask display
      // This ensures MetaMask shows "0.01001" instead of "10100"
      const humanReadableAmount = formatUnits(requiredAmountWithBuffer, tokenDecimals);
      logger.info('DEBUG approval - Human readable amount for MetaMask:', {
        humanReadableAmount,
        token: tokenApproval.token,
      });

      // Convert back to wei for the transaction
      const finalApprovalAmount = parseUnits(humanReadableAmount, tokenDecimals);
      const approvalAmount = finalApprovalAmount.toString(16).padStart(64, '0');

      // Prepare approval transaction data
      const approvalCallData = `${FUNCTION_SELECTORS.APPROVE}${spenderAddress.slice(2).padStart(64, '0')}${approvalAmount}`;

      const approvalTxParams = {
        from: fromAddress,
        to: approvalInfo.tokenAddress,
        data: approvalCallData,
        value: '0x0',
      };

      logger.info('DEBUG approval - Sending approval transaction:', {
        token: tokenApproval.token,
        humanAmount: humanReadableAmount,
        spender: spenderAddress,
        chainId,
      });

      // Send approval transaction
      const txResponse = await this.evmProvider.request({
        method: 'eth_sendTransaction',
        params: [approvalTxParams],
      });

      let transactionHash: string;
      if (typeof txResponse === 'string') {
        transactionHash = txResponse;
      } else if (txResponse && typeof txResponse === 'object' && 'hash' in txResponse) {
        transactionHash = txResponse.hash as string;
      } else {
        return {
          wasNeeded: true,
          error: 'Invalid transaction response format',
        };
      }

      logger.info('DEBUG approval - Transaction sent:', transactionHash);

      // Wait for confirmation if requested
      let confirmed = false;
      let receiptStatus: string | undefined;

      if (waitForConfirmation) {
        try {
          let attempts = 0;
          const maxAttempts = 60; // 60 seconds timeout for approval

          while (attempts < maxAttempts) {
            try {
              const receipt = await this.evmProvider.request({
                method: 'eth_getTransactionReceipt',
                params: [transactionHash],
              });

              if (receipt && typeof receipt === 'object') {
                const receiptObj = receipt as unknown as { status: string };
                receiptStatus = receiptObj.status;

                // Check if transaction was successful (status: "0x1") or failed (status: "0x0")
                if (receiptStatus === '0x1') {
                  confirmed = true;
                  logger.info('DEBUG approval - Transaction confirmed successfully');
                  break;
                } else if (receiptStatus === '0x0') {
                  logger.info('DEBUG approval - Transaction failed on chain');
                  return {
                    transactionHash,
                    wasNeeded: true,
                    confirmed: false,
                    error: 'Approval transaction failed on blockchain',
                  };
                }
              }
            } catch (receiptError) {
              // Receipt not available yet, continue waiting
            }

            await new Promise((resolve) => setTimeout(resolve, 1000));
            attempts++;
          }

          if (!confirmed && attempts >= maxAttempts) {
            logger.info('DEBUG approval - Transaction timeout');
            return {
              transactionHash,
              wasNeeded: true,
              confirmed: false,
              error: 'Approval transaction confirmation timeout',
            };
          }
        } catch (confirmationError) {
          logger.warn('DEBUG approval - Confirmation failed:', confirmationError);
          return {
            transactionHash,
            wasNeeded: true,
            confirmed: false,
            error: `Approval confirmation failed: ${extractErrorMessage(confirmationError, 'approval confirmation')}`,
          };
        }
      }

      return {
        transactionHash,
        wasNeeded: true,
        confirmed,
      };
    } catch (error) {
      logger.error('DEBUG approval - Error:', error as Error);
      return {
        wasNeeded: true,
        error: extractErrorMessage(error, 'contract approval'),
      };
    }
  }
}
