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
import { ChainAbstractionAdapter } from 'adapters/chain-abstraction-adapter';
import { parseUnits, formatUnits, erc20Abi, Hex } from 'viem';

/**
 * Internal constants for adapter behavior
 */
const ADAPTER_CONSTANTS = {
  // Default 2% buffer (200 bps) to handle precision issues. Can be overridden per-call via ExecuteParams.approvalBufferBps
  APPROVAL_BUFFER_BPS_DEFAULT: 200n,
  DEFAULT_DECIMALS: 18,
  MAX_APPROVAL_AMOUNT: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
} as const;

/**
 * Service responsible for handling contract approvals
 */
export class ApprovalService {
  constructor(private adapter: ChainAbstractionAdapter) {}

  /**
   * Check if approval is needed for a token spending operation
   */
  async checkApprovalNeeded(
    tokenApproval: { token: SUPPORTED_TOKENS; amount: string },
    spenderAddress: string,
    chainId: number,
    approvalBufferBps?: number,
  ): Promise<ApprovalInfo> {
    const accounts = await this.adapter.nexusSDK.getEVMClient().getAddresses();

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
          // For USDC and other 6-decimal tokens, check if this is already in micro-units
          const amountNum = BigInt(tokenApproval.amount);
          const USDC_THRESHOLD = 1_000_000n; // 1 USDC in micro-units

          if (decimals === 6 && amountNum > USDC_THRESHOLD) {
            // For USDC, large numbers are likely already in micro-units
            amountInWei = amountNum;
          } else if (decimals === 18 && amountNum > 1_000_000_000_000_000_000n) {
            // For ETH, large numbers are likely already in wei
            amountInWei = amountNum;
          } else {
            // Small numbers are likely user amounts that need conversion
            amountInWei = parseUnits(tokenApproval.amount, decimals);
          }
        }
      } catch (error) {
        throw new Error(
          `Failed to parse amount ${tokenApproval.amount} for ${tokenApproval.token}: ${extractErrorMessage(error, 'amount parsing')}`,
        );
      }

      const currentAllowance = await this.adapter.nexusSDK.getEVMClient().readContract({
        address: tokenContractAddress as Hex,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [ownerAddress as Hex, spenderAddress as Hex],
      });

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

      const accounts = await this.adapter.nexusSDK.getEVMClient().getAddresses();

      if (!accounts || accounts.length === 0) {
        return {
          wasNeeded: true,
          error: 'No accounts available',
        };
      }

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

      const chain = this.adapter.nexusSDK.chainList.getChainByID(chainId);
      if (!chain) {
        throw new Error('chain not supported');
      }
      const transactionHash = await this.adapter.nexusSDK.getEVMClient().writeContract({
        functionName: 'approve',
        abi: erc20Abi,
        address: approvalInfo.tokenAddress as Hex,
        args: [spenderAddress as Hex, finalApprovalAmount],
        chain,
        account: accounts[0],
      });

      if (waitForConfirmation) {
        try {
          await this.adapter.nexusSDK.getEVMClient().waitForTransactionReceipt({
            hash: transactionHash,
            retryCount: 10,
          });
        } catch (confirmationError) {
          logger.warn('DEBUG approval - Confirmation failed:', confirmationError);
          return {
            transactionHash,
            wasNeeded: true,
            confirmed: false,
            error: `Approval confirmation failed: ${extractErrorMessage(confirmationError, 'approval confirmation')}`,
          };
        }

        return {
          transactionHash,
          wasNeeded: true,
          confirmed: true,
        };
      }
      return {
        transactionHash,
        wasNeeded: false,
        confirmed: false,
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
