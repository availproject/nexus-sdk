import { encodeAbiParameters, encodeFunctionData, type Hex } from 'viem';
import type { Chain } from '../commons';
import { SUPPORTED_CHAINS } from '../commons/constants';
import CaliburABI from '../sdk/ca-base/swap/calibur.abi';
import { createPublicClientWithFallback } from '../sdk/ca-base/utils/contract.utils';
import {
  estimateFeeContext,
  finalizeFeeEstimates,
  type PriceTier,
  type TxRequest,
} from './feeEstimation';

export const DEFAULT_SWAP_NATIVE_RESERVE_GAS = 1_500_000n;

const DEFAULT_PRICE_TIER: PriceTier = 'medium';
const DEFAULT_SYNTHETIC_SWAP_BUFFER = 120n;
const DEFAULT_CITREA_SWAP_L1_DIFF_SIZE = 120n;
const REPRESENTATIVE_EPHEMERAL = '0x1111111111111111111111111111111111111111' as const;
const REPRESENTATIVE_TARGET = '0x2222222222222222222222222222222222222222' as const;
const REPRESENTATIVE_SIGNATURE = `0x${'11'.repeat(65)}` as Hex;
const REPRESENTATIVE_SWAP_CALL_DATA = `0x${'11'.repeat(384)}` as Hex;
const REPRESENTATIVE_SWEEP_CALL_DATA = `0x${'22'.repeat(68)}` as Hex;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;
const ZERO_BYTES_32 = `0x${'00'.repeat(32)}` as const;

const applyMultiplier = (value: bigint, multiplier: bigint) => (value * multiplier) / 100n;

const getRepresentativeL1DiffSizeHint = (chainId: number) => {
  switch (chainId) {
    case SUPPORTED_CHAINS.CITREA:
    case SUPPORTED_CHAINS.CITREA_TESTNET:
      return DEFAULT_CITREA_SWAP_L1_DIFF_SIZE;
    default:
      return undefined;
  }
};

const buildRepresentativeCaliburExecuteTx = (): TxRequest => {
  const wrappedSignature = encodeAbiParameters(
    [
      { name: 'signature', type: 'bytes' },
      { name: 'hookData', type: 'bytes' },
    ],
    [REPRESENTATIVE_SIGNATURE, '0x']
  );

  return {
    to: REPRESENTATIVE_EPHEMERAL,
    data: encodeFunctionData({
      abi: CaliburABI,
      functionName: 'execute',
      args: [
        {
          batchedCall: {
            calls: [
              {
                to: REPRESENTATIVE_TARGET,
                value: 1n,
                data: REPRESENTATIVE_SWAP_CALL_DATA,
              },
              {
                to: REPRESENTATIVE_TARGET,
                value: 0n,
                data: REPRESENTATIVE_SWEEP_CALL_DATA,
              },
            ],
            revertOnFailure: true,
          },
          nonce: 1n,
          keyHash: ZERO_BYTES_32,
          executor: ZERO_ADDRESS,
          deadline: 1n,
        },
        wrappedSignature,
      ],
    }),
    value: 1n,
  };
};

export const estimateRepresentativeSwapNativeReserveFee = async ({
  chain,
  gasEstimate = DEFAULT_SWAP_NATIVE_RESERVE_GAS,
  priceTier = DEFAULT_PRICE_TIER,
  syntheticBufferMultiplier = DEFAULT_SYNTHETIC_SWAP_BUFFER,
}: {
  chain: Chain;
  gasEstimate?: bigint;
  priceTier?: PriceTier;
  syntheticBufferMultiplier?: bigint;
}): Promise<bigint> => {
  const client = createPublicClientWithFallback(chain);
  const tx = buildRepresentativeCaliburExecuteTx();
  const feeContext = await estimateFeeContext(
    client,
    chain.id,
    [
      {
        tx,
        gasEstimateKind: 'raw',
        l1DiffSizeHint: getRepresentativeL1DiffSizeHint(chain.id),
      },
    ],
    priceTier
  );
  const [feeEstimate] = finalizeFeeEstimates(
    [{ tx, gasEstimate, gasEstimateKind: 'raw' }],
    feeContext
  );

  return applyMultiplier(feeEstimate.total, syntheticBufferMultiplier);
};
