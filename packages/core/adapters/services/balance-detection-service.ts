import {
  getTokenContractAddress,
  TOKEN_METADATA,
  logger,
  type SUPPORTED_CHAINS_IDS,
  type SUPPORTED_TOKENS,
} from '@nexus/commons';
import { ChainAbstractionAdapter } from 'adapters/chain-abstraction-adapter';
import { Hex, erc20Abi } from 'viem';

/**
 * Detailed balance information for a user
 */
export interface DetailedBalanceInfo {
  token: SUPPORTED_TOKENS;
  chainId: number;
  userAddress: string;
  tokenAddress: string;
  balance: string;
  balanceFormatted: string;
  sufficient: boolean;
  shortfall: string;
  shortfallFormatted: string;
  decimals: number;
  isNative: boolean;
  lastChecked: string;
}

/**
 * Multi-token balance check result
 */
export interface MultiTokenBalanceResult {
  userAddress: string;
  chainId: number;
  balances: DetailedBalanceInfo[];
  totalSufficient: boolean;
  insufficientTokens: SUPPORTED_TOKENS[];
  lastChecked: string;
}

/**
 * Balance requirement specification
 */
export interface BalanceRequirement {
  token: SUPPORTED_TOKENS;
  amount: string;
  allowPartial?: boolean; // If true, partial balance is acceptable
}

/**
 * Smart balance detection and analysis service
 */
export class BalanceDetectionService {
  private adapter: ChainAbstractionAdapter;

  constructor(adapter: ChainAbstractionAdapter) {
    this.adapter = adapter;
  }

  private ensureInitialized() {
    if (!this.adapter.nexusSDK.isInitialized()) {
      throw new Error('Adapter not initialized');
    }
  }

  /**
   * Check detailed balance for a single token
   */
  async getDetailedBalance(
    userAddress: string,
    token: SUPPORTED_TOKENS,
    chainId: number,
    requiredAmount?: string,
  ): Promise<DetailedBalanceInfo> {
    this.ensureInitialized();

    try {
      logger.debug('DEBUG BalanceDetectionService - Checking balance:', {
        userAddress,
        token,
        chainId,
        requiredAmount,
      });

      const tokenAddress = getTokenContractAddress(token, chainId as SUPPORTED_CHAINS_IDS);
      if (!tokenAddress) {
        throw new Error(`Token ${token} not supported on chain ${chainId}`);
      }

      const isNative = token === 'ETH';
      const tokenMetadata = TOKEN_METADATA[token.toUpperCase()];
      const decimals = tokenMetadata?.decimals || 18;

      let balance: bigint;

      if (isNative) {
        // Get ETH balance
        balance = await this.adapter.nexusSDK.getEVMClient().getBalance({
          address: userAddress as Hex,
          blockTag: 'latest',
        });
      } else {
        // Get ERC20 token balance using balanceOf
        balance = await this.getERC20Balance(userAddress, tokenAddress);
      }

      const balanceBigInt = BigInt(balance);
      const balanceFormatted = this.formatTokenAmount(balance.toString(), decimals);

      // Calculate sufficiency and shortfall
      let sufficient = true;
      let shortfall = '0';
      let shortfallFormatted = '0';

      if (requiredAmount) {
        const requiredBigInt = BigInt(requiredAmount);
        sufficient = balanceBigInt >= requiredBigInt;

        if (!sufficient) {
          shortfall = (requiredBigInt - balanceBigInt).toString();
          shortfallFormatted = this.formatTokenAmount(shortfall, decimals);
        }
      }

      const result: DetailedBalanceInfo = {
        token,
        chainId,
        userAddress,
        tokenAddress,
        balance: balance.toString(),
        balanceFormatted,
        sufficient,
        shortfall,
        shortfallFormatted,
        decimals,
        isNative,
        lastChecked: new Date().toISOString(),
      };

      logger.info('DEBUG BalanceDetectionService - Balance check result:', {
        token,
        balance: balanceFormatted,
        sufficient,
        shortfall: shortfallFormatted,
      });

      return result;
    } catch (error) {
      logger.error(
        `Failed to get detailed balance for ${token}:`,
        error instanceof Error ? error : String(error),
      );

      // Return error state
      return {
        token,
        chainId,
        userAddress,
        tokenAddress: getTokenContractAddress(token, chainId as SUPPORTED_CHAINS_IDS) || '',
        balance: '0',
        balanceFormatted: '0',
        sufficient: false,
        shortfall: requiredAmount || '0',
        shortfallFormatted: '0',
        decimals: TOKEN_METADATA[token.toUpperCase()]?.decimals || 18,
        isNative: token === 'ETH',
        lastChecked: new Date().toISOString(),
      };
    }
  }

  /**
   * Check balances for multiple tokens
   */
  async getMultiTokenBalances(
    userAddress: string,
    chainId: number,
    requirements: BalanceRequirement[],
  ): Promise<MultiTokenBalanceResult> {
    this.ensureInitialized();

    logger.info('DEBUG BalanceDetectionService - Multi-token balance check:', {
      userAddress,
      chainId,
      requirements: requirements.length,
    });

    const balances: DetailedBalanceInfo[] = [];
    const insufficientTokens: SUPPORTED_TOKENS[] = [];

    // Check each token balance
    for (const requirement of requirements) {
      try {
        const balanceInfo = await this.getDetailedBalance(
          userAddress,
          requirement.token,
          chainId,
          requirement.amount,
        );

        balances.push(balanceInfo);

        // Track insufficient tokens (unless partial is allowed)
        if (!balanceInfo.sufficient && !requirement.allowPartial) {
          insufficientTokens.push(requirement.token);
        }
      } catch (error) {
        logger.error(
          `Failed to check balance for ${requirement.token}:`,
          error instanceof Error ? error : String(error),
        );
        insufficientTokens.push(requirement.token);
      }
    }

    const totalSufficient = insufficientTokens.length === 0;

    const result: MultiTokenBalanceResult = {
      userAddress,
      chainId,
      balances,
      totalSufficient,
      insufficientTokens,
      lastChecked: new Date().toISOString(),
    };

    logger.info('DEBUG BalanceDetectionService - Multi-token result:', {
      totalSufficient,
      insufficientCount: insufficientTokens.length,
      insufficientTokens,
    });

    return result;
  }

  /**
   * Get ERC20 token balance using balanceOf call
   */
  private async getERC20Balance(userAddress: string, tokenAddress: string): Promise<bigint> {
    try {
      const balance = await this.adapter.nexusSDK.getEVMClient().readContract({
        abi: erc20Abi,
        functionName: 'balanceOf',
        address: tokenAddress as Hex,
        args: [userAddress as Hex],
      });

      return balance;
    } catch (error) {
      logger.error(
        `Failed to get ERC20 balance for ${tokenAddress}:`,
        error instanceof Error ? error : String(error),
      );
      return 0n;
    }
  }

  /**
   * Format token amount from wei to human readable
   */
  private formatTokenAmount(amount: string, decimals: number): string {
    try {
      const amountBigInt = BigInt(amount);
      const divisor = BigInt(10) ** BigInt(decimals);

      // Handle whole number part
      const wholePart = amountBigInt / divisor;
      const fractionalPart = amountBigInt % divisor;

      if (fractionalPart === 0n) {
        return wholePart.toString();
      }

      // Convert fractional part to decimal string
      const fractionalStr = fractionalPart.toString().padStart(decimals, '0');
      const trimmedFractional = fractionalStr.replace(/0+$/, '');

      if (trimmedFractional === '') {
        return wholePart.toString();
      }

      return `${wholePart}.${trimmedFractional}`;
    } catch (error) {
      logger.error(
        'Failed to format token amount:',
        error instanceof Error ? error : String(error),
      );
      return '0';
    }
  }

  /**
   * Analyze balance gaps and suggest funding strategies
   */
  async analyzeBalanceGaps(
    userAddress: string,
    chainId: number,
    requirements: BalanceRequirement[],
  ): Promise<{
    analysis: MultiTokenBalanceResult;
    fundingStrategy: {
      totalFundingNeeded: boolean;
      tokenFunding: Array<{
        token: SUPPORTED_TOKENS;
        shortfall: string;
        shortfallFormatted: string;
        priority: 'high' | 'medium' | 'low';
        suggestionType: 'bridge' | 'swap' | 'acquire';
      }>;
    };
  }> {
    const analysis = await this.getMultiTokenBalances(userAddress, chainId, requirements);

    const tokenFunding = analysis.balances
      .filter((balance) => !balance.sufficient)
      .map((balance) => ({
        token: balance.token,
        shortfall: balance.shortfall,
        shortfallFormatted: balance.shortfallFormatted,
        priority: this.calculateFundingPriority(balance),
        suggestionType: this.suggestFundingMethod(balance.token),
      }));

    return {
      analysis,
      fundingStrategy: {
        totalFundingNeeded: !analysis.totalSufficient,
        tokenFunding,
      },
    };
  }

  /**
   * Calculate funding priority based on shortfall amount and token importance
   */
  private calculateFundingPriority(balance: DetailedBalanceInfo): 'high' | 'medium' | 'low' {
    const shortfallBigInt = BigInt(balance.shortfall);
    const divisor = BigInt(10) ** BigInt(balance.decimals);
    const shortfallNormalized = Number(shortfallBigInt) / Number(divisor);

    // High priority for native tokens or large amounts
    if (balance.isNative || shortfallNormalized > 1000) {
      return 'high';
    }

    // Medium priority for moderate amounts
    if (shortfallNormalized > 10) {
      return 'medium';
    }

    return 'low';
  }

  /**
   * Suggest the best funding method for a token on a specific chain
   */
  private suggestFundingMethod(token: SUPPORTED_TOKENS): 'bridge' | 'swap' | 'acquire' {
    // For now, simple logic - can be enhanced with actual bridge/swap availability
    if (token === 'ETH') {
      return 'acquire'; // Need to buy ETH
    }

    // For stablecoins, bridging is usually preferred
    if (token === 'USDC' || token === 'USDT') {
      return 'bridge';
    }

    // Default to swap for other tokens
    return 'swap';
  }

  /**
   * Check if user can afford a transaction including gas
   */
  async canAffordTransaction(
    userAddress: string,
    chainId: number,
    tokenRequirements: BalanceRequirement[],
    estimatedGasCost: string,
  ): Promise<{
    canAfford: boolean;
    tokenDeficits: DetailedBalanceInfo[];
    gasDeficit: string;
    totalDeficitValue?: string;
  }> {
    // Check token requirements
    const tokenAnalysis = await this.getMultiTokenBalances(userAddress, chainId, tokenRequirements);

    // Check ETH balance for gas
    const ethBalance = await this.getDetailedBalance(userAddress, 'ETH', chainId, estimatedGasCost);

    const canAfford = tokenAnalysis.totalSufficient && ethBalance.sufficient;
    const tokenDeficits = tokenAnalysis.balances.filter((b) => !b.sufficient);
    const gasDeficit = ethBalance.sufficient ? '0' : ethBalance.shortfall;

    return {
      canAfford,
      tokenDeficits,
      gasDeficit,
    };
  }
}
