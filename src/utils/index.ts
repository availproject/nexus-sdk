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
  EthereumProvider,
  Block,
  TransactionReceipt,
} from '../types';
import { encodeFunctionData, type Abi, type Address, isAddress, isHash } from 'viem';
import { formatEther } from 'viem';

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
 * Format a mainnet token amount with proper decimals and symbol
 */
export function formatTokenAmount(
  amount: string | bigint,
  tokenSymbol: SUPPORTED_TOKENS,
  precision: number = 4,
): string {
  const metadata = getMainnetTokenMetadata(tokenSymbol);
  if (!metadata) return `${amount} ${tokenSymbol}`;

  const amountStr = typeof amount === 'bigint' ? amount.toString() : amount;
  const formatted = formatBalance(amountStr, metadata.decimals, precision);

  return `${formatted} ${metadata.symbol}`;
}

/**
 * Format a testnet token amount with proper decimals and symbol
 */
export function formatTestnetTokenAmount(
  amount: string | bigint,
  tokenSymbol: SUPPORTED_TOKENS,
  precision: number = 4,
): string {
  const metadata = getTestnetTokenMetadata(tokenSymbol);
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
    const errorMessage = error instanceof Error ? error.message : 'Unknown encoding error';
    return { success: false, error: `Failed to encode contract call: ${errorMessage}` };
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
    console.warn(`No block explorer URL found for chain ${chainId}`);
    return '';
  }

  const baseUrl = chainMetadata.blockExplorerUrls[0];
  return `${baseUrl}/tx/${txHash}`;
}

/**
 * Search for transaction hash in block transactions
 */
async function searchTransactionInBlock(
  provider: EthereumProvider,
  fromAddress: string,
): Promise<`0x${string}` | null> {
  const latestBlock = (await provider.request({
    method: 'eth_getBlockByNumber',
    params: ['latest', true],
  })) as Block;

  if (!latestBlock?.transactions) return null;

  for (const tx of latestBlock.transactions) {
    if (tx.from?.toLowerCase() === fromAddress.toLowerCase()) {
      if (validateTransactionHash(tx.hash)) {
        return tx.hash;
      }
    }
  }

  return null;
}

/**
 * Poll for transaction hash with timeout
 */
async function pollForTransactionHash(
  provider: EthereumProvider,
  fromAddress: string,
  timeout: number,
): Promise<{ success: boolean; hash?: `0x${string}`; error?: string }> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const hash = await searchTransactionInBlock(provider, fromAddress);
    if (hash) {
      return { success: true, hash };
    }
    await wait(2000);
  }

  return { success: false, error: 'Transaction hash not found within timeout period' };
}

/**
 * Get transaction hash with multiple fallback strategies
 */
export async function getTransactionHashWithFallback(
  provider: EthereumProvider,
  response: unknown,
  options: {
    enablePolling?: boolean;
    timeout?: number;
    fromAddress?: string;
  } = {},
): Promise<{ success: boolean; hash?: `0x${string}`; error?: string }> {
  const { enablePolling = false, timeout = 30000, fromAddress } = options;

  // Strategy 1: Direct response validation
  if (validateTransactionHash(response)) {
    return { success: true, hash: response };
  }

  // Strategy 2: Transaction polling (if enabled)
  if (enablePolling && fromAddress) {
    try {
      return await pollForTransactionHash(provider, fromAddress, timeout);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown polling error';
      return { success: false, error: `Transaction polling failed: ${errorMessage}` };
    }
  }

  return {
    success: false,
    error: `Invalid transaction hash response: ${typeof response}${enablePolling ? ' (polling disabled)' : ''}`,
  };
}

/**
 * Enhanced gas estimation with validation
 */
export async function estimateGasWithValidation(
  provider: EthereumProvider,
  params: {
    to: string;
    data: string;
    value?: string;
    from?: string;
  },
): Promise<{ success: boolean; gasLimit?: string; error?: string }> {
  try {
    const gasEstimate = await provider.request({
      method: 'eth_estimateGas',
      params: [params],
    });

    const validation = validateHexResponse(gasEstimate, 'Gas estimate');
    if (!validation.isValid) {
      return { success: false, error: validation.error };
    }

    // Add 20% buffer to gas estimate
    const buffered = (BigInt(gasEstimate as string) * 120n) / 100n; // +20 %
    const gasLimit = `0x${buffered.toString(16)}`;

    return { success: true, gasLimit };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown gas estimation error';
    return { success: false, error: `Gas estimation failed: ${errorMessage}` };
  }
}

/**
 * Enhanced gas price fetching with validation
 */
export async function getGasPriceWithValidation(
  provider: EthereumProvider,
): Promise<{ success: boolean; gasPrice?: string; error?: string }> {
  try {
    const gasPrice = await provider.request({
      method: 'eth_gasPrice',
      params: [],
    });

    const validation = validateHexResponse(gasPrice, 'Gas price');
    if (!validation.isValid) {
      return { success: false, error: validation.error };
    }

    return { success: true, gasPrice: gasPrice as string };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown gas price error';
    return { success: false, error: `Gas price fetch failed: ${errorMessage}` };
  }
}

/**
 * Format gas cost for user display
 */
export function formatGasCost(
  gasLimit: string,
  gasPrice: string,
): {
  totalCostWei: string;
  totalCostEth: string;
  gasLimitDecimal: string;
  gasPriceGwei: string;
} {
  const gasLimitBigInt = BigInt(gasLimit);
  const gasPriceBigInt = BigInt(gasPrice);
  const totalCostWei = (gasLimitBigInt * gasPriceBigInt).toString();
  const totalCostEth = formatEther(BigInt(totalCostWei));
  const gasLimitDecimal = gasLimitBigInt.toString();
  const gasPriceGwei = formatEther(gasPriceBigInt * BigInt(1000000000)); // Convert to Gwei

  return {
    totalCostWei,
    totalCostEth,
    gasLimitDecimal,
    gasPriceGwei,
  };
}

/**
 * Simple wait utility
 */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for transaction receipt with confirmation tracking
 */
export async function waitForTransactionReceipt(
  provider: EthereumProvider,
  txHash: `0x${string}`,
  options: {
    timeout?: number;
    requiredConfirmations?: number;
    pollingInterval?: number;
  } = {},
): Promise<{
  success: boolean;
  receipt?: TransactionReceipt;
  confirmations?: number;
  error?: string;
}> {
  const {
    timeout = 300000, // 5 minutes default
    requiredConfirmations = 1,
    pollingInterval = 2000,
  } = options;

  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      // Get transaction receipt
      const receipt = (await provider.request({
        method: 'eth_getTransactionReceipt',
        params: [txHash],
      })) as TransactionReceipt | null;

      if (!receipt) {
        await wait(pollingInterval);
        continue;
      }

      // Check if transaction failed
      if (receipt.status === 'reverted') {
        return {
          success: false,
          error: 'Transaction failed (reverted)',
          receipt,
        };
      }

      // Get current block number for confirmation count
      const currentBlockNumber = (await provider.request({
        method: 'eth_blockNumber',
        params: [],
      })) as string;

      const confirmations =
        parseInt(currentBlockNumber, 16) - parseInt(receipt.blockNumber.toString(), 16) + 1;

      // Check if we have enough confirmations
      if (confirmations >= requiredConfirmations) {
        return {
          success: true,
          receipt,
          confirmations,
        };
      }

      await wait(pollingInterval);
    } catch (error) {
      // Continue polling if there's a temporary error
      console.warn('Error waiting for transaction receipt', error);
      await wait(pollingInterval);
    }
  }

  return {
    success: false,
    error: 'Transaction receipt timeout',
  };
}
