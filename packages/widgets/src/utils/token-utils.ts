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
export interface TransactionSupportData {
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

const LOGO_URLS: Record<string, string> = {
  WETH: 'https://assets.coingecko.com/coins/images/279/large/ethereum.png?1595348880',
  USDS: 'https://static.debank.com/image/token/logo_url/base_usds/820c137fa70c8691f0e44dc420a5e53c168921dc.png',
  SOPH: 'https://assets.coingecko.com/coins/images/38680/large/sophon_logo_200.png',
  KAIA: 'https://assets.coingecko.com/asset_platforms/images/9672/large/kaia.png',
  BNB: 'https://assets.coingecko.com/coins/images/825/large/bnb-icon2_2x.png',
};

function _processSdkData(sdkData: SwapSupportedChainsResult | null): TransactionSupportData | null {
  if (!sdkData || !Array.isArray(sdkData)) return null;

  const chains = sdkData.map((chain) => ({
    id: chain.id,
    name: chain.name,
    logo: chain.logo,
  }));

  const chainTokenMap = new Map<number, string[]>();
  const tokenChainMap = new Map<string, number[]>();
  const allTokens = new Map<string, any>();

  for (const chain of sdkData) {
    const tokenSymbols: string[] = [];
    // Guard against chains that might not have a tokens array
    for (const token of chain.tokens || []) {
      // Enhanced logo fallback logic
      let finalLogo = token.logo;
      if (!finalLogo && LOGO_URLS[token.symbol]) {
        finalLogo = LOGO_URLS[token.symbol];
      }

      // For native tokens (zero address), ensure they have proper logos
      if (token.contractAddress === '0x0000000000000000000000000000000000000000') {
        if (!finalLogo) {
          // Use chain-specific native token logos
          const nativeTokenLogos: Record<number, string> = {
            137: 'https://coin-images.coingecko.com/coins/images/32440/standard/polygon.png', // POL
            43114:
              'https://assets.coingecko.com/coins/images/12559/standard/Avalanche_Circle_RedWhite_Trans.png', // AVAX
            56: 'https://assets.coingecko.com/coins/images/825/large/bnb-icon2_2x.png', // BNB
            8217: 'https://assets.coingecko.com/asset_platforms/images/9672/large/kaia.png', // KAIA
            50104: 'https://assets.coingecko.com/coins/images/38680/large/sophon_logo_200.png', // SOPH
          };
          finalLogo = nativeTokenLogos[chain.id] || '';
        }
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
          name: token.name || token.symbol,
          logo: finalLogo,
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
}

/**
 * Get base token metadata based on network
 */
function getBaseTokenMetadata(
  _network: 'mainnet' | 'testnet' = 'mainnet',
): Record<string, TokenMetadata> {
  return _network === 'testnet' ? TESTNET_TOKEN_METADATA : TOKEN_METADATA;
}

const transactionSupportDataCache = new Map<TransactionType, TransactionSupportData | null>();

/**
 * Gets and processes support data for a given transaction type from the SDK.
 * This function caches the processed data to avoid redundant calls and processing.
 * @param sdk The NexusSDK instance.
 * @param type The type of transaction.
 * @returns Processed transaction support data or null.
 */
function getTransactionSupportData(
  sdk: NexusSDK,
  type: TransactionType,
): TransactionSupportData | null {
  if (transactionSupportDataCache.has(type)) {
    return transactionSupportDataCache.get(type)!;
  }

  let rawData: SwapSupportedChainsResult | null = null;
  try {
    if (type === 'swap') {
      rawData = sdk?.utils?.getSwapSupportedChainsAndTokens?.();
    } else {
      // getSupportedChains actually returns the same structure as getSwapSupportedChainsAndTokens
      // despite what the TypeScript types say
      rawData = sdk?.utils?.getSupportedChains?.() as SwapSupportedChainsResult;
    }
  } catch (error) {
    console.warn(`Failed to fetch support data for ${type} from SDK:`, error);
    transactionSupportDataCache.set(type, null);
    return null;
  }

  const processedData = _processSdkData(rawData);
  transactionSupportDataCache.set(type, processedData);

  return processedData;
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
 * Get available tokens for a specific chain and transaction type.
 * This function is the single source of truth for token resolution.
 * It handles all transaction types and uses a caching mechanism for performance.
 */
export function getAvailableTokens(params: TokenResolutionParams): EnhancedTokenMetadata[] {
  const { chainId, type, network = 'mainnet', isDestination = false, sdk } = params;

  // Handle swap destination tokens separately as they come from a different source (static list).
  if (type === 'swap' && isDestination) {
    const baseTokens = Object.values(getBaseTokenMetadata(network));
    let allDestinationTokens: ReturnType<typeof convertDestinationTokenToMetadata>[] = [];

    if (chainId) {
      const destinationTokens = DESTINATION_SWAP_TOKENS.get(chainId) || [];
      allDestinationTokens = destinationTokens
        .filter(
          (destToken) => !baseTokens.some((baseToken) => baseToken.symbol === destToken.symbol),
        )
        .map(convertDestinationTokenToMetadata);
    } else {
      const allChainTokens = Array.from(DESTINATION_SWAP_TOKENS.values()).flat();
      const uniqueTokens = new Map<string, (typeof allChainTokens)[0]>();
      allChainTokens.forEach((token) => {
        if (
          !uniqueTokens.has(token.symbol) &&
          !baseTokens.some((baseToken) => baseToken.symbol === token.symbol)
        ) {
          uniqueTokens.set(token.symbol, token);
        }
      });
      allDestinationTokens = Array.from(uniqueTokens.values()).map(
        convertDestinationTokenToMetadata,
      );
    }
    const enhancedBaseTokens = baseTokens.map((token) => ({
      ...token,
      contractAddress: TOKEN_CONTRACT_ADDRESSES[token.symbol]?.[chainId || 0],
    }));
    return [...enhancedBaseTokens, ...allDestinationTokens];
  }

  // For swap source tokens, combine data from both getSupportedChains and getSwapSupportedChainsAndTokens
  // to include both native tokens and swappable ERC20 tokens
  if (type === 'swap' && !isDestination && sdk) {
    const allTokens = new Map<string, any>();

    // First get native tokens from getSupportedChains
    try {
      const supportedChainsData = sdk?.utils?.getSupportedChains?.() as SwapSupportedChainsResult;
      if (supportedChainsData && Array.isArray(supportedChainsData)) {
        const processedSupportedChainsData = _processSdkData(supportedChainsData);
        if (processedSupportedChainsData) {
          let supportedChainsTokens = processedSupportedChainsData.tokens;

          if (chainId) {
            const supportedSymbols = processedSupportedChainsData.chainTokenMap.get(chainId) || [];
            supportedChainsTokens = supportedChainsTokens.filter((t) =>
              supportedSymbols.includes(t.symbol),
            );
          }

          // Only include native tokens (zero address) from getSupportedChains
          supportedChainsTokens
            .filter((token) => token.address === '0x0000000000000000000000000000000000000000')
            .forEach((token) => {
              if (!allTokens.has(token.symbol)) {
                allTokens.set(token.symbol, {
                  symbol: token.symbol,
                  name: token.name || token.symbol,
                  decimals: token.decimals,
                  icon: token.logo || '',
                  coingeckoId: '',
                  contractAddress: token.address as `0x${string}`,
                });
              }
            });
        }
      }
    } catch (error) {
      console.warn('Failed to fetch supported chains data for swap source:', error);
    }

    // Then get swappable ERC20 tokens from getSwapSupportedChainsAndTokens
    const swapSupportData = getTransactionSupportData(sdk, type);
    if (swapSupportData) {
      let swapTokensToDisplay = swapSupportData.tokens;

      if (chainId) {
        const supportedSymbols = swapSupportData.chainTokenMap.get(chainId) || [];
        swapTokensToDisplay = swapTokensToDisplay.filter((t) =>
          supportedSymbols.includes(t.symbol),
        );
      }

      swapTokensToDisplay.forEach((token) => {
        if (!allTokens.has(token.symbol)) {
          allTokens.set(token.symbol, {
            symbol: token.symbol,
            name: token.name || token.symbol,
            decimals: token.decimals,
            icon: token.logo || '',
            coingeckoId: '',
            contractAddress: token.address as `0x${string}`,
          });
        }
      });
    }

    return Array.from(allTokens.values());
  }

  // For all other cases (transfer, bridge, bridgeAndExecute), use the SDK data.
  if (sdk) {
    const supportData = getTransactionSupportData(sdk, type);
    if (supportData) {
      let tokensToDisplay = supportData.tokens;

      if (chainId) {
        const supportedSymbols = supportData.chainTokenMap.get(chainId) || [];
        tokensToDisplay = tokensToDisplay.filter((t) => supportedSymbols.includes(t.symbol));
      }

      return tokensToDisplay.map((token) => {
        return {
          symbol: token.symbol,
          name: token.name || token.symbol,
          decimals: token.decimals,
          icon: token.logo || '',
          coingeckoId: '', // Not provided by SDK
          contractAddress: token.address as `0x${string}`,
        };
      });
    }
  }

  // Fallback for non-SDK or failed SDK calls.
  const baseTokens = Object.values(getBaseTokenMetadata(network));
  return baseTokens.map((token) => ({
    ...token,
    contractAddress: TOKEN_CONTRACT_ADDRESSES[token.symbol]?.[chainId || 0],
  }));
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
 * React hook for token resolution with memoization.
 * This is the single hook for fetching available tokens for all transaction types.
 */
export function useAvailableTokens(params: TokenResolutionParams): TokenSelectOption[] {
  // The useMemo hook is crucial for performance, preventing re-computation on every render.
  return useMemo(() => {
    const tokens = getAvailableTokens(params);
    return convertTokensToSelectOptions(tokens);
  }, [params.chainId, params.type, params.network, params.isDestination, params.sdk]);
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
 * Get supported chain IDs for a specific token and transaction type.
 * This is the single source of truth for chain resolution.
 */
export function getSupportedChainsForToken(
  tokenSymbol: string,
  type: TransactionType,
  sdk?: NexusSDK,
  isDestination?: boolean,
): number[] {
  // For swap destination, use the static list + base tokens.
  if (type === 'swap' && isDestination) {
    const supportedChains = new Set<number>();

    // Check DESTINATION_SWAP_TOKENS
    for (const [chainId, tokens] of DESTINATION_SWAP_TOKENS.entries()) {
      if (tokens.some((token) => token.symbol === tokenSymbol)) {
        supportedChains.add(chainId);
      }
    }

    // Check base tokens (TOKEN_CONTRACT_ADDRESSES)
    const tokenContracts = TOKEN_CONTRACT_ADDRESSES[tokenSymbol];
    if (tokenContracts) {
      Object.keys(tokenContracts).forEach((chainId) => supportedChains.add(Number(chainId)));
    }

    return Array.from(supportedChains).sort((a, b) => a - b);
  }

  // For swap source, combine chains from both getSupportedChains and getSwapSupportedChainsAndTokens
  if (type === 'swap' && !isDestination && sdk) {
    const supportedChains = new Set<number>();

    // Get chains from getSupportedChains (for native tokens)
    try {
      const supportedChainsData = sdk?.utils?.getSupportedChains?.() as SwapSupportedChainsResult;
      if (supportedChainsData && Array.isArray(supportedChainsData)) {
        const processedData = _processSdkData(supportedChainsData);
        if (processedData) {
          const chains = processedData.tokenChainMap.get(tokenSymbol) || [];
          chains.forEach((chainId) => supportedChains.add(chainId));
        }
      }
    } catch (error) {
      console.warn('Failed to fetch supported chains for token:', error);
    }

    // Get chains from getSwapSupportedChainsAndTokens (for ERC20 tokens)
    const swapSupportData = getTransactionSupportData(sdk, type);
    if (swapSupportData) {
      const chains = swapSupportData.tokenChainMap.get(tokenSymbol) || [];
      chains.forEach((chainId) => supportedChains.add(chainId));
    }

    return Array.from(supportedChains).sort((a, b) => a - b);
  }

  // For all other cases (transfer, bridge, bridgeAndExecute), use the SDK data.
  if (sdk) {
    const supportData = getTransactionSupportData(sdk, type);
    if (supportData) {
      return (supportData.tokenChainMap.get(tokenSymbol) || []).sort((a, b) => a - b);
    }
  }

  // Fallback for non-SDK or failed SDK calls.
  const tokenContracts = TOKEN_CONTRACT_ADDRESSES[tokenSymbol];
  if (tokenContracts) {
    return Object.keys(tokenContracts)
      .map(Number)
      .sort((a, b) => a - b);
  }

  return [];
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
 * Get chains that should be available based on a selected token.
 * Filters a list of available chains against chains that support the token.
 */
export function getFilteredChainsForToken(
  tokenSymbol: string | undefined,
  availableChains: number[],
  type: TransactionType,
  sdk?: NexusSDK,
  isDestination?: boolean,
): number[] {
  if (!tokenSymbol) {
    return availableChains;
  }

  const supportedChains = getSupportedChainsForToken(tokenSymbol, type, sdk, isDestination);
  return availableChains.filter((chainId) => supportedChains.includes(chainId));
}
