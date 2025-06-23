import { BaseService } from '../core/base-service';
import { getTokenContractAddress, extractErrorMessage } from '../../utils';
import { parseUnits } from 'viem';
import type { SUPPORTED_TOKENS, ApprovalInfo } from '../../types';
import type { ApprovalResult } from '../types/service-types';

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
  APPROVAL_BUFFER_PERCENTAGE: 100n, // 1% buffer to avoid unnecessary re-approvals (represented as 1/100)
  DEFAULT_DECIMALS: 18, // Default token decimals when metadata is not available
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
  ): Promise<ApprovalInfo> {
    this.ensureInitialized();

    const accounts = (await this.evmProvider.request({
      method: 'eth_accounts',
    })) as string[];

    if (!accounts || accounts.length === 0) {
      throw new Error('No accounts available');
    }

    const ownerAddress = accounts[0];
    const tokenContractAddress = getTokenContractAddress(tokenApproval.token, chainId);

    if (!tokenContractAddress) {
      throw new Error(
        `Token contract address not found for ${tokenApproval.token} on chain ${chainId}`,
      );
    }

    try {
      // Convert amount to proper units based on token decimals
      let amountInWei: bigint;
      if (tokenApproval.token === 'ETH') {
        amountInWei = parseUnits(tokenApproval.amount, 18);
      } else if (tokenApproval.token === 'USDC') {
        amountInWei = parseUnits(tokenApproval.amount, 6);
      } else if (tokenApproval.token === 'USDT') {
        amountInWei = parseUnits(tokenApproval.amount, 6);
      } else {
        // Default to 18 decimals for unknown tokens
        amountInWei = parseUnits(tokenApproval.amount, ADAPTER_CONSTANTS.DEFAULT_DECIMALS);
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
      const requiredAmountWithBuffer =
        amountInWei + (amountInWei * ADAPTER_CONSTANTS.APPROVAL_BUFFER_PERCENTAGE) / 10000n;

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
  ): Promise<ApprovalResult> {
    this.ensureInitialized();

    try {
      // Check if approval is needed
      const approvalInfo = await this.checkApprovalNeeded(tokenApproval, spenderAddress, chainId);

      // Skip approval if sufficient allowance exists
      if (approvalInfo.hasPendingApproval) {
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

      // Use maximum uint256 for approval to avoid repeated approvals
      const maxApprovalAmount = ADAPTER_CONSTANTS.MAX_APPROVAL_AMOUNT;

      // Prepare approval transaction data
      const approvalCallData = `${FUNCTION_SELECTORS.APPROVE}${spenderAddress.slice(2).padStart(64, '0')}${maxApprovalAmount.slice(2)}`;

      const approvalTxParams = {
        from: fromAddress,
        to: approvalInfo.tokenAddress,
        data: approvalCallData,
        value: '0x0',
      };

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

      // Wait for confirmation if requested
      let confirmed = false;
      if (waitForConfirmation) {
        try {
          // Simple confirmation check - wait for transaction to be mined
          let attempts = 0;
          const maxAttempts = 30; // 30 seconds timeout

          while (attempts < maxAttempts) {
            try {
              const receipt = await this.evmProvider.request({
                method: 'eth_getTransactionReceipt',
                params: [transactionHash],
              });

              if (receipt) {
                confirmed = true;
                break;
              }
            } catch (receiptError) {
              // Receipt not available yet, continue waiting
            }

            await new Promise((resolve) => setTimeout(resolve, 1000));
            attempts++;
          }
        } catch (confirmationError) {
          // Confirmation failed, but approval transaction was sent
          console.warn('Approval confirmation failed:', confirmationError);
        }
      }

      return {
        transactionHash,
        wasNeeded: true,
        confirmed,
      };
    } catch (error) {
      return {
        wasNeeded: true,
        error: extractErrorMessage(error, 'contract approval'),
      };
    }
  }
}
