import type { PublicClient } from 'viem';
import { getLogger } from '../../../commons';
import { Errors } from '../errors';

const logger = getLogger();

/**
 * Gas price recommendations for different transaction speeds
 */
export type GasPriceRecommendations = {
  low: bigint;
  medium: bigint;
  high: bigint;
  ultraHigh: bigint;
  baseFee: bigint;
};

// from es-toolkit but with bigints
export function sum(nums: readonly bigint[]): bigint {
  let result = 0n;

  for (let i = 0; i < nums.length; i++) {
    result += nums[i];
  }

  return result;
}

export function mean(nums: readonly bigint[]): bigint {
  return sum(nums) / BigInt(nums.length);
}

/**
 * Get gas price recommendations (low, medium, high, ultraHigh) using fee history
 * Uses percentiles of recent blocks' priority fees to determine appropriate maxFeePerGas
 * for different transaction speeds
 *
 * - Low (25th percentile): Slower transactions, lower cost
 * - Medium (50th percentile): Balanced speed and cost
 * - High (75th percentile): Faster confirmation, higher cost
 * - UltraHigh (90th percentile): Fastest confirmation, highest cost
 */
export const getGasPriceRecommendations = async (
  publicClient: PublicClient
): Promise<GasPriceRecommendations> => {
  try {
    const feeHistory = await publicClient.getFeeHistory({
      blockCount: 20,
      rewardPercentiles: [25, 50, 75, 90], // Low, Medium, High, UltraHigh
      blockTag: 'latest',
    });

    if (!feeHistory.reward || feeHistory.reward.length === 0) {
      throw new Error('No reward data in fee history');
    }

    // Extract priority fees for each speed tier
    const lowPriorityFees = feeHistory.reward.map((block) => block[0]); // 25th percentile
    const mediumPriorityFees = feeHistory.reward.map((block) => block[1]); // 50th percentile
    const highPriorityFees = feeHistory.reward.map((block) => block[2]); // 75th percentile
    const ultraHighPriorityFees = feeHistory.reward.map((block) => block[3]); // 90th percentile

    // Calculate averages across all blocks
    const avgLowPriority = mean(lowPriorityFees);
    const avgMediumPriority = mean(mediumPriorityFees);
    const avgHighPriority = mean(highPriorityFees);
    const avgUltraHighPriority = mean(ultraHighPriorityFees);

    // Get next block's base fee (last element in array)
    const nextBaseFee = feeHistory.baseFeePerGas[feeHistory.baseFeePerGas.length - 1];

    // Add 20% buffer to base fee to account for potential increases before tx lands
    const baseFeeWithBuffer = nextBaseFee + (nextBaseFee * 20n) / 100n;

    // Calculate maxFeePerGas for each tier: baseFee + buffer + priorityFee
    const recommendations: GasPriceRecommendations = {
      low: baseFeeWithBuffer + avgLowPriority,
      medium: baseFeeWithBuffer + avgMediumPriority,
      high: baseFeeWithBuffer + avgHighPriority,
      ultraHigh: baseFeeWithBuffer + avgUltraHighPriority,
      baseFee: nextBaseFee,
    };

    logger.debug('Gas price recommendations', {
      baseFee: nextBaseFee.toString(),
      baseFeeWithBuffer: baseFeeWithBuffer.toString(),
      avgLowPriority: avgLowPriority.toString(),
      avgMediumPriority: avgMediumPriority.toString(),
      avgHighPriority: avgHighPriority.toString(),
      avgUltraHighPriority: avgUltraHighPriority.toString(),
      recommendations: {
        low: recommendations.low.toString(),
        medium: recommendations.medium.toString(),
        high: recommendations.high.toString(),
        ultraHigh: recommendations.ultraHigh.toString(),
      },
    });

    return recommendations;
  } catch (error) {
    logger.error('Failed to get gas price recommendations', { error });
    throw Errors.internal(`Failed to get gas price recommendations: ${error}`);
  }
};
