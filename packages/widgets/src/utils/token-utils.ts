import { useMemo } from 'react';
import {
  TOKEN_METADATA,
  TESTNET_TOKEN_METADATA,
  TOKEN_CONTRACT_ADDRESSES,
  DESTINATION_SWAP_TOKENS,
  type TokenMetadata,
} from '@nexus/commons';
import type { TransactionType } from './balance-utils';
import type { NexusSDK } from '@nexus/core';
import type { SwapSupportedChainsResult } from '@nexus/commons';

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
  sdk?: NexusSDK;
}

/**
 * SDK-provided swap support data structure (normalized from SwapSupportedChainsResult)
 */
export interface SwapSupportData {
  chains: { id: number; name: string; logo: string }[];
  tokens: {
    symbol: string;
    address: string;
    decimals: number;
    name?: string;
    logo?: string;
  }[];
  chainTokenMap: Map<number, string[]>;
  tokenChainMap: Map<string, number[]>;
}

const WETH_LOGO_URL = 'https://assets.coingecko.com/coins/images/279/large/ethereum.png?1595348880';
const USDS_LOGO_URL =
  'https://static.debank.com/image/token/logo_url/base_usds/820c137fa70c8691f0e44dc420a5e53c168921dc.png';

/**
 * Get base token metadata based on network
 */
function getBaseTokenMetadata(
  _network: 'mainnet' | 'testnet' = 'mainnet',
): Record<string, TokenMetadata> {
  return _network === 'testnet' ? TESTNET_TOKEN_METADATA : TOKEN_METADATA;
}

/**
 * Get swap supported chains and tokens from SDK
 * Only for source side (as per SDK function behavior)
 */
export function getSwapSupportDataFromSDK(sdk: NexusSDK): SwapSupportData | null {
  try {
    const swapSupport: SwapSupportedChainsResult = sdk?.utils?.getSwapSupportedChainsAndTokens?.();
    if (!swapSupport || !Array.isArray(swapSupport)) return null;

    const chains = swapSupport.map((chain) => ({
      id: chain.id,
      name: chain.name,
      logo: chain.logo,
    }));

    const chainTokenMap = new Map<number, string[]>();
    const tokenChainMap = new Map<string, number[]>();
    const allTokens = new Map<string, any>();

    for (const chain of swapSupport) {
      const tokenSymbols: string[] = [];
      for (const token of chain.tokens) {
        // Add logo if missing
        if (token.symbol === 'WETH' && !token.logo) {
          token.logo = WETH_LOGO_URL;
        }
        if (token.symbol === 'USDS' && !token.logo) {
          token.logo = USDS_LOGO_URL;
        }

        tokenSymbols.push(token.symbol);

        if (!tokenChainMap.has(token.symbol)) {
          tokenChainMap.set(token.symbol, []);
        }
        tokenChainMap.get(token.symbol)!.push(chain.id);

        if (!allTokens.has(token.symbol)) {
          allTokens.set(token.symbol, {
            symbol: token.symbol,
            address: token.contractAddress,
            decimals: token.decimals,
            name: token.name,
            logo: token.logo,
          });
        }
      }
      chainTokenMap.set(chain.id, tokenSymbols);
    }

    return {
      chains,
      tokens: Array.from(allTokens.values()),
      chainTokenMap,
      tokenChainMap,
    };
  } catch (error) {
    console.warn('Failed to fetch swap support data from SDK:', error);
    return null;
  }
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
 */
export function getAvailableTokens(params: TokenResolutionParams): EnhancedTokenMetadata[] {
  const { chainId, type, network = 'mainnet', isDestination = false } = params;

  const baseTokens = Object.values(getBaseTokenMetadata(network));

  // For non-swap transactions, return base tokens only
  if (type !== 'swap') {
    return baseTokens.map((token) => ({
      ...token,
      contractAddress: TOKEN_CONTRACT_ADDRESSES[token.symbol]?.[chainId || 0],
    }));
  }

  // For swap source selection, fallback to base tokens (async version should be used with SDK)
  if (!isDestination) {
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
 * For swap source tokens, uses SDK's getSwapSupportedChainsAndTokens()
 */
export function getAvailableSwapTokens(params: TokenResolutionParams): EnhancedTokenMetadata[] {
  const { chainId, type, isDestination = false, sdk } = params;

  // For non-swap transactions, use synchronous version
  if (type !== 'swap') {
    return getAvailableTokens(params);
  }

  // For swap source selection with SDK, use SDK data
  if (!isDestination && sdk) {
    const swapSupportData = getSwapSupportDataFromSDK(sdk);
    if (swapSupportData) {
      let sdkTokens = swapSupportData.tokens;

      // Filter by chain if specified
      if (chainId) {
        const supportedTokenSymbols = swapSupportData.chainTokenMap.get(chainId) || [];
        sdkTokens = sdkTokens.filter((token) => supportedTokenSymbols.includes(token.symbol));
      }

      // Convert SDK tokens to enhanced metadata format
      return sdkTokens.map((token) => ({
        symbol: token.symbol,
        name: token.name || token.symbol,
        decimals: token.decimals,
        icon: token.logo || '',
        coingeckoId: '', // Not provided by SDK
        contractAddress: token.address as `0x${string}`,
      }));
    }
  }

  // Fallback to synchronous version
  return getAvailableTokens(params);
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
 * Note: For swap source tokens with SDK, use useAvailableTokensAsync
 */
export function useAvailableTokens(params: TokenResolutionParams): TokenSelectOption[] {
  return useMemo(() => {
    const tokens = getAvailableTokens(params);
    return convertTokensToSelectOptions(tokens);
  }, [params.chainId, params.type, params.network, params.isDestination, params.sdk]);
}

/**
 * Async React hook for token resolution that supports SDK data for swap source tokens
 * Returns { tokens, loading, error } for better UX during async operations
 */
export function useAvailableSwapTokens(params: TokenResolutionParams): {
  tokens: TokenSelectOption[];
} {
  let tokens: TokenSelectOption[];

  const fetchedTokens = getAvailableSwapTokens(params);
  if (fetchedTokens) {
    const tokenOptions = convertTokensToSelectOptions(fetchedTokens);
    tokens = tokenOptions;
  } else {
    const fallbackTokens = getAvailableTokens(params);
    tokens = convertTokensToSelectOptions(fallbackTokens);
  }

  return { tokens };
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
  _network: 'mainnet' | 'testnet' = 'mainnet',
): number[] {
  const supportedChains: number[] = [];
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
 * Async version that uses SDK data for swap source tokens
 */
export function getSupportedSwapChainsForToken(
  tokenSymbol: string,
  type: TransactionType = 'transfer',
  _network: 'mainnet' | 'testnet' = 'mainnet',
  sdk?: NexusSDK,
): number[] {
  // For non-swap transactions, use synchronous version
  if (type !== 'swap') {
    return getSupportedChainsForToken(tokenSymbol, type, _network);
  }

  // For swap source tokens with SDK, check SDK data first
  if (sdk) {
    const swapSupportData = getSwapSupportDataFromSDK(sdk);
    if (swapSupportData && swapSupportData.tokenChainMap.has(tokenSymbol)) {
      return (swapSupportData.tokenChainMap.get(tokenSymbol) || []).sort((a, b) => a - b);
    }
  }

  // Fallback to synchronous version
  return getSupportedChainsForToken(tokenSymbol, type, _network);
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

export function getFilteredSwapChainsForToken(
  tokenSymbol: string | undefined,
  availableChains: number[],
  type: TransactionType = 'transfer',
  sdk?: NexusSDK,
): number[] {
  // For non-swap transactions or no token selected, return all chains
  if (type !== 'swap' || !tokenSymbol) {
    return availableChains;
  }

  // Get chains that support this token (with SDK data for swaps)
  const supportedChains = getSupportedSwapChainsForToken(tokenSymbol, type, 'mainnet', sdk);

  // Return intersection of available chains and supported chains
  return availableChains.filter((chainId) => supportedChains.includes(chainId));
}
