import { D } from "./math";

export function formatAmount(
  value: string | number,
  decimals = 6,
): string {
  const d = D(value);
  if (d.isNaN()) return "0";
  if (d.isZero()) return "0";
  if (d.abs().lt(D("0.000001"))) return "<0.000001";
  // toLocaleString is only safe at display once Decimal has already pinned
  // the value to a finite fixed-decimal string. Round-trip through toFixed
  // to enforce that, then back through Number for locale grouping.
  return Number(d.toFixed(decimals)).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

export function truncateAddress(
  address: string,
  start = 6,
  end = 4,
): string {
  if (address.length <= start + end + 2) return address;
  return `${address.slice(0, start)}…${address.slice(-end)}`;
}

export function truncateHash(hash: string): string {
  if (hash.length <= 18) return hash;
  return `${hash.slice(0, 10)}…${hash.slice(-8)}`;
}
