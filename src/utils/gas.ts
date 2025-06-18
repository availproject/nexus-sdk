/**
 * Gas-related utilities for enhanced gas pricing, estimation, and formatting
 */

import {
  createPublicClient,
  custom,
  formatEther,
  formatGwei,
  type PublicClient,
  type Chain,
  type Address,
} from 'viem';
import { mainnet, polygon, arbitrum, optimism, base } from 'viem/chains';
import type { EthereumProvider, GasPriceStrategy, FeeData, GasPricingConfig } from '../types';

/**
 * Network congestion levels
 */
type CongestionLevel = 'low' | 'medium' | 'high' | 'extreme';

/**
 * Gas price multipliers based on strategy and congestion
 */
const GAS_MULTIPLIERS = {
  slow: { base: 1.0, priority: 1.0 },
  standard: { base: 1.1, priority: 1.2 },
  fast: { base: 1.25, priority: 1.5 },
  fastest: { base: 1.5, priority: 2.0 },
} as const;

/**
 * Congestion-based fee adjustments
 */
const CONGESTION_MULTIPLIERS = {
  low: 1.0,
  medium: 1.2,
  high: 1.5,
  extreme: 2.0,
} as const;

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get Viem chain configuration for supported chains
 */
export function getViemChain(chainId: number): Chain {
  switch (chainId) {
    case 1:
      return mainnet;
    case 137:
      return polygon;
    case 42161:
      return arbitrum;
    case 10:
      return optimism;
    case 8453:
      return base;
    default:
      // Return a basic chain config for unsupported chains
      return {
        id: chainId,
        name: `Chain ${chainId}`,
        nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
        rpcUrls: {
          default: { http: [] },
          public: { http: [] },
        },
      };
  }
}

/**
 * Create Viem public client from EthereumProvider
 */
export function createViemPublicClient(provider: EthereumProvider, chainId: number): PublicClient {
  return createPublicClient({
    chain: getViemChain(chainId),
    transport: custom(provider),
  });
}

/**
 * Enhanced network congestion detection using Viem
 */
export async function detectNetworkCongestion(client: PublicClient): Promise<CongestionLevel> {
  try {
    // Get fee history using Viem's built-in method
    const feeHistory = await client.getFeeHistory({
      blockCount: 4,
      rewardPercentiles: [25, 50, 75],
    });

    if (!feeHistory.baseFeePerGas || !feeHistory.gasUsedRatio) {
      return 'medium';
    }

    // Calculate average gas usage ratio
    const avgGasUsed =
      feeHistory.gasUsedRatio.reduce((a, b) => a + b, 0) / feeHistory.gasUsedRatio.length;

    // Calculate base fee trend
    const baseFees = feeHistory.baseFeePerGas.map((fee) => Number(fee));
    if (baseFees[0] === 0) {
      return 'medium'; // Default fallback for edge case
    }
    const feeIncrease = baseFees[baseFees.length - 1] / baseFees[0];

    // Determine congestion level
    if (avgGasUsed > 0.9 || feeIncrease > 1.5) return 'extreme';
    if (avgGasUsed > 0.8 || feeIncrease > 1.3) return 'high';
    if (avgGasUsed > 0.6 || feeIncrease > 1.1) return 'medium';
    return 'low';
  } catch (error) {
    console.warn('Failed to detect network congestion:', error);
    return 'medium';
  }
}

/**
 * Enhanced gas estimation using Viem with validation
 */
export async function estimateGasWithValidation(
  provider: EthereumProvider,
  params: {
    to: string;
    data: string;
    value?: string;
    from?: string;
  },
  chainId: number = 1,
): Promise<{ success: boolean; gasLimit?: string; error?: string }> {
  try {
    const client = createViemPublicClient(provider, chainId);

    // Use Viem's estimateGas with better error handling
    const gasEstimate = await client.estimateGas({
      account: params.from as Address,
      to: params.to as Address,
      data: params.data as `0x${string}`,
      value: params.value ? BigInt(params.value) : undefined,
    });

    // Add 20% buffer to gas estimate using Viem's BigInt handling
    const bufferedGas = (gasEstimate * 120n) / 100n;

    return {
      success: true,
      gasLimit: `0x${bufferedGas.toString(16)}`,
    };
  } catch (error) {
    // Viem provides detailed error messages
    const errorMessage =
      error instanceof Error
        ? error.message
        : (error as { shortMessage?: string; message?: string })?.shortMessage ||
          (error as { shortMessage?: string; message?: string })?.message ||
          'Gas estimation failed';
    return {
      success: false,
      error: `Gas estimation failed: ${errorMessage}`,
    };
  }
}

/**
 * Get EIP-1559 fee data using Viem's built-in estimation
 */
export async function getEIP1559FeeDataWithViem(
  client: PublicClient,
  strategy: GasPriceStrategy,
  priorityMultiplier: number,
  baseMultiplier: number,
): Promise<{ success: boolean; feeData?: FeeData; error?: string }> {
  try {
    // Use Viem's estimateFeesPerGas for accurate EIP-1559 estimation
    const fees = await client.estimateFeesPerGas();

    if (!fees.maxFeePerGas || !fees.maxPriorityFeePerGas) {
      return { success: false, error: 'EIP-1559 fees not available' };
    }

    // Detect network congestion for additional adjustments
    const congestion = await detectNetworkCongestion(client);
    const congestionMultiplier = CONGESTION_MULTIPLIERS[congestion];
    const strategyMultipliers = GAS_MULTIPLIERS[strategy];

    // Apply strategy and congestion multipliers
    const adjustedMaxFee =
      (fees.maxFeePerGas *
        BigInt(
          Math.floor(strategyMultipliers.base * baseMultiplier * congestionMultiplier * 100),
        )) /
      100n;

    const adjustedPriorityFee =
      (fees.maxPriorityFeePerGas *
        BigInt(
          Math.floor(
            strategyMultipliers.priority * priorityMultiplier * congestionMultiplier * 100,
          ),
        )) /
      100n;

    return {
      success: true,
      feeData: {
        maxFeePerGas: `0x${adjustedMaxFee.toString(16)}`,
        maxPriorityFeePerGas: `0x${adjustedPriorityFee.toString(16)}`,
        type: 'eip1559',
      },
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : (error as { shortMessage?: string; message?: string })?.shortMessage ||
          (error as { shortMessage?: string; message?: string })?.message ||
          'EIP-1559 estimation failed';
    return { success: false, error: `EIP-1559 fee calculation failed: ${errorMessage}` };
  }
}

/**
 * Get legacy gas price using Viem
 */
export async function getLegacyGasPriceWithViem(
  client: PublicClient,
  strategy: GasPriceStrategy,
): Promise<{ success: boolean; feeData?: FeeData; error?: string }> {
  try {
    // Use Viem's getGasPrice method
    const gasPrice = await client.getGasPrice();

    // Apply strategy multiplier
    const multiplier = GAS_MULTIPLIERS[strategy].base;
    const adjustedPrice = (gasPrice * BigInt(Math.floor(multiplier * 100))) / 100n;

    return {
      success: true,
      feeData: {
        gasPrice: `0x${adjustedPrice.toString(16)}`,
        type: 'legacy',
      },
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : (error as { shortMessage?: string; message?: string })?.shortMessage ||
          (error as { shortMessage?: string; message?: string })?.message ||
          'Legacy gas price fetch failed';
    return { success: false, error: errorMessage };
  }
}

/**
 * Enhanced gas price fetching with Viem and EIP-1559 support
 */
export async function getEnhancedGasPrice(
  provider: EthereumProvider,
  config: GasPricingConfig = {},
  chainId: number = 1,
): Promise<{ success: boolean; feeData?: FeeData; error?: string }> {
  const {
    strategy = 'standard',
    maxGasPrice,
    priorityFeeMultiplier = 1.0,
    baseFeeMultiplier = 1.0,
    retryAttempts = 3,
    fallbackToLegacy = true,
  } = config;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retryAttempts; attempt++) {
    try {
      const client = createViemPublicClient(provider, chainId);

      // Try EIP-1559 first using Viem's fee estimation
      try {
        const feeData = await getEIP1559FeeDataWithViem(
          client,
          strategy,
          priorityFeeMultiplier,
          baseFeeMultiplier,
        );

        if (feeData.success) {
          // Apply max gas price limit if specified
          if (maxGasPrice && feeData.feeData?.maxFeePerGas) {
            const maxFee = BigInt(feeData.feeData.maxFeePerGas);
            const limit = BigInt(maxGasPrice);
            if (maxFee > limit) {
              feeData.feeData.maxFeePerGas = maxGasPrice;
              // Adjust priority fee proportionally
              if (feeData.feeData.maxPriorityFeePerGas) {
                const priorityFee = BigInt(feeData.feeData.maxPriorityFeePerGas);
                const adjustedPriority = (priorityFee * limit) / maxFee;
                feeData.feeData.maxPriorityFeePerGas = `0x${adjustedPriority.toString(16)}`;
              }
            }
          }
          return feeData;
        }
      } catch (eip1559Error) {
        console.warn('EIP-1559 estimation failed, trying legacy:', eip1559Error);
      }

      // Fallback to legacy gas pricing using Viem
      if (fallbackToLegacy) {
        const legacyData = await getLegacyGasPriceWithViem(client, strategy);
        if (legacyData.success) {
          // Apply max gas price limit
          if (maxGasPrice && legacyData.feeData?.gasPrice) {
            const gasPrice = BigInt(legacyData.feeData.gasPrice);
            const limit = BigInt(maxGasPrice);
            if (gasPrice > limit) {
              legacyData.feeData.gasPrice = maxGasPrice;
            }
          }
          return legacyData;
        }
      }

      lastError = new Error('Both EIP-1559 and legacy gas price fetching failed');
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown error');

      // Wait before retry (exponential backoff)
      if (attempt < retryAttempts - 1) {
        await wait(Math.pow(2, attempt) * 1000);
      }
    }
  }

  return {
    success: false,
    error: `Gas price fetching failed after ${retryAttempts} attempts: ${lastError?.message}`,
  };
}

/**
 * Enhanced gas price fetching with validation (legacy function for backward compatibility)
 */
export async function getGasPriceWithValidation(
  provider: EthereumProvider,
  chainId: number = 1,
): Promise<{ success: boolean; gasPrice?: string; error?: string }> {
  const result = await getEnhancedGasPrice(
    provider,
    {
      strategy: 'standard',
      fallbackToLegacy: true,
    },
    chainId,
  );

  if (!result.success) {
    return { success: false, error: result.error };
  }

  // Return the appropriate gas price based on type
  const gasPrice =
    result.feeData?.type === 'eip1559' ? result.feeData.maxFeePerGas : result.feeData?.gasPrice;

  return {
    success: true,
    gasPrice: gasPrice,
  };
}

/**
 * Enhanced format gas cost using Viem's formatting utilities
 */
export function formatGasCost(
  gasLimit: string,
  gasPrice: string,
): {
  totalCostWei: string;
  totalCostEth: string;
  gasLimitDecimal: string;
  gasPriceGwei: string;
} {
  const gasLimitBigInt = BigInt(gasLimit);
  const gasPriceBigInt = BigInt(gasPrice);
  const totalCostWei = (gasLimitBigInt * gasPriceBigInt).toString();

  // Use Viem's formatEther and formatGwei for consistent formatting
  const totalCostEth = formatEther(BigInt(totalCostWei));
  const gasLimitDecimal = gasLimitBigInt.toString();
  const gasPriceGwei = formatGwei(gasPriceBigInt);

  return {
    totalCostWei,
    totalCostEth,
    gasLimitDecimal,
    gasPriceGwei,
  };
}
