import Decimal from "decimal.js";

/**
 * Thin helpers around decimal.js for arbitrary-precision arithmetic across
 * the example app. The SDK gives us numeric values as decimal strings
 * (token amounts, USD values, fees) — wrapping them in Decimal keeps sums,
 * subtractions, and percentages exact, with no floating-point drift.
 *
 * Comparisons that just need a sign check (e.g. `x > 0`) can still use the
 * native `Number()` path — these helpers exist for the math that aggregates,
 * scales, or formats.
 */

export { Decimal };

export function D(value: string | number | Decimal | null | undefined): Decimal {
  if (value === null || value === undefined || value === "") return new Decimal(0);
  return value instanceof Decimal ? value : new Decimal(value);
}

export function sum(values: Array<string | number | Decimal | null | undefined>): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(D(v)), new Decimal(0));
}

/** Returns `have / need * 100`, clamped to `[0, 100]`. Returns 100 if need <= 0. */
export function pctOf(
  have: string | number | Decimal,
  need: string | number | Decimal,
): number {
  const needD = D(need);
  if (needD.lte(0)) return 100;
  return D(have).div(needD).mul(100).clamp(0, 100).toNumber();
}

/** Fixed-decimal string with `dp` places. */
export function toFixed(value: string | number | Decimal, dp: number): string {
  return D(value).toFixed(dp);
}

export function gt(a: string | number | Decimal, b: string | number | Decimal): boolean {
  return D(a).gt(D(b));
}

export function lte(a: string | number | Decimal, b: string | number | Decimal): boolean {
  return D(a).lte(D(b));
}
