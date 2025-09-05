import { useMemo } from 'react';
import {
  TOKEN_METADATA,
  TESTNET_TOKEN_METADATA,
  TOKEN_CONTRACT_ADDRESSES,
  DESTINATION_SWAP_TOKENS,
  type TokenMetadata,
} from '@nexus/commons';
import type { TransactionType } from './balance-utils';

/**
 * Enhanced token metadata for UI components
 */
export interface EnhancedTokenMetadata extends TokenMetadata {
  contractAddress?: `0x${string}`;
}

/**
 * Token selection options for UI components
 */
export interface TokenSelectOption {
  value: string;
  label: string;
  icon: string;
  metadata: EnhancedTokenMetadata;
}

/**
 * Parameters for token resolution
 */
export interface TokenResolutionParams {
  chainId?: number;
  type: TransactionType;
  network?: 'mainnet' | 'testnet';
  isDestination?: boolean;
}

/**
 * Get base token metadata based on network
 */
function getBaseTokenMetadata(
  network: 'mainnet' | 'testnet' = 'mainnet',
): Record<string, TokenMetadata> {
  return network === 'testnet' ? TESTNET_TOKEN_METADATA : TOKEN_METADATA;
}

/**
 * Convert destination swap token to standard token metadata format
 */
function convertDestinationTokenToMetadata(
  destinationToken: NonNullable<ReturnType<typeof DESTINATION_SWAP_TOKENS.get>>[0],
): EnhancedTokenMetadata {
  return {
    symbol: destinationToken.symbol,
    name: destinationToken.name,
    decimals: destinationToken.decimals,
    icon: destinationToken.logo,
    coingeckoId: '', // Not provided in destination tokens
    contractAddress: destinationToken.tokenAddress,
  };
}

/**
 * Get available tokens for a specific chain and transaction type
 * Follows Single Responsibility Principle - only handles token resolution
 */
export function getAvailableTokens(params: TokenResolutionParams): EnhancedTokenMetadata[] {
  const { chainId, type, network = 'mainnet', isDestination = false } = params;

  const baseTokens = Object.values(getBaseTokenMetadata(network));

  // For non-swap transactions or source selection, return base tokens only
  if (type !== 'swap' || !isDestination) {
    return baseTokens.map((token) => ({
      ...token,
      contractAddress: TOKEN_CONTRACT_ADDRESSES[token.symbol]?.[chainId || 0],
    }));
  }

  // For swap destination selection, merge base tokens with destination tokens
  let allDestinationTokens: ReturnType<typeof convertDestinationTokenToMetadata>[] = [];

  if (chainId) {
    // If chain is selected, show tokens for that specific chain
    const destinationTokens = DESTINATION_SWAP_TOKENS.get(chainId) || [];
    allDestinationTokens = destinationTokens
      .filter((destToken) => !baseTokens.some((baseToken) => baseToken.symbol === destToken.symbol))
      .map(convertDestinationTokenToMetadata);
  } else {
    // If no chain selected, show ALL destination tokens from all chains (deduplicated)
    const allChainTokens = Array.from(DESTINATION_SWAP_TOKENS.values()).flat();
    const uniqueTokens = new Map<string, (typeof allChainTokens)[0]>();

    // Deduplicate tokens by symbol, keeping the first occurrence
    allChainTokens.forEach((token) => {
      if (
        !uniqueTokens.has(token.symbol) &&
        !baseTokens.some((baseToken) => baseToken.symbol === token.symbol)
      ) {
        uniqueTokens.set(token.symbol, token);
      }
    });

    allDestinationTokens = Array.from(uniqueTokens.values()).map(convertDestinationTokenToMetadata);
  }

  // Merge base tokens with destination tokens
  const enhancedBaseTokens = baseTokens.map((token) => ({
    ...token,
    contractAddress: TOKEN_CONTRACT_ADDRESSES[token.symbol]?.[chainId || 0],
  }));

  return [...enhancedBaseTokens, ...allDestinationTokens];
}

/**
 * Convert enhanced token metadata to UI selection options
 * Follows Interface Segregation Principle - provides only what UI needs
 */
export function convertTokensToSelectOptions(tokens: EnhancedTokenMetadata[]): TokenSelectOption[] {
  return tokens.map((token) => ({
    value: token.symbol,
    label: token.symbol,
    icon: token.icon,
    metadata: token,
  }));
}

/**
 * React hook for token resolution with memoization
 * Follows DRY principle and provides performance optimization
 */
export function useAvailableTokens(params: TokenResolutionParams): TokenSelectOption[] {
  return useMemo(() => {
    const tokens = getAvailableTokens(params);
    return convertTokensToSelectOptions(tokens);
  }, [params.chainId, params.type, params.network, params.isDestination]);
}

/**
 * Get token contract address with enhanced resolution
 * Follows Open/Closed Principle - extensible for new token sources
 */
export function getTokenAddress(
  tokenSymbol: string,
  chainId: number,
  type: TransactionType = 'transfer',
): `0x${string}` {
  // Try standard TOKEN_CONTRACT_ADDRESSES first
  const standardAddress = TOKEN_CONTRACT_ADDRESSES[tokenSymbol]?.[chainId];
  if (standardAddress) {
    return standardAddress;
  }

  // For swaps, check DESTINATION_SWAP_TOKENS
  if (type === 'swap') {
    const chainTokens = DESTINATION_SWAP_TOKENS.get(chainId);
    const destinationToken = chainTokens?.find((t) => t.symbol === tokenSymbol);
    if (destinationToken) {
      return destinationToken.tokenAddress;
    }
  }

  throw new Error(`Token ${tokenSymbol} not supported on chain ${chainId}`);
}

/**
 * Check if a token is available on a specific chain
 * Follows Liskov Substitution Principle - can be used wherever boolean is expected
 */
export function isTokenAvailableOnChain(
  tokenSymbol: string,
  chainId: number,
  type: TransactionType = 'transfer',
): boolean {
  try {
    getTokenAddress(tokenSymbol, chainId, type);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get token metadata by symbol with enhanced resolution
 * Follows Dependency Inversion Principle - depends on abstractions, not concretions
 */
export function getTokenMetadata(
  tokenSymbol: string,
  chainId?: number,
  type: TransactionType = 'transfer',
  network: 'mainnet' | 'testnet' = 'mainnet',
): EnhancedTokenMetadata | null {
  // Try base tokens first
  const baseTokens = getBaseTokenMetadata(network);
  const baseToken = baseTokens[tokenSymbol];

  if (baseToken) {
    return {
      ...baseToken,
      contractAddress: chainId ? TOKEN_CONTRACT_ADDRESSES[tokenSymbol]?.[chainId] : undefined,
    };
  }

  // For swaps, check destination tokens
  if (type === 'swap' && chainId) {
    const chainTokens = DESTINATION_SWAP_TOKENS.get(chainId);
    const destinationToken = chainTokens?.find((t) => t.symbol === tokenSymbol);

    if (destinationToken) {
      return convertDestinationTokenToMetadata(destinationToken);
    }
  }

  return null;
}

/**
 * Filter tokens based on availability for a specific chain
 * Utility function for component-level filtering
 */
export function filterTokensByChainAvailability(
  tokens: EnhancedTokenMetadata[],
  chainId: number,
  type: TransactionType = 'transfer',
): EnhancedTokenMetadata[] {
  return tokens.filter((token) => isTokenAvailableOnChain(token.symbol, chainId, type));
}

/**
 * Get supported chain IDs for a specific token in swap context
 * Returns all chains where the token is available
 */
export function getSupportedChainsForToken(
  tokenSymbol: string,
  type: TransactionType = 'transfer',
  network: 'mainnet' | 'testnet' = 'mainnet',
): number[] {
  const supportedChains: number[] = [];
  console.log('network', network);
  // Check standard token contract addresses
  const tokenContracts = TOKEN_CONTRACT_ADDRESSES[tokenSymbol];
  if (tokenContracts) {
    supportedChains.push(...Object.keys(tokenContracts).map(Number));
  }

  // For swaps, also check destination swap tokens
  if (type === 'swap') {
    for (const [chainId, tokens] of DESTINATION_SWAP_TOKENS.entries()) {
      const hasToken = tokens.some((token) => token.symbol === tokenSymbol);
      if (hasToken && !supportedChains.includes(chainId)) {
        supportedChains.push(chainId);
      }
    }
  }

  return supportedChains.sort((a, b) => a - b);
}

/**
 * Check if a token-chain combination is valid for swaps
 * Used for validation and reset logic
 */
export function isTokenChainCombinationValid(
  tokenSymbol?: string,
  chainId?: number,
  type: TransactionType = 'transfer',
): boolean {
  if (!tokenSymbol || !chainId) return true; // Allow empty selections

  return isTokenAvailableOnChain(tokenSymbol, chainId, type);
}

/**
 * Get chains that should be available based on selected token for swaps
 * Filters out chains that don't support the selected token
 */
export function getFilteredChainsForToken(
  tokenSymbol: string | undefined,
  availableChains: number[],
  type: TransactionType = 'transfer',
): number[] {
  // For non-swap transactions or no token selected, return all chains
  if (type !== 'swap' || !tokenSymbol) {
    return availableChains;
  }

  // Get chains that support this token
  const supportedChains = getSupportedChainsForToken(tokenSymbol, type);

  // Return intersection of available chains and supported chains
  return availableChains.filter((chainId) => supportedChains.includes(chainId));
}
