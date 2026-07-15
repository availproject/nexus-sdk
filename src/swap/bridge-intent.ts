import Decimal from 'decimal.js';
import type { Hex } from 'viem';
import {
  type BridgeIntentDraft,
  type BridgeIntentToken,
  type ChainListType,
  getLogger,
  type TokenInfo,
} from '../domain';
import { Universe } from '../domain/chain-abstraction';
import { Errors } from '../domain/errors';
import { mulDecimals } from '../services/math';
import type { BridgeAsset, SwapRoute } from './types';

const logger = getLogger();

const toBridgeIntentTokenFromMetadata = (
  token: Pick<TokenInfo, 'contractAddress' | 'decimals' | 'logo' | 'name' | 'symbol'>
): BridgeIntentToken => ({
  contractAddress: token.contractAddress,
  decimals: token.decimals,
  logo: token.logo,
  name: token.name,
  symbol: token.symbol,
});

const toBridgeIntentToken = (
  chainList: ChainListType,
  chainId: number,
  tokenAddress: Hex
): BridgeIntentToken => {
  const token = chainList.getTokenByAddress(chainId, tokenAddress);

  return toBridgeIntentTokenFromMetadata(token);
};

const toBridgeIntentChain = (
  chainList: ChainListType,
  chainId: number
): BridgeIntentDraft['destination']['chain'] => {
  const chain = chainList.getChainByID(chainId);
  return {
    id: chain.id,
    name: chain.name,
    logo: chain.custom.icon,
  };
};

// ---------------------------------------------------------------------------
// createSwapBridgeIntent
// ---------------------------------------------------------------------------

/**
 * Creates a bridge intent from swap route bridge data.
 *
 * Returns a full Intent shape compatible with the shared bridge pipeline
 * (executeBridgeFromIntent, runBridgeHooks, etc.).
 *
 * Differences from regular bridge intent:
 * - Sources = post-swap ephemeral balances (bridge.assets)
 * - Recipient = dynamic (EOA or ephemeral)
 * - Ethereum chain sorted last (most expensive)
 * - Fee stubs all zero (TODO: fees)
 */
export const createSwapBridgeIntent = (params: {
  bridge: NonNullable<SwapRoute['bridge']>;
  assets: BridgeAsset[];
  chainList: ChainListType;
  recipient: Hex;
  ephemeralAddress: Hex;
}): BridgeIntentDraft => {
  const { bridge, assets, chainList, recipient, ephemeralAddress } = params;
  const totalBridgedAmount = assets.reduce(
    (sum, asset) => sum.plus(asset.eoaBalance).plus(asset.ephemeralBalance),
    new Decimal(0)
  );
  // Gas-swap COT (`bridge.amounts.gasInCot`) is still bridged — it funds the dst gas swap.
  // Bridge solver no longer delivers separate native gas; intent.destination.nativeAmount=0.
  const executionTokenAmount = totalBridgedAmount
    .minus(bridge.estimatedFees.collection)
    .minus(bridge.estimatedFees.fulfilment)
    .minus(bridge.estimatedFees.protocol);
  if (executionTokenAmount.isNegative()) {
    throw new Error('Bridge token amount cannot be negative after fee deduction');
  }
  const expectedExecutionCot = bridge.amounts.tokenAmount.plus(bridge.amounts.gasInCot);
  if (
    !totalBridgedAmount.eq(bridge.amounts.totalAmount) ||
    !executionTokenAmount.eq(expectedExecutionCot)
  ) {
    logger.debug('swap.route.bridge_intent.amount_mismatch', {
      routeTokenAmount: bridge.amounts.tokenAmount.toFixed(),
      routeGasInCot: bridge.amounts.gasInCot.toFixed(),
      routeTotalAmount: bridge.amounts.totalAmount.toFixed(),
      executionTokenAmount: executionTokenAmount.toFixed(),
      executionTotalAmount: totalBridgedAmount.toFixed(),
    });
  }

  // Build sources from bridge assets, sorted: Ethereum (chainId=1) last
  const sortedAssets = [...assets].sort((a, b) => {
    if (a.chainID === 1 && b.chainID !== 1) return 1;
    if (b.chainID === 1 && a.chainID !== 1) return -1;
    const aTotal = a.ephemeralBalance.plus(a.eoaBalance);
    const bTotal = b.ephemeralBalance.plus(b.eoaBalance);
    return bTotal.comparedTo(aTotal);
  });

  // Bridge funding always flows through the ephemeral identity — RFF `parties` come from the
  // ephemeral, and the deposit batch (Safe or Calibur) moves funds from there. Deposit fees
  // are always zero in this model because the bridge intent is sponsor-relayed; no on-chain
  // ERC-20 transfer from the EOA happens during bridging.
  const holderAddress = ephemeralAddress;
  const lookupMayanQuote = (asset: BridgeAsset) => {
    if (bridge.provider !== 'mayan') return undefined;
    const key = `${asset.chainID}:${asset.contractAddress.toLowerCase()}`;
    const quote = bridge.mayanQuotesBySource?.get(key);
    if (!quote) {
      throw Errors.internal(`Mayan quote missing for source ${key}`);
    }
    return quote;
  };
  const sources = sortedAssets.flatMap((asset) => {
    const totalBalance = asset.eoaBalance.plus(asset.ephemeralBalance);
    if (totalBalance.lte(0)) {
      return [];
    }
    const depositFee = { amount: new Decimal(0), raw: 0n };
    if (depositFee.amount.gte(totalBalance)) {
      throw Errors.internal(
        `Route produced infeasible bridge asset for chain ${asset.chainID}: deposit fee ${depositFee.amount.toString()} >= balance ${totalBalance.toString()}`
      );
    }
    const mayanQuote = lookupMayanQuote(asset);
    return [
      {
        amountRaw: mulDecimals(totalBalance.minus(depositFee.amount), asset.decimals),
        chain: toBridgeIntentChain(chainList, asset.chainID),
        token: toBridgeIntentToken(chainList, asset.chainID, asset.contractAddress),
        amount: totalBalance.minus(depositFee.amount),
        universe: Universe.ETHEREUM,
        holderAddress,
        value: new Decimal(0),
        depositFee: depositFee.amount,
        depositFeeRaw: depositFee.raw,
        ...(mayanQuote ? { mayanQuote } : {}),
      },
    ];
  });

  return {
    provider: bridge.provider,
    availableSources: sources,
    selectedSources: sources,
    destination: {
      amountRaw: mulDecimals(executionTokenAmount, bridge.decimals),
      chain: toBridgeIntentChain(chainList, bridge.chainID),
      token: toBridgeIntentToken(chainList, bridge.chainID, bridge.tokenAddress),
      amount: executionTokenAmount,
      value: new Decimal(0),
      // Swap routes never request bridge-delivered native gas — the destination gas swap
      // (route.destination.swap.gasSwap) handles native delivery via the dst aggregator,
      // so the wire-format native fields stay zero.
      nativeAmount: new Decimal(0),
      nativeAmountRaw: 0n,
      nativeAmountValue: new Decimal(0),
      nativeAmountInToken: new Decimal(0),
      nativeToken: toBridgeIntentTokenFromMetadata(chainList.getNativeToken(bridge.chainID)),
      universe: Universe.ETHEREUM,
    },
    fees: {
      caGas: bridge.estimatedFees.caGas.toString(),
      deposit: bridge.estimatedFees.collection.toString(),
      fulfillment: bridge.estimatedFees.fulfilment.toString(),
      protocol: bridge.estimatedFees.protocol.toString(),
      solver: bridge.estimatedFees.solver.toString(),
    },
    recipientAddress: recipient,
  };
};
