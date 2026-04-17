import { type PublicClient, serializeTransaction } from 'viem';
import { ARBITRUM_GAS_ORACLE_ABI } from '../sdk/ca-base/abi/gasOracle';
import { type Eip1559FeeRecommendation, getGasPriceRecommendations } from './gasFeeHistory';

enum FeeModel {
  OP_STACK = 0,
  OP_STACK_SCROLL = 1,
  ARBITRUM = 2,
  DEFAULT = 3,
}

const CHAIN_FEE_MODEL: Record<number, FeeModel> = {
  10: FeeModel.OP_STACK,
  254: FeeModel.OP_STACK,
  480: FeeModel.OP_STACK,
  1135: FeeModel.OP_STACK,
  7560: FeeModel.OP_STACK,
  8453: FeeModel.OP_STACK,
  84532: FeeModel.OP_STACK,
  34443: FeeModel.OP_STACK,
  7777777: FeeModel.OP_STACK,
  11155420: FeeModel.OP_STACK,
  534351: FeeModel.OP_STACK_SCROLL,
  534352: FeeModel.OP_STACK_SCROLL,
  42161: FeeModel.ARBITRUM,
  42170: FeeModel.ARBITRUM,
  421614: FeeModel.ARBITRUM,
};

const L1_FEE_ORACLE = {
  [FeeModel.OP_STACK]: '0x420000000000000000000000000000000000000F',
  [FeeModel.OP_STACK_SCROLL]: '0x5300000000000000000000000000000000000002',
} as const satisfies Partial<Record<FeeModel, `0x${string}`>>;

const ARBITRUM_NODE_INTERFACE = '0x00000000000000000000000000000000000000C8';

const GET_L1_FEE_ABI = [
  {
    name: 'getL1Fee',
    type: 'function',
    inputs: [{ name: 'data', type: 'bytes' }],
    outputs: [{ name: 'fee', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

type BufferConfig = {
  gasEstimate: number;
  gasPrice: number;
  l1Fee: number;
};

const BUFFER_CONFIGS: Record<FeeModel, BufferConfig> = {
  [FeeModel.OP_STACK]: { gasEstimate: 1.2, gasPrice: 1.1, l1Fee: 1.3 },
  [FeeModel.OP_STACK_SCROLL]: { gasEstimate: 1.2, gasPrice: 1.1, l1Fee: 1.3 },
  [FeeModel.ARBITRUM]: { gasEstimate: 1.2, gasPrice: 1.4, l1Fee: 1.0 },
  [FeeModel.DEFAULT]: { gasEstimate: 1.2, gasPrice: 1.2, l1Fee: 1.0 },
};

export type PriceTier = 'low' | 'medium' | 'high';
export type GasEstimateKind = 'raw' | 'final';

export type TxRequest = {
  to: `0x${string}`;
  data: `0x${string}`;
  value?: bigint;
};

export type TxWithGas = {
  tx: TxRequest;
  gasEstimate: bigint;
  gasEstimateKind?: GasEstimateKind;
};

export type FeeEstimate = {
  l1Fee: bigint;
  l2Fee: bigint;
  total: bigint;
  recommended: {
    gasLimit: bigint;
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
    totalMaxCost: bigint;
    useLegacyPricing: boolean;
  };
};

type RawFeeResult = {
  l1Fee: bigint;
  l2Fee: bigint;
  gasPrice: bigint;
  gasEstimate: bigint;
};

type GasEstimateL1ComponentResult = readonly [bigint, bigint, bigint];

type FeeStrategy = (
  client: PublicClient,
  items: TxWithGas[],
  gasPrice: bigint,
  chainId: number
) => Promise<RawFeeResult[]>;

async function getClientChainId(client: PublicClient): Promise<number> {
  if (client.chain?.id) {
    return client.chain.id;
  }

  return client.getChainId();
}

function serializeTxForOracle(chainId: number, tx: TxRequest): `0x${string}` {
  return serializeTransaction({
    to: tx.to,
    data: tx.data,
    value: tx.value ?? 0n,
    type: 'eip1559',
    chainId,
    maxFeePerGas: 1n,
    maxPriorityFeePerGas: 1n,
    gas: 1n,
  });
}

function applyBuffer(value: bigint, multiplier: number): bigint {
  const bps = BigInt(Math.round(multiplier * 10000));
  return (value * bps) / 10000n;
}

function buildFeeEstimate(
  raw: RawFeeResult,
  buffers: BufferConfig,
  useLegacyPricing: boolean,
  priorityFee: bigint
): FeeEstimate {
  const bufferedGasLimit = applyBuffer(raw.gasEstimate, buffers.gasEstimate);
  const bufferedGasPrice = applyBuffer(raw.gasPrice, buffers.gasPrice);
  const bufferedL1Fee = applyBuffer(raw.l1Fee, buffers.l1Fee);

  return {
    l1Fee: raw.l1Fee,
    l2Fee: raw.l2Fee,
    total: raw.l1Fee + raw.l2Fee,
    recommended: {
      gasLimit: bufferedGasLimit,
      maxFeePerGas: bufferedGasPrice,
      maxPriorityFeePerGas: priorityFee,
      totalMaxCost: bufferedGasLimit * bufferedGasPrice + bufferedL1Fee,
      useLegacyPricing,
    },
  };
}

function buildOpStackStrategy(model: FeeModel.OP_STACK | FeeModel.OP_STACK_SCROLL): FeeStrategy {
  const oracle = L1_FEE_ORACLE[model];

  return async (client, items, gasPrice, chainId) => {
    const l1Fees = await Promise.all(
      items.map((item) => {
        const serialized = serializeTxForOracle(chainId, item.tx);
        return client.readContract({
          address: oracle,
          abi: GET_L1_FEE_ABI,
          functionName: 'getL1Fee',
          args: [serialized],
        }) as Promise<bigint>;
      })
    );

    return items.map((item, i) => ({
      l1Fee: l1Fees[i],
      l2Fee: item.gasEstimate * gasPrice,
      gasPrice,
      gasEstimate: item.gasEstimate,
    }));
  };
}

const arbitrumStrategy: FeeStrategy = async (client, items, gasPrice) => {
  const l1Results = await Promise.all(
    items.map((item) => {
      if (item.gasEstimateKind === 'final') {
        return Promise.resolve(null);
      }

      return client.readContract({
        address: ARBITRUM_NODE_INTERFACE,
        abi: ARBITRUM_GAS_ORACLE_ABI,
        functionName: 'gasEstimateL1Component',
        args: [item.tx.to, false, item.tx.data],
      }) as Promise<GasEstimateL1ComponentResult>;
    })
  );

  return items.map((item, i) => {
    const l1GasUnits = l1Results[i]?.[0] ?? 0n;
    const totalGas = item.gasEstimate + l1GasUnits;

    return {
      l1Fee: 0n,
      l2Fee: totalGas * gasPrice,
      gasPrice,
      gasEstimate: totalGas,
    };
  });
};

const defaultStrategy: FeeStrategy = async (_client, items, gasPrice) =>
  items.map((item) => ({
    l1Fee: 0n,
    l2Fee: item.gasEstimate * gasPrice,
    gasPrice,
    gasEstimate: item.gasEstimate,
  }));

const strategies: Record<FeeModel, FeeStrategy> = {
  [FeeModel.OP_STACK]: buildOpStackStrategy(FeeModel.OP_STACK),
  [FeeModel.OP_STACK_SCROLL]: buildOpStackStrategy(FeeModel.OP_STACK_SCROLL),
  [FeeModel.ARBITRUM]: arbitrumStrategy,
  [FeeModel.DEFAULT]: defaultStrategy,
};

const LEGACY_PRICING_MODELS = new Set<FeeModel>([FeeModel.ARBITRUM]);

export async function estimateTotalFees(
  client: PublicClient,
  items: TxWithGas[],
  priceTier: PriceTier = 'medium',
  bufferOverrides?: Partial<BufferConfig>
): Promise<FeeEstimate[]> {
  if (items.length === 0) {
    return [];
  }

  const chainId = await getClientChainId(client);
  const model = CHAIN_FEE_MODEL[chainId] ?? FeeModel.DEFAULT;
  const buffers = { ...BUFFER_CONFIGS[model], ...bufferOverrides };
  const useLegacyPricing = LEGACY_PRICING_MODELS.has(model);

  const recommendations = await getGasPriceRecommendations(client);
  const selected: Eip1559FeeRecommendation = recommendations[priceTier];
  const rawResults = await strategies[model](client, items, selected.maxFeePerGas, chainId);

  return rawResults.map((raw) =>
    buildFeeEstimate(raw, buffers, useLegacyPricing, selected.maxPriorityFeePerGas)
  );
}
