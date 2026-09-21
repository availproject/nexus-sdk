import { D } from "./math";

export function formatUsd(value: string): string {
  const amount = D(value);
  return amount.gt(0) && amount.lt("0.01") ? "<$0.01" : `$${amount.toFixed(2)}`;
}

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
