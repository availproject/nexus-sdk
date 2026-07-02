import {
  encodeAbiParameters,
  encodeFunctionData,
  type Hex,
  keccak256,
  pad,
  parseEther,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import EVMVaultABI from '../abi/vault';
import type { Chain } from '../domain';
import { ZERO_ADDRESS } from '../domain';
import { Universe } from '../domain/chain-abstraction';
import { createPublicClientWithFallback } from './evm';
import {
  estimateTotalFee,
  type FeeEstimate,
  type PriceTier,
  type TxRequest,
} from './fee-estimation';
import { MESSAGE_PREFIX, RFF_REQUEST_ABI_PARAMS } from './rff';

// Fallback used only when `eth_estimateGas` rejects the simulation (chain doesn't
// support `stateOverride`, RPC restricts third-arg, etc). Real measured gas across
// supported chains is ~101-122k for 1-10 sources; 200k is comfortably above the
// observed worst case without over-reserving when the simulation does succeed.
export const DEFAULT_REPRESENTATIVE_DEPOSIT_GAS = 200_000n;

const DEFAULT_PRICE_TIER: PriceTier = 'medium';
// Single 20% safety multiplier on top of the per-chain BUFFER_CONFIGS already
// applied inside estimateTotalFee (gasEstimate × 1.2, gasPrice × 1.2-1.4, l1Fee
// × 1.0-1.3). Compounded buffer ends up ~2× the raw cost, which is enough
// headroom for storage-warming variance without being absurd.
const DEFAULT_FEE_MULTIPLIER = 120n;

// Deterministic throwaway key. Address derived once at module load. The
// signature is recomputed per call (random nonce), so this is just an identity
// the vault can ECRecover and match against `parties[chainIndex].address_`.
const REPRESENTATIVE_PK =
  '0xacab1deafacebeefcafebabedeadc0debaadf00dfeedfacef00dbaadc0deface' as Hex;
const REPRESENTATIVE_ACCOUNT = privateKeyToAccount(REPRESENTATIVE_PK);

const STATE_OVERRIDE_BALANCE = parseEther('1');

type EstimateRepresentativeDepositTxFeeParams = {
  chain: Chain;
  vaultAddress: Hex;
  destinationChainId?: number;
  sourceCount?: number;
  feeMultiplier?: bigint;
  priceTier?: PriceTier;
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

const randomNonce = (): bigint => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let hex = '0x';
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0');
  }
  return BigInt(hex);
};

type RepresentativeRequest = Parameters<
  typeof encodeFunctionData<typeof EVMVaultABI, 'deposit'>
>[0]['args'] extends readonly [infer R, Hex, bigint]
  ? R
  : never;

const buildRepresentativeRequest = (
  sourceChainId: number,
  destinationChainId: number,
  sourceCount: number
): RepresentativeRequest => {
  const paddedZeroAddress = pad(ZERO_ADDRESS, { size: 32 });
  const paddedSignerAddress = pad(REPRESENTATIVE_ACCOUNT.address, { size: 32 });

  // chainIndex=0 is the slot the vault checks against block.chainid. The other
  // sources just contribute calldata bytes so the L1 sizing component (measured
  // separately via NodeInterface for Arbitrum) matches a multi-source intent.
  const sources = Array.from({ length: sourceCount }, (_, i) => ({
    universe: Universe.ETHEREUM,
    chainID: i === 0 ? BigInt(sourceChainId) : BigInt(1_000_000 + i),
    contractAddress: paddedZeroAddress,
    value: 1n,
    fee: 0n,
  }));

  return {
    sources,
    destinationUniverse: Universe.ETHEREUM,
    destinationChainID: BigInt(destinationChainId),
    recipientAddress: paddedSignerAddress,
    destinations: [
      {
        contractAddress: paddedZeroAddress,
        value: 1n,
      },
    ],
    nonce: randomNonce(),
    expiry: BigInt(Math.floor(Date.now() / 1000) + 3600),
    parties: [
      {
        universe: Universe.ETHEREUM,
        address_: paddedSignerAddress,
      },
    ],
  };
};

const buildSignedRepresentativeDepositTx = async (
  vaultAddress: Hex,
  sourceChainId: number,
  destinationChainId: number,
  sourceCount: number
): Promise<TxRequest> => {
  const request = buildRepresentativeRequest(sourceChainId, destinationChainId, sourceCount);

  const encoded = encodeAbiParameters(RFF_REQUEST_ABI_PARAMS, [
    request.sources,
    request.destinationUniverse,
    request.destinationChainID,
    request.recipientAddress,
    request.destinations,
    request.nonce,
    request.expiry,
    request.parties,
  ]);
  const hash = keccak256(encoded);
  const signature = await REPRESENTATIVE_ACCOUNT.signMessage({
    message: MESSAGE_PREFIX + hash,
  });

  return {
    to: vaultAddress,
    data: encodeFunctionData({
      abi: EVMVaultABI,
      functionName: 'deposit',
      args: [request, signature, 0n],
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
}: EstimateRepresentativeDepositTxFeeParams): Promise<RepresentativeDepositFeeEstimate> {
  const client = createPublicClientWithFallback(chain);
  const tx = await buildSignedRepresentativeDepositTx(
    vaultAddress,
    chain.id,
    destinationChainId,
    normalizeSourceCount(sourceCount)
  );

  // State override gives the throwaway signer enough ETH to cover msg.value, so
  // the vault's signature/chainId/nonce/expiry checks all pass and we get a real
  // L2 gas number. Falls back to the constant if the RPC doesn't honor the
  // override (rare on EVM majors; treated as a soft failure).
  const gasEstimate = await client
    .estimateGas({
      account: REPRESENTATIVE_ACCOUNT.address,
      to: tx.to,
      data: tx.data,
      value: tx.value,
      stateOverride: [
        {
          address: REPRESENTATIVE_ACCOUNT.address,
          balance: STATE_OVERRIDE_BALANCE,
        },
      ],
    })
    .catch(() => DEFAULT_REPRESENTATIVE_DEPOSIT_GAS);

  const feeEstimate = await estimateTotalFee(client, chain.id, tx, gasEstimate, priceTier);
  const bufferedTotalFee = applyMultiplier(feeEstimate.recommended.totalMaxCost, feeMultiplier);

  return {
    tx,
    gasEstimate,
    feeEstimate,
    rawTotalFee: feeEstimate.total,
    bufferedTotalFee,
  };
}
