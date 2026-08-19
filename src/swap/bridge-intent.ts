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
import { computeNexusBridgeFees } from './routing/bridge';
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
 * - Sources = swap route bridge assets
 * - Recipient = dynamic (EOA or ephemeral)
 * - Ethereum chain sorted last (most expensive)
 * - Holder = ephemeral for source-swap routes, EOA when the bridge has no source swaps
 */
export const createSwapBridgeIntent = (params: {
  bridge: NonNullable<SwapRoute['bridge']>;
  assets: BridgeAsset[];
  chainList: ChainListType;
  recipient: Hex;
  ephemeralAddress: Hex;
  holderAddress?: Hex;
}): BridgeIntentDraft => {
  const { bridge, assets, chainList, recipient, ephemeralAddress } = params;
  const totalBridgedAmount = assets.reduce(
    (sum, asset) => sum.plus(asset.eoaBalance).plus(asset.ephemeralBalance),
    new Decimal(0)
  );
  const effectiveFees =
    bridge.provider === 'nexus' && bridge.nexusFeeModel
      ? computeNexusBridgeFees({
          nexusFeeModel: bridge.nexusFeeModel,
          grossBridged: totalBridgedAmount,
          collectionFee: bridge.estimatedFees.collection,
        }).estimatedFees
      : bridge.estimatedFees;
  const destinationGas = bridge.destinationGas ?? {
    amount: new Decimal(0),
    amountRaw: 0n,
    amountInToken: new Decimal(0),
  };
  // `gasInCot` funds a destination gas swap. `destinationGas.amountInToken` instead funds native
  // gas delivered directly by the bridge.
  const executionTokenAmount = totalBridgedAmount
    .minus(effectiveFees.collection)
    .minus(effectiveFees.fulfilment)
    .minus(effectiveFees.protocol);
  if (executionTokenAmount.isNegative()) {
    throw new Error('Bridge token amount cannot be negative after fee deduction');
  }
  const expectedExecutionCot = bridge.amounts.tokenAmount
    .plus(bridge.amounts.gasInCot)
    .plus(destinationGas.amountInToken);
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

  // Source-swap routes bridge from the ephemeral holder. EOA-funded routes pass the EOA holder and
  // retain the normal bridge collection fee on each source.
  const holderAddress = params.holderAddress ?? ephemeralAddress;
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
    const depositFee = {
      amount: asset.depositFee ?? new Decimal(0),
      raw: asset.depositFeeRaw ?? 0n,
    };
    if (depositFee.amount.gte(totalBalance)) {
      throw Errors.internal(
        `Route produced infeasible bridge asset for chain ${asset.chainID}: deposit fee ${depositFee.amount.toString()} >= balance ${totalBalance.toString()}`
      );
    }
    const mayanQuote = lookupMayanQuote(asset);
    return [
      {
        amountRaw: mulDecimals(totalBalance, asset.decimals) - depositFee.raw,
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
      amountRaw: mulDecimals(
        bridge.destinationGas ? bridge.amounts.tokenAmount : executionTokenAmount,
        bridge.decimals
      ),
      chain: toBridgeIntentChain(chainList, bridge.chainID),
      token: toBridgeIntentToken(chainList, bridge.chainID, bridge.tokenAddress),
      amount: bridge.destinationGas ? bridge.amounts.tokenAmount : executionTokenAmount,
      value: new Decimal(0),
      nativeAmount: destinationGas.amount,
      nativeAmountRaw: destinationGas.amountRaw,
      nativeAmountValue: new Decimal(0),
      nativeAmountInToken: destinationGas.amountInToken,
      nativeToken: toBridgeIntentTokenFromMetadata(chainList.getNativeToken(bridge.chainID)),
      universe: Universe.ETHEREUM,
    },
    fees: {
      caGas: effectiveFees.caGas.toString(),
      deposit: effectiveFees.collection.toString(),
      fulfillment: effectiveFees.fulfilment.toString(),
      protocol: effectiveFees.protocol.toString(),
      solver: effectiveFees.solver.toString(),
    },
    recipientAddress: recipient,
  };
};
