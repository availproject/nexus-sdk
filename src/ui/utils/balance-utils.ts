import type { UserAsset } from '@arcana/ca-sdk';
import { SUPPORTED_CHAINS_IDS, SUPPORTED_TOKENS } from '../../types';

export type TransactionType = 'bridge' | 'transfer' | 'bridgeAndExecute';

export interface EffectiveBalanceParams {
  unifiedBalance: UserAsset[] | null;
  token?: SUPPORTED_TOKENS;
  destinationChainId?: SUPPORTED_CHAINS_IDS;
  type: TransactionType;
}

export interface EffectiveBalanceResult {
  effectiveBalance: string;
  totalBalance: string;
  contextualMessage: string;
}

/**
 * Calculate effective balance based on transaction context
 * - Bridge: Total balance minus destination chain balance
 * - Transfer: Balance available on source chain only
 * - BridgeAndExecute: Total balance minus destination chain balance
 */
export function calculateEffectiveBalance({
  unifiedBalance,
  token,
  destinationChainId,
  type,
}: EffectiveBalanceParams): EffectiveBalanceResult {
  if (!unifiedBalance || !token) {
    return {
      effectiveBalance: '0',
      totalBalance: '0',
      contextualMessage: `Balance: 0 ${token || ''}`,
    };
  }

  const tokenAsset = unifiedBalance.find((asset) => asset.symbol === token);

  if (!tokenAsset) {
    return {
      effectiveBalance: '0',
      totalBalance: '0',
      contextualMessage: `Balance: 0 ${token}`,
    };
  }

  const totalBalance = tokenAsset.balance;
  let effectiveBalance = totalBalance;
  let contextualMessage = `Balance: ${parseFloat(totalBalance).toFixed(6)} ${token}`;

  if (type === 'bridgeAndExecute')
    return {
      effectiveBalance,
      totalBalance,
      contextualMessage,
    };

  if (destinationChainId) {
    const destinationBalance =
      tokenAsset.breakdown?.find((item) => item.chain.id === destinationChainId)?.balance || '0';

    const effectiveBalanceNum = Math.max(
      0,
      parseFloat(totalBalance) - parseFloat(destinationBalance),
    );
    effectiveBalance = effectiveBalanceNum.toString();
    contextualMessage = `Balance: ${effectiveBalanceNum.toFixed(6)} ${token}`;
  }

  return {
    effectiveBalance,
    totalBalance,
    contextualMessage,
  };
}

export function getFiatValue(
  amount: string | number,
  token: string,
  exchangeRates: Record<string, number>,
) {
  const rate = exchangeRates?.[token] ?? 0;
  const amountNum = Number(amount ?? 0);
  const approx = Number.isFinite(rate) && Number.isFinite(amountNum) ? rate * amountNum : 0;
  return `≈ $${approx.toFixed(2)}`;
}

export const TOKEN_IMAGE_MAP: Record<string, string> = {
  BNB: 'https://assets.coingecko.com/asset_platforms/images/1/large/bnb_smart_chain.png',
  KAIA: 'https://assets.coingecko.com/asset_platforms/images/9672/large/kaia.png',
  ETH: 'https://assets.coingecko.com/asset_platforms/images/279/large/ethereum.png?1706606803',
  USDT: 'https://coin-images.coingecko.com/coins/images/35023/large/USDT.png',
  POL: 'https://coin-images.coingecko.com/coins/images/32440/standard/polygon.png',
  USDC: 'https://coin-images.coingecko.com/coins/images/6319/large/usdc.png',
  AVAX: 'https://assets.coingecko.com/coins/images/12559/standard/Avalanche_Circle_RedWhite_Trans.png',
  SOPH: 'https://assets.coingecko.com/coins/images/38680/large/sophon_logo_200.png',
};
