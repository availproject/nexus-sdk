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
 * - Low (50th percentile): Balanced speed and cost
 * - Medium (75th percentile): Faster confirmation, higher cost
 * - High (90th percentile): Fastest confirmation, highest cost
 */
export const getGasPriceRecommendations = async (
  publicClient: PublicClient
): Promise<GasPriceRecommendations> => {
  try {
    const feeHistory = await publicClient.getFeeHistory({
      blockCount: 20,
      rewardPercentiles: [50, 75, 90],
      blockTag: 'latest',
    });

    if (!feeHistory.reward || feeHistory.reward.length === 0) {
      throw new Error('No reward data in fee history');
    }

    // Extract priority fees for each speed tier
    const pctl50Fees = feeHistory.reward.map((block) => block[0]); // 50th percentile
    const pctl75Fees = feeHistory.reward.map((block) => block[1]); // 75th percentile
    const pctl90Fees = feeHistory.reward.map((block) => block[2]); // 90th percentile

    // Calculate averages across all blocks
    const avgLowPriority = mean(pctl50Fees);
    const avgMediumPriority = mean(pctl75Fees);
    const avgHighPriority = mean(pctl90Fees);

    // Get next block's base fee (last element in array)
    const nextBaseFee = feeHistory.baseFeePerGas[feeHistory.baseFeePerGas.length - 1];

    // Add 20% buffer to base fee to account for potential increases before tx lands
    const baseFeeWithBuffer = nextBaseFee + (nextBaseFee * 20n) / 100n;

    // Calculate maxFeePerGas for each tier: baseFee + buffer + priorityFee
    const recommendations: GasPriceRecommendations = {
      low: baseFeeWithBuffer + avgLowPriority,
      medium: baseFeeWithBuffer + avgMediumPriority,
      high: baseFeeWithBuffer + avgHighPriority,
    };

    logger.debug('Gas price recommendations', {
      baseFee: nextBaseFee.toString(),
      baseFeeWithBuffer: baseFeeWithBuffer.toString(),
      'avglowPriority(50pctl)': avgLowPriority.toString(),
      'avgMediumPriority(75pctl)': avgMediumPriority.toString(),
      'avgHighPriority(90pctl)': avgHighPriority.toString(),
      recommendations,
    });

    return recommendations;
  } catch (error) {
    logger.error('Failed to get gas price recommendations', { error });
    throw Errors.internal(`Failed to get gas price recommendations: ${error}`);
  }
};
