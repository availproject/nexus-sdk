import type { Hex } from 'viem';
import type { ChainListType } from '../../domain';
import { logger } from '../../domain/utils/logger';
import { equalFold } from '../../services/strings';
import { STABLE_SETTLEMENT_CURRENCY_IDS } from '../constants';
import { resolveCOT } from '../cot';

type SettlementHolding = { chainID: number; tokenAddress: Hex };

export const selectStableSettlement = (input: {
  chainList: ChainListType;
  currentCurrencyId: number;
  destinationChainId: number;
  destinationTokenAddress: Hex;
  scoreHoldings: SettlementHolding[];
  eligibilityHoldings?: SettlementHolding[];
}): number => {
  const eligibilityHoldings = input.eligibilityHoldings ?? input.scoreHoldings;
  const requiredChainIds = new Set([
    input.destinationChainId,
    ...eligibilityHoldings.map((holding) => holding.chainID),
  ]);
  const candidates = [...STABLE_SETTLEMENT_CURRENCY_IDS].map((currencyId) => {
    try {
      const tokensByChain = new Map(
        [...requiredChainIds].map((chainId) => [
          chainId,
          resolveCOT(chainId, input.chainList, currencyId).address,
        ])
      );
      const sourceLegs = input.scoreHoldings.filter(
        (holding) =>
          !(
            holding.chainID === input.destinationChainId &&
            equalFold(holding.tokenAddress, input.destinationTokenAddress)
          ) && !equalFold(holding.tokenAddress, tokensByChain.get(holding.chainID) as Hex)
      ).length;
      const destinationLeg = equalFold(
        tokensByChain.get(input.destinationChainId) as Hex,
        input.destinationTokenAddress
      )
        ? 0
        : 1;
      return { currencyId, feasible: true as const, score: sourceLegs + destinationLeg };
    } catch {
      return { currencyId, feasible: false as const, score: null };
    }
  });
  const feasible = candidates.filter(
    (candidate): candidate is { currencyId: number; feasible: true; score: number } =>
      candidate.feasible
  );
  const bestScore = feasible.reduce(
    (best, candidate) => Math.min(best, candidate.score),
    Number.POSITIVE_INFINITY
  );
  const best = feasible.filter((candidate) => candidate.score === bestScore);
  const selected =
    best.find((candidate) => candidate.currencyId === input.currentCurrencyId)?.currencyId ??
    best[0]?.currencyId ??
    input.currentCurrencyId;

  logger.debug('swap.route.stable_settlement.selected', {
    candidates,
    currentCurrencyId: input.currentCurrencyId,
    selectedCurrencyId: selected,
    retainedCurrentOnTie: best.length > 1 && selected === input.currentCurrencyId,
  });
  return selected;
};
