import { TOKEN_METADATA, CHAIN_METADATA } from '../constants';
import Decimal from 'decimal.js';
import { ChainMetadata, SUPPORTED_CHAINS_IDS, SUPPORTED_TOKENS, TokenMetadata } from '../types';

/**
 * Format a balance string to a human-readable format using Decimal.js
 */
export function formatBalance(balance: string, decimals: number, precision: number = 4): string {
  const balanceDecimal = new Decimal(balance);
  const divisor = new Decimal(10).pow(decimals);
  const formatted = balanceDecimal.div(divisor);

  if (formatted.isZero()) return '0';
  if (formatted.lt(0.0001)) return '< 0.0001';

  return formatted.toFixed(precision).replace(/\.?0+$/, '');
}

/**
 * Parse units from a human-readable string to wei/smallest unit using Decimal.js
 */
export function parseUnits(value: string, decimals: number): bigint {
  const valueDecimal = new Decimal(value);
  const multiplier = new Decimal(10).pow(decimals);
  const result = valueDecimal.mul(multiplier);

  return BigInt(result.toFixed(0));
}

/**
 * Format units from wei/smallest unit to human-readable string using Decimal.js
 */
export function formatUnits(value: bigint, decimals: number): string {
  const valueDecimal = new Decimal(value.toString());
  const divisor = new Decimal(10).pow(decimals);
  const result = valueDecimal.div(divisor);

  return result.toFixed();
}

/**
 * Validate if a string is a valid Ethereum address
 */
export function isValidAddress(address: string): boolean {
  if (!address || typeof address !== 'string') return false;

  // Check if it's a valid hex string with 0x prefix and 40 characters
  const addressRegex = /^0x[a-fA-F0-9]{40}$/;
  return addressRegex.test(address);
}

/**
 * Get token metadata by symbol
 */
export function getTokenMetadata(symbol: SUPPORTED_TOKENS): TokenMetadata {
  return TOKEN_METADATA[symbol.toUpperCase()];
}

/**
 * Get chain metadata by chain ID
 */
export function getChainMetadata(chainId: SUPPORTED_CHAINS_IDS): ChainMetadata {
  return CHAIN_METADATA[chainId];
}

/**
 * Format a token amount with proper decimals and symbol
 */
export function formatTokenAmount(
  amount: string | bigint,
  tokenSymbol: SUPPORTED_TOKENS,
  precision: number = 4,
): string {
  const metadata = getTokenMetadata(tokenSymbol);
  if (!metadata) return `${amount} ${tokenSymbol}`;

  const amountStr = typeof amount === 'bigint' ? amount.toString() : amount;
  const formatted = formatBalance(amountStr, metadata.decimals, precision);

  return `${formatted} ${metadata.symbol}`;
}

/**
 * Truncate an address for display purposes
 */
export function truncateAddress(
  address: string,
  startLength: number = 6,
  endLength: number = 4,
): string {
  if (!isValidAddress(address)) return address;

  if (address.length <= startLength + endLength + 2) return address;

  return `${address.slice(0, startLength)}...${address.slice(-endLength)}`;
}

/**
 * Convert chain ID to hex format
 */
export function chainIdToHex(chainId: number): string {
  return `0x${chainId.toString(16)}`;
}

/**
 * Convert hex chain ID to number
 */
export function hexToChainId(hex: string): number {
  return parseInt(hex, 16);
}
