/**
 * Token balance formatter with zero-compression for tiny values.
 *
 * Examples:
 * - 1.234567 -> "1.2346"
 * - 0.00008509 -> "~0.0₄8509" (shows 4 leading zeros after decimal)
 * - 0.000000000000000123 -> "~0.0₁₅123"
 *
 * Notes:
 * - Uses Unicode subscript digits for the zero count.
 * - Returns a single string optimized for UI display.
 * - If you need richer rendering (e.g., separate parts to style the subscript),
 *   use `formatTokenBalanceParts` which returns structured parts.
 */

import { formatUnits, isAddress } from 'viem';

/**
 * Truncate an address for display purposes
 */
export function truncateAddress(address: string, startLength = 6, endLength = 4): string {
  if (!isAddress(address)) return address;

  if (address.length <= startLength + endLength + 2) return address;

  return `${address.slice(0, startLength)}...${address.slice(-endLength)}`;
}

export interface FormatTokenBalanceOptions {
  decimals?: number; // when value is base units (bigint)
  symbol?: string; // e.g., "ETH"
  significantDigits?: number; // digits after the first non-zero in tiny values
  maxFractionDigits?: number; // for "normal" values
  tinyThresholdPower?: number; // threshold exponent, default -4 => 10^-4
  zeroCompress?: boolean; // show 0.0ₖ<digits> for small values
  thousandSeparator?: boolean; // e.g., 12,345.67
  trimTrailingZeros?: boolean; // remove trailing 0s
  approxTilde?: boolean; // prefix "~" when rounding/truncating
}

export interface FormattedParts {
  text: string; // final string
  approx: boolean;
  integer: string; // "0" or "12"
  zeroCount?: number; // number of zeros after decimal for tiny values
  zeroSubscript?: string; // "₆"
  significant?: string; // e.g., "8509"
  fraction?: string; // normal fraction for non-tiny values
  symbol?: string;
}

const SUBSCRIPT_DIGITS: Record<string, string> = {
  '0': '₀',
  '1': '₁',
  '2': '₂',
  '3': '₃',
  '4': '₄',
  '5': '₅',
  '6': '₆',
  '7': '₇',
  '8': '₈',
  '9': '₉',
};

function toSubscript(num: number): string {
  return String(num)
    .split('')
    .map((d) => SUBSCRIPT_DIGITS[d] ?? d)
    .join('');
}

function expandExponential(n: string): string {
  // Handles strings like "1e-7" or "1.23e+5" into normal decimal strings
  if (!/e/i.test(n)) return n;
  const isNeg = n.startsWith('-');
  const isPos = !isNeg && n.startsWith('+');
  const unsigned = isNeg || isPos ? n.slice(1) : n;
  const [mantissa, expStr] = unsigned.toLowerCase().split('e');
  const exp = Number(expStr);
  if (!Number.isFinite(exp)) return n;
  const [intPart, fracPart = ''] = mantissa.split('.');
  const digits = intPart + fracPart;
  if (exp === 0) return (isNeg ? '-' : '') + mantissa;
  if (exp > 0) {
    // Move decimal right
    const pad = Math.max(0, exp - fracPart.length);
    const left = digits + '0'.repeat(pad);
    const idx = intPart.length + exp;
    const whole = left.slice(0, idx);
    const frac = left.slice(idx);
    const out = frac.length ? `${whole}.${frac}` : whole;
    return (isNeg ? '-' : '') + out;
  } else {
    // Move decimal left
    const k = Math.abs(exp);
    const pad = Math.max(0, k - intPart.length);
    const left = '0'.repeat(pad) + digits;
    const idx = left.length - k;
    const whole = left.slice(0, idx) || '0';
    const frac = left.slice(idx);
    const out = `${whole}.${frac}`;
    return (isNeg ? '-' : '') + out;
  }
}

function bigIntToDecimalString(value: bigint, decimals: number): string {
  const raw = formatUnits(value, decimals);
  if (raw.includes('.')) {
    const [i, f] = raw.split('.');
    const f2 = f.replace(/0+$/, '');
    return f2.length ? `${i}.${f2}` : i;
  }
  return raw;
}

type InputValue = string | number | bigint;

function insertThousands(n: string): string {
  const neg = n.startsWith('-');
  const s = neg ? n.slice(1) : n;
  const [i, f] = s.split('.');
  const withSep = i.replaceAll(/\B(?=(\d{3})+(?!\d))/g, ',');
  const suffix = f ? `.${f}` : '';
  if (neg) {
    return `-${withSep}${suffix}`;
  }
  return `${withSep}${suffix}`;
}

function stripTrailingZeros(s: string): string {
  if (s === '') return s;
  let end = s.length;
  while (end > 0 && s.charAt(end - 1) === '0') end--;
  return end === s.length ? s : s.slice(0, end);
}

function normalizeValue(
  value: InputValue,
  decimals?: number
): { negative: boolean; intPart: string; fracRaw: string } {
  let decimalStr: string;
  if (typeof value === 'bigint') {
    if (typeof decimals !== 'number') {
      throw new TypeError('decimals is required when formatting bigint amounts');
    }
    decimalStr = bigIntToDecimalString(value, decimals);
  } else {
    decimalStr = expandExponential(String(value));
  }
  let negative = false;
  if (decimalStr.startsWith('-')) {
    negative = true;
    decimalStr = decimalStr.slice(1);
  }
  if (decimalStr === '' || decimalStr === '.') decimalStr = '0';
  const [intRaw, fracRawRaw = ''] = decimalStr.split('.');
  const intPart = intRaw === '' ? '0' : intRaw;
  const fracRaw = fracRawRaw;
  return { negative, intPart, fracRaw };
}

function formatZero(symbol?: string): FormattedParts {
  const base = '0';
  const text = symbol ? `${base} ${symbol}` : base;
  return { text, approx: false, integer: '0', fraction: '', symbol };
}

interface NormalFormatOpts {
  maxFractionDigits: number;
  trimTrailingZeros: boolean;
  thousandSeparator: boolean;
  approxTilde: boolean;
  symbol?: string;
}

function formatNormal(
  negative: boolean,
  intPart: string,
  fracRaw: string,
  opts: NormalFormatOpts
): FormattedParts {
  let fraction = fracRaw.slice(0, opts.maxFractionDigits);
  if (opts.trimTrailingZeros) fraction = stripTrailingZeros(fraction);
  let base = fraction ? `${intPart}.${fraction}` : intPart;
  if (opts.thousandSeparator) base = insertThousands(base);
  const prefix = negative ? '-' : '';
  const withSymbol = opts.symbol ? `${base} ${opts.symbol}` : base;
  const text = `${prefix}${withSymbol}`;
  const approx = fraction.length < fracRaw.length && opts.approxTilde;
  const integer = negative ? `-${intPart}` : intPart;
  return { text, approx, integer, fraction, symbol: opts.symbol };
}

function countLeadingZeros(fracRaw: string): number {
  let count = 0;
  for (const ch of fracRaw) {
    if (ch === '0') count++;
    else break;
  }
  return count;
}

interface TinyFormatOpts {
  significantDigits: number;
  zeroCompress: boolean;
  approxTilde: boolean;
  symbol?: string;
}

function formatTiny(
  negative: boolean,
  fracRaw: string,
  zeros: number,
  opts: TinyFormatOpts
): FormattedParts {
  const sig = fracRaw.slice(zeros, zeros + opts.significantDigits);
  const hasMore = fracRaw.length > zeros + sig.length;
  const approx = opts.approxTilde && hasMore;
  if (opts.zeroCompress) {
    const zeroDisplay = Math.min(zeros, 99);
    const zeroSub = toSubscript(zeroDisplay);
    const core = `0.0${zeroSub}${sig || '0'}`;
    const prefix = approx ? '~' : '';
    const sign = negative ? '-' : '';
    const body = opts.symbol ? `${core} ${opts.symbol}` : core;
    const text = `${prefix}${sign}${body}`;
    return {
      text,
      approx,
      integer: negative ? '-0' : '0',
      zeroCount: zeros,
      zeroSubscript: zeroSub,
      significant: sig || '0',
      symbol: opts.symbol,
    };
  }
  const shown = `0.${'0'.repeat(zeros)}${sig || '0'}`;
  const prefix = approx ? '~' : '';
  const sign = negative ? '-' : '';
  const body = opts.symbol ? `${shown} ${opts.symbol}` : shown;
  const text = `${prefix}${sign}${body}`;
  return {
    text,
    approx,
    integer: negative ? '-0' : '0',
    fraction: shown.slice(2),
    symbol: opts.symbol,
  };
}

/**
 * Format a token balance parts
 * @param value - The value to format
 * @param options - The options to format the balance
 * @returns The formatted balance parts
 * Examples:
 * - 1.234567 -> "1.2346"
 * - 0.00008509 -> "~0.0₄8509" (shows 4 leading zeros after decimal)
 * - 0.000000000000000123 -> "~0.0₁₅123"
 *
 * Notes:
 * - Uses Unicode subscript digits for the zero count.
 * - Returns a structured object with parts of the balance.
 */

export function formatTokenBalanceParts(
  value: InputValue,
  {
    decimals,
    symbol,
    significantDigits = 4,
    maxFractionDigits = 4,
    tinyThresholdPower = -4,
    zeroCompress = true,
    thousandSeparator = false,
    trimTrailingZeros = true,
    approxTilde = true,
  }: FormatTokenBalanceOptions = {}
): FormattedParts {
  const normalized = normalizeValue(value, decimals);
  const { negative, intPart, fracRaw } = normalized;
  const isZero = intPart === '0' && /^0*$/.test(fracRaw);

  if (isZero) {
    return formatZero(symbol);
  }
  const normalOpts = {
    maxFractionDigits,
    trimTrailingZeros,
    thousandSeparator,
    approxTilde,
    symbol,
  } as const;

  // String-based classification to avoid Number underflow/overflow
  const isIntegerNonZero = intPart !== '0';
  if (isIntegerNonZero && tinyThresholdPower < 0) {
    return formatNormal(negative, intPart, fracRaw, normalOpts);
  }
  if (isIntegerNonZero && tinyThresholdPower >= 0) {
    const intDigits = intPart.replace(/^0+/, '').length;
    if (intDigits - 1 >= tinyThresholdPower) {
      return formatNormal(negative, intPart, fracRaw, normalOpts);
    }
    // else treat as tiny
  }

  const zeros = isIntegerNonZero ? 0 : countLeadingZeros(fracRaw);
  if (!isIntegerNonZero && tinyThresholdPower < 0) {
    const limitZeros = Math.max(0, Math.abs(tinyThresholdPower) - 1);
    if (zeros <= limitZeros) {
      return formatNormal(negative, intPart, fracRaw, normalOpts);
    }
  }

  const tinyOpts = {
    significantDigits,
    zeroCompress,
    approxTilde,
    symbol,
  } as const;
  return formatTiny(negative, fracRaw, zeros, tinyOpts);
}

/**
 * Format a token balance
 * @param value - The value to format
 * @param options - The options to format the balance
 * @returns The formatted balance
 * Examples:
 * - 1.234567 -> "1.2346"
 * - 0.00008509 -> "~0.0₄8509" (shows 4 leading zeros after decimal)
 * - 0.000000000000000123 -> "~0.0₁₅123"
 *
 * Notes:
 * - Uses Unicode subscript digits for the zero count.
 * - Returns a single string optimized for UI display.
 * - If you need richer rendering (e.g., separate parts to style the subscript),
 *   use `formatTokenBalanceParts` which returns structured parts.
 */
export function formatTokenBalance(
  value: string | number | bigint,
  options?: FormatTokenBalanceOptions
): string {
  return formatTokenBalanceParts(value, options).text;
}
