import { encodeAbiParameters, encodeFunctionData, type Hex, type PublicClient } from 'viem';
import type { Chain } from '../domain';
import { createPublicClientWithFallback } from './evm';
import { estimateTotalFee, type PriceTier, type TxRequest } from './fee-estimation';
import { CALIBUR_EXECUTE_ABI } from './sbc';

// Hardcoded reserve for an EOA-delegated Calibur.execute(...) source-chain swap tx.
// Real measured gas across supported chains is well under 1M; 1.5M is a comfortable
// ceiling that avoids a per-call eth_estimateGas round-trip (which would also need
// state overrides to simulate the Calibur authorization). The L1 fee component on
// Arbitrum / OP-Stack chains is still computed from real calldata via
// NodeInterface.gasEstimateL1Component / L1FeeOracle.getL1Fee inside estimateTotalFee,
// so L1-heavy chains still get accurate sizing.
export const DEFAULT_SWAP_NATIVE_RESERVE_GAS = 1_500_000n;

const DEFAULT_PRICE_TIER: PriceTier = 'medium';
const DEFAULT_SYNTHETIC_SWAP_BUFFER = 120n;

const REPRESENTATIVE_EPHEMERAL = '0x1111111111111111111111111111111111111111' as const;
const REPRESENTATIVE_ROUTER = '0xbeb0b0623f66be8ce162ebdfa2ec543a522f4ea6' as const;
const REPRESENTATIVE_STABLE = '0x06efdbff2a14a7c8e15944d1f4a48f9f95f663a4' as const;
const REPRESENTATIVE_WRAPPED_NATIVE = '0xac4c6e212a361c968f1725b4d055b47e63f80b75' as const;
const REPRESENTATIVE_RECIPIENT = '0xc452cbf994d5a4f4b1d7c9a4dbb75e79c14e05b9' as const;
const REPRESENTATIVE_EXECUTOR = '0xc10ee9031f2a0b84766a86b55a8d90f357910fb4' as const;
const REPRESENTATIVE_SIGNATURE = `0x${'11'.repeat(65)}` as Hex;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;
const ZERO_BYTES_32 = `0x${'00'.repeat(32)}` as Hex;
const EADDRESS_BODY = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

const applyMultiplier = (value: bigint, multiplier: bigint) => (value * multiplier) / 100n;

// Padded ~1200-byte aggregator router calldata. The bytes are not parsed on-chain by
// our path (the representative tx is never submitted) — they exist to make the
// resulting Calibur.execute(...) calldata realistic in size for L1 data-availability
// pricing via Arbitrum's NodeInterface and OP-Stack's L1FeeOracle.
const buildRepresentativeSwapCallData = (): Hex =>
  `0x2143d82c${'0'.repeat(56)}a0${'0'.repeat(63)}32${'0'.repeat(63)}34${'0'.repeat(
    63
  )}76${'0'.repeat(24)}${REPRESENTATIVE_ROUTER.slice(2)}${'0'.repeat(
    24
  )}${REPRESENTATIVE_RECIPIENT.slice(2)}${'0'.repeat(24)}${REPRESENTATIVE_RECIPIENT.slice(
    2
  )}${'0'.repeat(64)}${'0'.repeat(56)}69b41d24${'0'.repeat(
    56
  )}69b41d24${'0'.repeat(24)}a210a4ebe64040b8a26cb798ef450f9c${'0'.repeat(
    24
  )}${REPRESENTATIVE_RECIPIENT.slice(2)}${'0'.repeat(1200)}` as Hex;

const buildRepresentativeSweepCallData = (): Hex =>
  `0x45f3bd1c8${'0'.repeat(23)}${EADDRESS_BODY}${'0'.repeat(48)}5b9bd4f21f19${'0'.repeat(
    24
  )}${REPRESENTATIVE_ROUTER.slice(2)}${'0'.repeat(24)}${REPRESENTATIVE_STABLE.slice(
    2
  )}${'0'.repeat(56)}35d17${'0'.repeat(24)}${REPRESENTATIVE_EXECUTOR.slice(
    2
  )}${'0'.repeat(224)}` as Hex;

const buildRepresentativeSourceExecutionTx = (): TxRequest => {
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
      abi: CALIBUR_EXECUTE_ABI,
      functionName: 'execute',
      args: [
        {
          batchedCall: {
            calls: [
              {
                to: REPRESENTATIVE_ROUTER,
                value: 100_000_000_000_000n,
                data: buildRepresentativeSwapCallData(),
              },
              {
                to: REPRESENTATIVE_WRAPPED_NATIVE,
                value: 0n,
                data: buildRepresentativeSweepCallData(),
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
  publicClient,
}: {
  chain: Chain;
  gasEstimate?: bigint;
  priceTier?: PriceTier;
  syntheticBufferMultiplier?: bigint;
  publicClient?: PublicClient;
}): Promise<bigint> => {
  const client = publicClient ?? createPublicClientWithFallback(chain);
  const tx = buildRepresentativeSourceExecutionTx();
  const feeEstimate = await estimateTotalFee(client, chain.id, tx, gasEstimate, priceTier);

  return applyMultiplier(feeEstimate.total, syntheticBufferMultiplier);
};
