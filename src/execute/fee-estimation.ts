import { type PublicClient, serializeTransaction } from 'viem';
import { Errors, formatUnknownError, NexusError } from '../domain/errors';

type FeeModel = 'op' | 'scroll' | 'arbitrum' | 'default';
type PriceTier = 'low' | 'medium' | 'high';

const CHAIN_FEE_MODEL: Record<number, FeeModel> = {
  10: 'op',
  254: 'op',
  480: 'op',
  1135: 'op',
  7560: 'op',
  8453: 'op',
  84532: 'op',
  34443: 'op',
  7777777: 'op',
  11155420: 'op',
  534351: 'scroll',
  534352: 'scroll',
  42161: 'arbitrum',
  42170: 'arbitrum',
  421614: 'arbitrum',
};

const L1_FEE_ORACLE = {
  op: '0x420000000000000000000000000000000000000F',
  scroll: '0x5300000000000000000000000000000000000002',
} as const;

const L1_FEE_ABI = [
  {
    name: 'getL1Fee',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'data', type: 'bytes' }],
    outputs: [{ name: 'fee', type: 'uint256' }],
  },
] as const;

const ARBITRUM_GAS_ORACLE_ABI = [
  {
    name: 'gasEstimateL1Component',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'contractCreation', type: 'bool' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [
      { name: 'gasEstimateForL1', type: 'uint64' },
      { name: 'baseFee', type: 'uint256' },
      { name: 'l1BaseFeeEstimate', type: 'uint256' },
    ],
  },
] as const;

export type TxWithGas = {
  tx: { to: `0x${string}`; data: `0x${string}`; value?: bigint };
  gasEstimate: bigint;
  /** RPC approval estimates on Arbitrum already include the L1 gas component. */
  gasEstimateKind?: 'raw' | 'final';
};

const buffer = (value: bigint, percent: bigint) => (value * percent) / 100n;

// Preserve the reference SDK's fee-history tiers and base-fee buffer.
const getGasPriceRecommendation = async (client: PublicClient, tier: PriceTier) => {
  const history = await client.getFeeHistory({
    blockCount: 20,
    rewardPercentiles: [50, 75, 90],
    blockTag: 'latest',
  });
  if (!history.reward?.length) throw new Error('No reward data in fee history');
  const percentile = { low: 0, medium: 1, high: 2 }[tier];
  const priorityFee =
    history.reward.reduce((sum, block) => sum + block[percentile], 0n) /
    BigInt(history.reward.length);
  const baseFee = history.baseFeePerGas[history.baseFeePerGas.length - 1];
  return { maxFeePerGas: buffer(baseFee, 120n) + priorityFee, maxPriorityFeePerGas: priorityFee };
};

export const estimateTotalFees = async (
  client: PublicClient,
  chainId: number,
  items: TxWithGas[],
  tier: PriceTier = 'medium'
) => {
  try {
    const model = CHAIN_FEE_MODEL[chainId] ?? 'default';
    const price = await getGasPriceRecommendation(client, tier);
    if (price.maxFeePerGas === 0n) throw Errors.gasPriceError({ chainId });
    const priceBuffer = model === 'arbitrum' ? 140n : model === 'default' ? 120n : 110n;
    return await Promise.all(
      items.map(async (item) => {
        let gasEstimate = item.gasEstimate;
        let l1Fee = 0n;
        if (model === 'op' || model === 'scroll') {
          const serialized = serializeTransaction({
            ...item.tx,
            value: item.tx.value ?? 0n,
            type: 'eip1559',
            chainId,
            maxFeePerGas: 1n,
            maxPriorityFeePerGas: 1n,
            gas: 1n,
          });
          l1Fee = await client.readContract({
            address: L1_FEE_ORACLE[model],
            abi: L1_FEE_ABI,
            functionName: 'getL1Fee',
            args: [serialized],
          });
        } else if (model === 'arbitrum' && item.gasEstimateKind !== 'final') {
          const [l1Gas] = await client.readContract({
            address: '0x00000000000000000000000000000000000000C8',
            abi: ARBITRUM_GAS_ORACLE_ABI,
            functionName: 'gasEstimateL1Component',
            args: [item.tx.to, false, item.tx.data],
          });
          gasEstimate += l1Gas;
        }
        const gasLimit = buffer(gasEstimate, 120n);
        const maxFeePerGas = buffer(price.maxFeePerGas, priceBuffer);
        return {
          l1Fee,
          recommended: {
            gasLimit,
            maxFeePerGas,
            maxPriorityFeePerGas: price.maxPriorityFeePerGas,
            totalMaxCost: gasLimit * maxFeePerGas + buffer(l1Fee, 130n),
            useLegacyPricing: model === 'arbitrum',
          },
        };
      })
    );
  } catch (error) {
    if (error instanceof NexusError) throw error;
    throw Errors.execution(`Failed to estimate execution fees: ${formatUnknownError(error)}`, {
      service: 'rpc',
      chainId,
    });
  }
};
