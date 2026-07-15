import Decimal from 'decimal.js';

export type DroppedMayanChain = { chainID: number; valueUsd: Decimal };

/**
 * Remove every source on a chain whose combined selected USD value is below Mayan's per-leg floor.
 * The caller owns the value calculation because Exact In uses prorated selected balances while
 * Exact Out already carries a USD value on each holding.
 */
export const filterMayanSourcesByChain = <H extends { chainID: number }>(
  holdings: H[],
  minOutputUsdPerSource: Decimal,
  valueUsdForHolding: (holding: H) => Decimal
): { holdings: H[]; droppedChains: DroppedMayanChain[] } => {
  const valueByChain = new Map<number, Decimal>();
  for (const holding of holdings) {
    valueByChain.set(
      holding.chainID,
      (valueByChain.get(holding.chainID) ?? new Decimal(0)).plus(valueUsdForHolding(holding))
    );
  }

  const droppedChains: DroppedMayanChain[] = [];
  for (const [chainID, valueUsd] of valueByChain) {
    if (valueUsd.lt(minOutputUsdPerSource)) {
      droppedChains.push({ chainID, valueUsd });
    }
  }

  const droppedChainIds = new Set(droppedChains.map((entry) => entry.chainID));
  return {
    holdings: holdings.filter((holding) => !droppedChainIds.has(holding.chainID)),
    droppedChains,
  };
};
