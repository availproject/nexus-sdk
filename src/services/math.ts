import Decimal from 'decimal.js';

// Raw token amounts can exceed decimal.js's default 20 significant figures — an 18-decimal
// high-supply token (PEPE, SHIB, BONK) is 21+ digits. At precision 20 a raw -> human -> raw
// round trip loses digits, and mulDecimals' ROUND_CEIL then inflates the result, over-demanding
// `transferFrom` by a few wei and reverting on-chain. 50 figures covers realistic uint256 token
// amounts. Set here because this module owns the raw<->human conversions.
Decimal.set({ precision: 50 });

/**
 * @param input
 * @param decimals
 * @returns input / (10**decimals)
 */
export const divDecimals = (input: bigint | number | string, decimals: number) => {
  return new Decimal(input.toString()).div(Decimal.pow(10, decimals));
};

/**
 * @param input
 * @param decimals
 * @returns BigInt(input * (10**decimals))
 */
export const mulDecimals = (input: Decimal | number | string, decimals: number) => {
  return BigInt(new Decimal(input).mul(Decimal.pow(10, decimals)).toFixed(0, Decimal.ROUND_CEIL));
};

export function pctAdditionWithSuggestion(base: bigint, percentage: number) {
  const pctAmount = BigInt(new Decimal(base).mul(percentage).toFixed(0, Decimal.ROUND_CEIL));
  const value = base + pctAmount;
  const reducedValue = base + (pctAmount * 70n) / 100n;
  return [reducedValue, value];
}
