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
import type { SupportedChainsResult } from '@nexus/commons';

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
 * SDK-provided swap support data structure (normalized from SupportedChainsResult)
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
  USDS: 'https://assets.coingecko.com/coins/images/39926/standard/usds.webp?1726666683',
  SOPH: 'https://assets.coingecko.com/coins/images/38680/large/sophon_logo_200.png',
  KAIA: 'https://assets.coingecko.com/asset_platforms/images/9672/large/kaia.png',
  BNB: 'https://assets.coingecko.com/coins/images/825/large/bnb-icon2_2x.png',
  // Add ETH as fallback for any ETH-related tokens
  ETH: 'https://coin-images.coingecko.com/coins/images/279/large/ethereum.png?1696501628',
  // Add common token fallbacks
  POL: 'https://coin-images.coingecko.com/coins/images/32440/standard/polygon.png',
  AVAX: 'https://assets.coingecko.com/coins/images/12559/standard/Avalanche_Circle_RedWhite_Trans.png',
  FUEL: 'https://coin-images.coingecko.com/coins/images/279/large/ethereum.png',
  HYPE: 'https://assets.coingecko.com/asset_platforms/images/243/large/hyperliquid.png',
  // Popular swap tokens
  DAI: 'https://coin-images.coingecko.com/coins/images/9956/large/Badge_Dai.png?1696509996',
  UNI: 'https://coin-images.coingecko.com/coins/images/12504/large/uni.jpg?1696512319',
  AAVE: 'https://coin-images.coingecko.com/coins/images/12645/large/AAVE.png?1696512452',
  LDO: 'https://coin-images.coingecko.com/coins/images/13573/large/Lido_DAO.png?1696513326',
  PEPE: 'https://coin-images.coingecko.com/coins/images/29850/large/pepe-token.jpeg?1696528776',
  OP: 'https://coin-images.coingecko.com/coins/images/25244/large/Optimism.png?1696524385',
  ZRO: 'https://coin-images.coingecko.com/coins/images/28206/large/ftxG9_TJ_400x400.jpeg?1696527208',
  OM: 'https://assets.coingecko.com/coins/images/12151/standard/OM_Token.png?1696511991',
  KAITO: 'https://assets.coingecko.com/coins/images/54411/standard/Qm4DW488_400x400.jpg',
};

function _processSdkData(sdkData: SupportedChainsResult | null): TransactionSupportData | null {
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
      if (!finalLogo) {
        // First try direct lookup
        finalLogo = LOGO_URLS[token.symbol];

        // Handle wrapped tokens
        if (!finalLogo && token.symbol.startsWith('W') && token.symbol.length > 1) {
          const baseSymbol = token.symbol.substring(1);
          finalLogo = LOGO_URLS[baseSymbol];
        }

        // ETH fallback for ethereum-related tokens
        if (!finalLogo && (token.symbol.includes('ETH') || token.symbol === 'WETH')) {
          finalLogo = LOGO_URLS['ETH'];
        }
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

  let rawData: SupportedChainsResult | null = null;
  try {
    if (type === 'swap') {
      rawData = sdk?.utils?.getSwapSupportedChainsAndTokens?.();
    } else {
      // getSupportedChains actually returns the same structure as getSwapSupportedChainsAndTokens
      // despite what the TypeScript types say
      rawData = sdk?.utils?.getSupportedChains?.() as SupportedChainsResult;
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
    const result = [...enhancedBaseTokens, ...allDestinationTokens];
    return result;
  }

  // For swap source tokens, use only getSwapSupportedChainsAndTokens (ERC20 tokens only, no native tokens)
  if (type === 'swap' && !isDestination && sdk) {
    const supportData = getTransactionSupportData(sdk, type);
    if (supportData) {
      let tokensToDisplay = supportData.tokens;

      if (chainId) {
        const supportedSymbols = supportData.chainTokenMap.get(chainId) || [];
        tokensToDisplay = tokensToDisplay.filter((t) => supportedSymbols.includes(t.symbol));
      }

      const result = tokensToDisplay.map((token) => {
        // Enhanced icon resolution for token options
        let finalIcon = token.logo;
        if (!finalIcon) {
          finalIcon = LOGO_URLS[token.symbol];

          // Handle wrapped tokens
          if (!finalIcon && token.symbol.startsWith('W') && token.symbol.length > 1) {
            const baseSymbol = token.symbol.substring(1);
            finalIcon = LOGO_URLS[baseSymbol];
          }

          // ETH fallback for ethereum-related tokens
          if (!finalIcon && (token.symbol.includes('ETH') || token.symbol === 'WETH')) {
            finalIcon = LOGO_URLS['ETH'];
          }
        }

        return {
          symbol: token.symbol,
          name: token.name || token.symbol,
          decimals: token.decimals,
          icon: finalIcon || '',
          coingeckoId: '',
          contractAddress: token.address as `0x${string}`,
        };
      });
      return result;
    }
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

      const result = tokensToDisplay.map((token) => {
        // Enhanced icon resolution for token options
        let finalIcon = token.logo;
        if (!finalIcon) {
          finalIcon = LOGO_URLS[token.symbol];

          // Handle wrapped tokens
          if (!finalIcon && token.symbol.startsWith('W') && token.symbol.length > 1) {
            const baseSymbol = token.symbol.substring(1);
            finalIcon = LOGO_URLS[baseSymbol];
          }

          // ETH fallback for ethereum-related tokens
          if (!finalIcon && (token.symbol.includes('ETH') || token.symbol === 'WETH')) {
            finalIcon = LOGO_URLS['ETH'];
          }
        }

        return {
          symbol: token.symbol,
          name: token.name || token.symbol,
          decimals: token.decimals,
          icon: finalIcon || '',
          coingeckoId: '', // Not provided by SDK
          contractAddress: token.address as `0x${string}`,
        };
      });
      return result;
    } else {
    }
  }

  // Fallback for non-SDK or failed SDK calls.
  const baseTokens = Object.values(getBaseTokenMetadata(network));
  // For non-swap transactions, include native tokens
  if (type !== 'swap') {
    const allNativeTokens: Array<{
      symbol: string;
      name: string;
      decimals: number;
      icon: string;
      coingeckoId: string;
    }> = [
      {
        symbol: 'ETH',
        name: 'Ether',
        decimals: 18,
        icon: 'https://coin-images.coingecko.com/coins/images/279/large/ethereum.png',
        coingeckoId: 'ethereum',
      },
      {
        symbol: 'POL',
        name: 'POL',
        decimals: 18,
        icon: 'https://coin-images.coingecko.com/coins/images/32440/standard/polygon.png',
        coingeckoId: 'polygon-ecosystem-token',
      },
      {
        symbol: 'AVAX',
        name: 'Avalanche',
        decimals: 18,
        icon: 'https://assets.coingecko.com/coins/images/12559/standard/Avalanche_Circle_RedWhite_Trans.png',
        coingeckoId: 'avalanche-2',
      },
      {
        symbol: 'BNB',
        name: 'BNB',
        decimals: 18,
        icon: 'https://assets.coingecko.com/coins/images/825/large/bnb-icon2_2x.png',
        coingeckoId: 'binancecoin',
      },
      {
        symbol: 'KAIA',
        name: 'Kaia',
        decimals: 18,
        icon: 'https://assets.coingecko.com/asset_platforms/images/9672/large/kaia.png',
        coingeckoId: 'kaia',
      },
      {
        symbol: 'SOPH',
        name: 'Sophon',
        decimals: 18,
        icon: 'https://assets.coingecko.com/coins/images/38680/large/sophon_logo_200.png',
        coingeckoId: 'sophon',
      },
      {
        symbol: 'FUEL',
        name: 'Fuel',
        decimals: 9,
        icon: 'https://coin-images.coingecko.com/coins/images/279/large/ethereum.png',
        coingeckoId: 'ethereum',
      },
    ];

    // If a specific chain is selected, only include native token for that chain
    if (chainId) {
      const chainNativeTokens: Record<number, string> = {
        1: 'ETH', // Ethereum
        10: 'ETH', // Optimism
        137: 'POL', // Polygon
        8453: 'ETH', // Base
        42161: 'ETH', // Arbitrum
        534352: 'ETH', // Scroll
        43114: 'AVAX', // Avalanche
        56: 'BNB', // BNB Chain
        8217: 'KAIA', // Kaia
        50104: 'SOPH', // Sophon
        9889: 'FUEL', // Fuel
      };

      const nativeSymbol = chainNativeTokens[chainId];
      if (nativeSymbol) {
        const nativeToken = allNativeTokens.find((t) => t.symbol === nativeSymbol);
        if (nativeToken) {
          baseTokens.push(nativeToken);
        }
      }
    } else {
      // No chain selected, include all native tokens
      baseTokens.push(...allNativeTokens);
    }
  }

  const result = baseTokens.map((token) => {
    // Enhanced icon resolution for base tokens
    let finalIcon = token.icon;
    if (!finalIcon) {
      finalIcon = LOGO_URLS[token.symbol];

      // Handle wrapped tokens
      if (!finalIcon && token.symbol.startsWith('W') && token.symbol.length > 1) {
        const baseSymbol = token.symbol.substring(1);
        finalIcon = LOGO_URLS[baseSymbol];
      }

      // ETH fallback for ethereum-related tokens
      if (!finalIcon && (token.symbol.includes('ETH') || token.symbol === 'WETH')) {
        finalIcon = LOGO_URLS['ETH'];
      }
    }

    return {
      ...token,
      icon: finalIcon || token.icon,
      contractAddress: TOKEN_CONTRACT_ADDRESSES[token.symbol]?.[chainId || 0],
    };
  });
  return result;
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
  // For swaps, be more permissive to avoid aggressive token resets
  if (type === 'swap') {
    // Check if token exists in either base tokens or destination swap tokens
    const baseTokens = TOKEN_CONTRACT_ADDRESSES[tokenSymbol];
    if (baseTokens && baseTokens[chainId]) {
      return true;
    }

    const chainTokens = DESTINATION_SWAP_TOKENS.get(chainId);
    if (chainTokens?.some((t) => t.symbol === tokenSymbol)) {
      return true;
    }

    // For swap source tokens, be even more permissive since SDK data might be loading
    return true;
  }

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

  // For swap source, use only getSwapSupportedChainsAndTokens
  if (type === 'swap' && !isDestination && sdk) {
    const supportData = getTransactionSupportData(sdk, type);
    if (supportData) {
      return (supportData.tokenChainMap.get(tokenSymbol) || []).sort((a, b) => a - b);
    }
  }

  // For all other cases (transfer, bridge, bridgeAndExecute), use the SDK data.
  if (sdk) {
    const supportData = getTransactionSupportData(sdk, type);
    if (supportData) {
      return (supportData.tokenChainMap.get(tokenSymbol) || []).sort((a, b) => a - b);
    }
  }

  // Fallback for non-SDK or failed SDK calls.
  // For non-swap transactions, include both ERC20 contracts and native tokens on supported chains
  const supportedChains = new Set<number>();

  // Add chains from TOKEN_CONTRACT_ADDRESSES (ERC20 tokens)
  const tokenContracts = TOKEN_CONTRACT_ADDRESSES[tokenSymbol];
  if (tokenContracts) {
    Object.keys(tokenContracts).forEach((chainId) => supportedChains.add(Number(chainId)));
  }

  // Include native token chains if the token symbol matches a known native token
  const nativeTokens: Record<string, number[]> = {
    ETH: [1, 10, 8453, 42161, 534352, 11155111, 84532, 421614, 11155420, 534351], // Ethereum networks
    POL: [137, 80002], // Polygon
    AVAX: [43114, 43113], // Avalanche
    BNB: [56, 97], // BNB Chain
    KAIA: [8217, 82170], // Kaia
    SOPH: [50104], // Sophon
    FUEL: [9889, 10143], // Fuel
  };

  const nativeChains = nativeTokens[tokenSymbol];
  if (nativeChains) {
    nativeChains.forEach((chainId) => supportedChains.add(chainId));
  }

  return Array.from(supportedChains).sort((a, b) => a - b);
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

  // For swaps, be more lenient with validation to avoid aggressive resets
  // Let the user make selections and validate at execution time
  if (type === 'swap') {
    return true;
  }

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
