import { type Hex, hexToBigInt, type PublicClient, serializeTransaction, toHex } from 'viem';
import { ARBITRUM_GAS_ORACLE_ABI } from '../abi/gasOracle';
import { SUPPORTED_CHAINS } from '../commons/constants';
import { type Eip1559FeeRecommendation, getGasPriceRecommendations } from './gasFeeHistory';

enum FeeModel {
  OP_STACK = 0,
  OP_STACK_SCROLL = 1,
  ARBITRUM = 2,
  CITREA = 3,
  DEFAULT = 4,
}

const CHAIN_FEE_MODEL: Partial<Record<number, FeeModel>> = {
  [SUPPORTED_CHAINS.OPTIMISM]: FeeModel.OP_STACK,
  [SUPPORTED_CHAINS.BASE]: FeeModel.OP_STACK,
  [SUPPORTED_CHAINS.BASE_SEPOLIA]: FeeModel.OP_STACK,
  [SUPPORTED_CHAINS.OPTIMISM_SEPOLIA]: FeeModel.OP_STACK,
  [SUPPORTED_CHAINS.SCROLL]: FeeModel.OP_STACK_SCROLL,
  [SUPPORTED_CHAINS.ARBITRUM]: FeeModel.ARBITRUM,
  [SUPPORTED_CHAINS.ARBITRUM_SEPOLIA]: FeeModel.ARBITRUM,
  [SUPPORTED_CHAINS.CITREA]: FeeModel.CITREA,
  [SUPPORTED_CHAINS.CITREA_TESTNET]: FeeModel.CITREA,
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
  [FeeModel.CITREA]: { gasEstimate: 1.2, gasPrice: 1.2, l1Fee: 1.2 },
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
type CitreaEstimateDiffSizeResult = {
  gas: Hex;
  l1DiffSize: Hex;
};
type CitreaBlockResult = {
  l1FeeRate?: Hex | null;
};

export type FeeOverhead = {
  l1Fee: bigint;
  extraGas: bigint;
};

export type FeeContextItem = Pick<TxWithGas, 'tx' | 'gasEstimateKind'> & {
  l1DiffSizeHint?: bigint;
};

export type FeeContext = {
  chainId: number;
  recommendation: Eip1559FeeRecommendation;
  overheads: FeeOverhead[];
};

type FeeStrategy = (
  client: PublicClient,
  items: FeeContextItem[],
  chainId: number
) => Promise<FeeOverhead[]>;

type FeeModelConfig = {
  buffers: BufferConfig;
  useLegacyPricing: boolean;
  strategy: FeeStrategy;
};

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

function toRpcTransactionRequest(tx: TxRequest) {
  return {
    to: tx.to,
    data: tx.data,
    value: toHex(tx.value ?? 0n),
  };
}

async function requestCustomRpcMethod<T>(
  client: PublicClient,
  args: { method: string; params?: unknown[] }
): Promise<T> {
  return (
    client.request as unknown as (request: { method: string; params?: unknown[] }) => Promise<T>
  )(args);
}

async function getCitreaL1FeeRate(client: PublicClient): Promise<bigint> {
  const block = await requestCustomRpcMethod<CitreaBlockResult | null>(client, {
    method: 'eth_getBlockByNumber',
    params: ['latest', false],
  });

  if (!block?.l1FeeRate) {
    throw new Error('Citrea block response missing l1FeeRate');
  }

  return hexToBigInt(block.l1FeeRate);
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

  return async (client, items, chainId) => {
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

    return items.map((_, i) => ({
      l1Fee: l1Fees[i],
      extraGas: 0n,
    }));
  };
}

const arbitrumStrategy: FeeStrategy = async (client, items) => {
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

  return items.map((_, i) => {
    const l1GasUnits = l1Results[i]?.[0] ?? 0n;

    return {
      l1Fee: 0n,
      extraGas: l1GasUnits,
    };
  });
};

const citreaStrategy: FeeStrategy = async (client, items) => {
  const [l1FeeRate, l1DiffSizes] = await Promise.all([
    getCitreaL1FeeRate(client),
    Promise.all(
      items.map((item) => {
        if (item.l1DiffSizeHint !== undefined) {
          return Promise.resolve(item.l1DiffSizeHint);
        }

        return requestCustomRpcMethod<CitreaEstimateDiffSizeResult>(client, {
          method: 'eth_estimateDiffSize',
          params: [toRpcTransactionRequest(item.tx)],
        }).then((result) => hexToBigInt(result.l1DiffSize));
      })
    ),
  ]);

  return l1DiffSizes.map((l1DiffSize) => ({
    l1Fee: l1FeeRate * l1DiffSize,
    extraGas: 0n,
  }));
};

const defaultStrategy: FeeStrategy = async (_client, items) =>
  items.map(() => ({
    l1Fee: 0n,
    extraGas: 0n,
  }));

const FEE_MODEL_CONFIGS: Record<FeeModel, FeeModelConfig> = {
  [FeeModel.OP_STACK]: {
    buffers: BUFFER_CONFIGS[FeeModel.OP_STACK],
    useLegacyPricing: false,
    strategy: buildOpStackStrategy(FeeModel.OP_STACK),
  },
  [FeeModel.OP_STACK_SCROLL]: {
    buffers: BUFFER_CONFIGS[FeeModel.OP_STACK_SCROLL],
    useLegacyPricing: false,
    strategy: buildOpStackStrategy(FeeModel.OP_STACK_SCROLL),
  },
  [FeeModel.ARBITRUM]: {
    buffers: BUFFER_CONFIGS[FeeModel.ARBITRUM],
    useLegacyPricing: true,
    strategy: arbitrumStrategy,
  },
  [FeeModel.CITREA]: {
    buffers: BUFFER_CONFIGS[FeeModel.CITREA],
    useLegacyPricing: false,
    strategy: citreaStrategy,
  },
  [FeeModel.DEFAULT]: {
    buffers: BUFFER_CONFIGS[FeeModel.DEFAULT],
    useLegacyPricing: false,
    strategy: defaultStrategy,
  },
};

function getFeeModel(chainId: number): FeeModel {
  return CHAIN_FEE_MODEL[chainId] ?? FeeModel.DEFAULT;
}

export async function estimateFeeContext(
  client: PublicClient,
  chainId: number,
  items: FeeContextItem[],
  priceTier: PriceTier
): Promise<FeeContext> {
  const feeModel = getFeeModel(chainId);
  const [gasPriceRecommendations, overheads] = await Promise.all([
    getGasPriceRecommendations(client, chainId),
    FEE_MODEL_CONFIGS[feeModel].strategy(client, items, chainId),
  ]);

  return {
    chainId,
    recommendation: gasPriceRecommendations[priceTier],
    overheads,
  };
}

export function finalizeFeeEstimates(items: TxWithGas[], context: FeeContext): FeeEstimate[] {
  if (items.length !== context.overheads.length) {
    throw new Error('finalizeFeeEstimates requires overheads for every transaction');
  }

  const { buffers, useLegacyPricing } = FEE_MODEL_CONFIGS[getFeeModel(context.chainId)];

  return items.map((item, index) => {
    const overhead = context.overheads[index];
    const totalGas = item.gasEstimate + overhead.extraGas;

    return buildFeeEstimate(
      {
        l1Fee: overhead.l1Fee,
        l2Fee: totalGas * context.recommendation.maxFeePerGas,
        gasPrice: context.recommendation.maxFeePerGas,
        gasEstimate: totalGas,
      },
      buffers,
      useLegacyPricing,
      context.recommendation.maxPriorityFeePerGas
    );
  });
}

export async function estimateTotalFees(
  client: PublicClient,
  items: TxWithGas[],
  chainId: number,
  priceTier: PriceTier
): Promise<FeeEstimate[]> {
  if (items.length === 0) {
    return [];
  }
  const context = await estimateFeeContext(client, chainId, items, priceTier);
  return finalizeFeeEstimates(items, context);
}
