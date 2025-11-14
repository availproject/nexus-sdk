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

/**
 * Enhanced contract parameter validation with detailed error messages
 */
export function validateContractParams(params: {
  contractAddress: string;
  contractAbi: Abi;
  functionName: string;
  functionParams: readonly unknown[];
  chainId: number;
}): { isValid: boolean; error?: string } {
  const { contractAddress, contractAbi, functionName, functionParams, chainId } = params;

  // Validate contract address
  if (!contractAddress || typeof contractAddress !== 'string') {
    return { isValid: false, error: 'Contract address is required and must be a string' };
  }

  if (!isAddress(contractAddress)) {
    return { isValid: false, error: 'Contract address must be a checksummed Ethereum address' };
  }

  // Validate ABI
  if (!Array.isArray(contractAbi) || contractAbi.length === 0) {
    return { isValid: false, error: 'Contract ABI is required and must be a non-empty array' };
  }

  // Validate function name
  if (!functionName || typeof functionName !== 'string') {
    return { isValid: false, error: 'Function name is required and must be a string' };
  }

  // Find function in ABI
  const functionAbi = contractAbi.find(
    (item) => item.type === 'function' && item.name === functionName,
  );

  if (!functionAbi) {
    return { isValid: false, error: `Function '${functionName}' not found in contract ABI` };
  }

  // Validate parameters count
  const expectedParamsCount = functionAbi.inputs?.length ?? 0;
  const providedParamsCount = functionParams?.length || 0;

  if (expectedParamsCount !== providedParamsCount) {
    return {
      isValid: false,
      error: `Function '${functionName}' expects ${expectedParamsCount} parameters, but ${providedParamsCount} were provided`,
    };
  }

  // Validate chain ID
  if (!chainId || !CHAIN_METADATA[chainId]) {
    return { isValid: false, error: `Unsupported chain ID: ${chainId}` };
  }

  return { isValid: true };
}

/**
 * Enhanced contract call encoding with comprehensive error handling
 */
export function encodeContractCall(params: {
  contractAbi: Abi;
  functionName: string;
  functionParams: readonly unknown[];
}): { success: boolean; data?: `0x${string}`; error?: string } {
  try {
    const { contractAbi, functionName, functionParams } = params;

    const data = encodeFunctionData({
      abi: contractAbi,
      functionName,
      args: functionParams,
    });

    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: `Failed to encode contract call: ${extractErrorMessage(error, 'encoding')}`,
    };
  }
}

/**
 * Validate and ensure a value is a valid transaction hash
 */
export function validateTransactionHash(value: unknown): value is `0x${string}` {
  if (typeof value !== 'string') return false;
  return isHash(value);
}

/**
 * Validate hex response from RPC calls
 */
export function validateHexResponse(
  value: unknown,
  fieldName: string,
): { isValid: boolean; error?: string } {
  if (typeof value !== 'string') {
    return { isValid: false, error: `${fieldName} must be a string, got ${typeof value}` };
  }

  if (!value.startsWith('0x')) {
    return { isValid: false, error: `${fieldName} must be a hex string starting with 0x` };
  }

  return { isValid: true };
}

/**
 * Enhanced block explorer URL generation with fallback support
 */
export function getBlockExplorerUrl(chainId: number, txHash: string): string {
  const chainMetadata = CHAIN_METADATA[chainId];

  if (!chainMetadata?.blockExplorerUrls?.[0]) {
    logger.warn(`No block explorer URL found for chain ${chainId}`);
    return '';
  }

  const baseUrl = chainMetadata.blockExplorerUrls[0];
  return `${baseUrl}/tx/${txHash}`;
}

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
