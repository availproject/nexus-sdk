import {
  TOKEN_METADATA,
  CHAIN_METADATA,
  MAINNET_CHAINS,
  TESTNET_CHAINS,
  TESTNET_TOKEN_METADATA,
} from '../constants';
import Decimal from 'decimal.js';
import {
  ChainMetadata,
  SUPPORTED_CHAINS_IDS,
  SUPPORTED_TOKENS,
  TokenMetadata,
} from '../types/index';
import { encodeFunctionData, type Abi, type Address, type Chain, isAddress, isHash } from 'viem';
import { mainnet, polygon, arbitrum, optimism, base } from 'viem/chains';
import { logger } from '../utils/logger';

export * from './format';

/**
 * Shared utility for standardized error message extraction
 */
export function extractErrorMessage(error: unknown, fallbackContext: string): string {
  return error instanceof Error ? error.message : `Unknown ${fallbackContext} error`;
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get Viem chain configuration for supported chains
 */
export function getViemChain(chainId: number): Chain {
  switch (chainId) {
    case 1:
      return mainnet;
    case 137:
      return polygon;
    case 42161:
      return arbitrum;
    case 10:
      return optimism;
    case 8453:
      return base;
    default:
      // Return a basic chain config for unsupported chains
      return {
        id: chainId,
        name: `Chain ${chainId}`,
        nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
        rpcUrls: {
          default: { http: [] },
          public: { http: [] },
        },
      };
  }
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
 * Validate if a string is a valid Ethereum address using viem
 */
export function isValidAddress(address: string): address is Address {
  return isAddress(address);
}

/**
 * Get mainnet token metadata by symbol
 */
export const getMainnetTokenMetadata = (symbol: SUPPORTED_TOKENS): TokenMetadata | undefined => {
  return TOKEN_METADATA[symbol];
};

/**
 * Get testnet token metadata by symbol
 */
export const getTestnetTokenMetadata = (symbol: SUPPORTED_TOKENS): TokenMetadata | undefined => {
  return TESTNET_TOKEN_METADATA[symbol];
};

/**
 * Get token metadata by symbol (defaults to mainnet, kept for backward compatibility)
 */
export const getTokenMetadata = (symbol: SUPPORTED_TOKENS): TokenMetadata | undefined => {
  return TOKEN_METADATA[symbol];
};

/**
 * Get chain metadata by chain ID
 */
export function getChainMetadata(chainId: SUPPORTED_CHAINS_IDS): ChainMetadata {
  return CHAIN_METADATA[chainId];
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

export const isMainnetChain = (chainId: SUPPORTED_CHAINS_IDS): boolean => {
  return (MAINNET_CHAINS as readonly number[]).includes(chainId);
};

export const isTestnetChain = (chainId: SUPPORTED_CHAINS_IDS): boolean => {
  return (TESTNET_CHAINS as readonly number[]).includes(chainId);
};

// Export logger utilities from commons
export {
  LOG_LEVEL,
  setExceptionReporter,
  setLogLevel,
  getLogger,
  logger,
  type LogLevel,
  type ExceptionReporter,
} from '../utils/logger';
