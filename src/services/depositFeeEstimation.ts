import { EVMVaultABI, Universe } from '@avail-project/ca-common';
import { encodeFunctionData, type Hex, pad } from 'viem';
import type { Chain } from '../commons';
import { ZERO_ADDRESS } from '../sdk/ca-base/constants';
import { createPublicClientWithFallback } from '../sdk/ca-base/utils/contract.utils';
import {
  estimateFeeContext,
  type FeeEstimate,
  finalizeFeeEstimates,
  type PriceTier,
  type TxRequest,
} from './feeEstimation';

export const DEFAULT_REPRESENTATIVE_DEPOSIT_GAS = 300_000n;

const DEFAULT_PRICE_TIER: PriceTier = 'medium';
const DEFAULT_FEE_MULTIPLIER = 100n;
const DEFAULT_SYNTHETIC_DEPOSIT_BUFFER = 130n;
const REPRESENTATIVE_ACCOUNT = '0x1111111111111111111111111111111111111111' as const;
const REPRESENTATIVE_SIGNATURE = `0x${'11'.repeat(65)}` as Hex;

type EstimateRepresentativeDepositTxFeeParams = {
  chain: Chain;
  vaultAddress: Hex;
  destinationChainId?: number;
  sourceCount?: number;
  feeMultiplier?: bigint;
  priceTier?: PriceTier;
  syntheticBufferMultiplier?: bigint;
};

type RepresentativeDepositFeeEstimate = {
  tx: TxRequest;
  gasEstimate: bigint;
  feeEstimate: FeeEstimate;
  rawTotalFee: bigint;
  bufferedTotalFee: bigint;
};

const applyMultiplier = (value: bigint, multiplier: bigint) => (value * multiplier) / 100n;

const normalizeSourceCount = (sourceCount?: number) => {
  if (!sourceCount || sourceCount < 1) {
    return 1;
  }

  return Math.floor(sourceCount);
};

const buildRepresentativeDepositTx = (
  vaultAddress: Hex,
  destinationChainId: number,
  sourceCount: number
): TxRequest => {
  const paddedZeroAddress = pad(ZERO_ADDRESS, { size: 32 });
  const paddedRepresentativeAddress = pad(REPRESENTATIVE_ACCOUNT, { size: 32 });

  const request = {
    sources: Array.from({ length: sourceCount }, (_, index) => ({
      universe: Universe.ETHEREUM,
      chainID: BigInt(index + 1),
      contractAddress: paddedZeroAddress,
      value: 1n,
    })),
    destinationUniverse: Universe.ETHEREUM,
    destinationChainID: BigInt(destinationChainId),
    recipientAddress: paddedRepresentativeAddress,
    destinations: [
      {
        contractAddress: paddedZeroAddress,
        value: 1n,
      },
    ],
    nonce: 1n,
    expiry: 1n,
    parties: [
      {
        universe: Universe.ETHEREUM,
        address_: paddedRepresentativeAddress,
      },
    ],
  };

  return {
    to: vaultAddress,
    data: encodeFunctionData({
      abi: EVMVaultABI,
      functionName: 'deposit',
      args: [request, REPRESENTATIVE_SIGNATURE, 0n],
    }),
    value: 1n,
  };
};

export async function estimateRepresentativeDepositTxFee({
  chain,
  vaultAddress,
  destinationChainId = 1,
  sourceCount,
  feeMultiplier = DEFAULT_FEE_MULTIPLIER,
  priceTier = DEFAULT_PRICE_TIER,
  syntheticBufferMultiplier = DEFAULT_SYNTHETIC_DEPOSIT_BUFFER,
}: EstimateRepresentativeDepositTxFeeParams): Promise<RepresentativeDepositFeeEstimate> {
  const client = createPublicClientWithFallback(chain);
  const tx = buildRepresentativeDepositTx(
    vaultAddress,
    destinationChainId,
    normalizeSourceCount(sourceCount)
  );

  const gasEstimatePromise = client
    .estimateGas({
      account: REPRESENTATIVE_ACCOUNT,
      to: tx.to,
      data: tx.data,
      value: tx.value,
    })
    .catch(() => DEFAULT_REPRESENTATIVE_DEPOSIT_GAS);
  const [feeContext, gasEstimate] = await Promise.all([
    estimateFeeContext(client, chain.id, [{ tx }], priceTier),
    gasEstimatePromise,
  ]);
  const [feeEstimate] = finalizeFeeEstimates([{ tx, gasEstimate }], feeContext);
  const explicitlyBufferedFee = applyMultiplier(feeEstimate.total, feeMultiplier);
  const bufferedTotalFee = applyMultiplier(explicitlyBufferedFee, syntheticBufferMultiplier);

  return {
    tx,
    gasEstimate,
    feeEstimate,
    rawTotalFee: feeEstimate.total,
    bufferedTotalFee,
  };
}
