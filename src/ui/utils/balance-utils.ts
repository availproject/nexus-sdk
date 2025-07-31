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
