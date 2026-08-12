import { type Hex, type PublicClient, zeroAddress } from 'viem';
import type { Chain } from '../domain';
import { encodeSafeExecTransactionV2 } from '../swap/safe/safe-tx';
import { createPublicClientWithFallback } from './evm';
import { estimateTotalFee, type PriceTier, type TxRequest } from './fee-estimation';

// Hardcoded reserve for an EOA-submitted Safe.execTransaction source-chain swap tx.
// Real measured gas across supported chains is well under 1M; 1.5M is a comfortable
// ceiling that avoids a per-call eth_estimateGas round-trip. The L1 fee component on
// Arbitrum / OP-Stack chains is still computed from real calldata via
// NodeInterface.gasEstimateL1Component / L1FeeOracle.getL1Fee inside estimateTotalFee,
// so L1-heavy chains still get accurate sizing.
export const DEFAULT_SWAP_NATIVE_RESERVE_GAS = 1_500_000n;

const DEFAULT_PRICE_TIER: PriceTier = 'medium';
const DEFAULT_SYNTHETIC_SWAP_BUFFER = 120n;

const REPRESENTATIVE_SAFE = '0x1111111111111111111111111111111111111111' as const;
const REPRESENTATIVE_ROUTER = '0xbeb0b0623f66be8ce162ebdfa2ec543a522f4ea6' as const;
const REPRESENTATIVE_RECIPIENT = '0xc452cbf994d5a4f4b1d7c9a4dbb75e79c14e05b9' as const;
const REPRESENTATIVE_SIGNATURE = `0x${'11'.repeat(64)}1b` as Hex;

const applyMultiplier = (value: bigint, multiplier: bigint) => (value * multiplier) / 100n;

// Padded ~1200-byte aggregator router calldata. The bytes are not parsed on-chain by
// our path (the representative tx is never submitted) — they exist to make the
// resulting Safe.execTransaction(...) calldata realistic in size for L1 data-availability
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

const buildRepresentativeSourceExecutionTx = (): TxRequest => {
  const nativeValue = 100_000_000_000_000n;

  return {
    to: REPRESENTATIVE_SAFE,
    data: encodeSafeExecTransactionV2(
      {
        to: REPRESENTATIVE_ROUTER,
        value: nativeValue,
        data: buildRepresentativeSwapCallData(),
        operation: 0,
        safeTxGas: 0n,
        baseGas: 0n,
        gasPrice: 0n,
        gasToken: zeroAddress,
        refundReceiver: zeroAddress,
        nonce: 1n,
      },
      REPRESENTATIVE_SIGNATURE
    ),
    value: nativeValue,
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
