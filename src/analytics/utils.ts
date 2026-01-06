/**
 * Analytics Utility Functions
 * Helper functions for extracting analytics properties from SDK data structures
 */

import Decimal from 'decimal.js';
import type { ReadableIntent, SuccessfulSwapResult, UserAssetDatum } from '../commons';

/**
 * Detect wallet type from provider
 * @param provider - Ethereum provider object
 * @returns Wallet type string (MetaMask, Coinbase, WalletConnect, etc.)
 */

// biome-ignore lint/suspicious/noExplicitAny: check later
export function getWalletType(provider: any): string {
  if (!provider) return 'Unknown';

  // Check for common wallet provider flags
  if (provider.isCoinbaseWallet) return 'Coinbase Wallet';
  if (provider.isWalletConnect) return 'WalletConnect';
  if (provider.isTrust) return 'Trust Wallet';
  if (provider.isRabby) return 'Rabby';
  if (provider.isBraveWallet) return 'Brave Wallet';
  if (provider.isExodus) return 'Exodus';
  if (provider.isAmbire) return 'Ambire Wallet';
  if (provider.isMetaMask) return 'MetaMask'; // placing metamask last to avoid false positives

  // Try to get from constructor name
  if (provider.constructor?.name && provider.constructor.name !== 'Object') {
    return provider.constructor.name;
  }

  // Check for provider session (WalletConnect v2)
  if (provider.session) return 'WalletConnect v2';

  return 'Unknown';
}

/**
 * Calculate USD value from token amount and oracle prices
 * @param token - Token symbol (e.g., 'USDC', 'ETH')
 * @param amount - Token amount as bigint or string
 * @param oraclePrices - Oracle price data (if available)
 * @returns USD value or undefined if cannot calculate
 */
export function calculateUsdValue(
  token: string,
  amount: bigint | string | number,
  oraclePrices?: Record<string, number>
): number | undefined {
  if (!oraclePrices || !oraclePrices[token]) {
    return undefined;
  }

  try {
    // Convert amount to number (handle bigint, string, number)
    let numericAmount: number;
    if (typeof amount === 'bigint') {
      // Assuming 6 decimals for most stablecoins, 18 for ETH
      // This is a simplification - real implementation should know token decimals
      const decimals = token === 'ETH' ? 18 : 6;
      numericAmount = Number(amount) / 10 ** decimals;
    } else if (typeof amount === 'string') {
      numericAmount = Number.parseFloat(amount);
    } else {
      numericAmount = amount;
    }

    const price = oraclePrices[token];
    return numericAmount * price;
  } catch (_error) {
    return undefined;
  }
}

/**
 * Extract analytics properties from bridge/transfer intent
 * @param intent - Intent object from CA SDK
 * @returns Object with sourceChains, totalBreakdowns, and other properties
 */
export function extractIntentProperties(intent: ReadableIntent): Record<string, unknown> {
  if (!intent) return {};

  const props: Record<string, unknown> = {};

  // Extract source chains
  if (intent.sources && Array.isArray(intent.sources)) {
    props.sourceChains = intent.sources.map((s) => s.chainID).filter(Boolean);
    props.totalBreakdowns = intent.sources.length;
  }

  // Extract destination chain
  if (intent.destination) {
    props.destinationChainId = intent.destination.chainID;
  }

  // Extract token info
  if (intent.token) {
    props.token = intent.token.symbol || intent.token;
  }

  // Extract amount
  if (intent.sourcesTotal !== undefined) {
    props.amount = intent.sourcesTotal;
  }

  // Extract fees if available
  if (intent.fees) {
    props.fees = intent.fees;
  }

  return props;
}

/**
 * Extract breakdown statistics from balance assets
 * @param assets - Array of user assets from balance query
 * @returns Object with totalBreakdowns, chains, and tokens
 */
export function extractBreakdownStats(assets: UserAssetDatum[]): {
  totalBreakdowns: number;
  chains: number[];
  tokens: string[];
  balanceCount: number;
} {
  if (!Array.isArray(assets) || assets.length === 0) {
    return {
      totalBreakdowns: 0,
      chains: [],
      tokens: [],
      balanceCount: 0,
    };
  }

  const chains = new Set<number>();
  const tokens = new Set<string>();
  let totalBreakdowns = 0;

  for (const asset of assets) {
    // Count breakdowns
    if (asset.breakdown && Array.isArray(asset.breakdown)) {
      totalBreakdowns += asset.breakdown.length;

      // Extract chains and tokens from breakdowns
      for (const breakdown of asset.breakdown) {
        if (breakdown.chain?.id && new Decimal(breakdown.balance).greaterThan(0)) {
          chains.add(breakdown.chain.id);
        }
      }
    }

    // Extract token symbol
    if (asset.symbol && new Decimal(asset.balance).greaterThan(0)) {
      tokens.add(asset.symbol);
    }
  }

  return {
    totalBreakdowns,
    chains: Array.from(chains),
    tokens: Array.from(tokens),
    balanceCount: assets.length,
  };
}

/**
 * Sanitize URL to remove query parameters and sensitive data
 * @param url - URL string
 * @returns Sanitized URL without query params
 */
export function sanitizeUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;

  try {
    const urlObj = new URL(url);
    // Return URL without search params
    return `${urlObj.origin}${urlObj.pathname}`;
  } catch (_error) {
    // If URL parsing fails, just return the origin if it looks like a URL
    if (url.startsWith('http')) {
      return url.split('?')[0];
    }
    return undefined;
  }
}

/**
 * Extract error code from error object
 * @param error - Error object
 * @returns Error code or undefined
 */

// biome-ignore lint/suspicious/noExplicitAny: check later
export function extractErrorCode(error?: any): string | number | undefined {
  if (!error) return undefined;

  // Common error code locations
  return error.code || error.errorCode || error.statusCode || undefined;
}

/**
 * Extract properties from SwapRoute for analytics
 * @param swapRoute - SwapRoute object
 * @returns Object with sourceSwap, bridge, and destinationSwap properties
 */
export function extractSwapProperties(swaps: SuccessfulSwapResult): Record<string, unknown> {
  if (!swaps) return {};

  const props: Record<string, unknown> = {};

  // Extract source swap details
  if (swaps.sourceSwaps) {
    props.sourceSwaps = swaps.sourceSwaps.map((s) => ({
      chainId: s.chainId,
      sources: s.swaps.map((swp) => ({
        tokenContract: swp.inputContract,
        amount: new Decimal(swp.inputAmount.toString())
          .div(Decimal.pow(10, swp.inputDecimals))
          .toDecimalPlaces(swp.inputDecimals)
          .toFixed(),
      })),
      destinations: s.swaps.map((swp) => ({
        tokenContract: swp.outputContract,
        amount: new Decimal(swp.outputAmount.toString())
          .div(Decimal.pow(10, swp.outputDecimals))
          .toDecimalPlaces(swp.outputDecimals)
          .toFixed(),
      })),
    }));
  }

  // Extract bridge details
  if (swaps.swapRoute?.bridge) {
    props.bridge = {
      sources: swaps.swapRoute.bridge.assets?.map((s) => ({
        chainId: s.chainID,
        token: s.contractAddress,
      })),
      destination: {
        chainId: swaps.swapRoute.bridge.chainID,
        token: swaps.swapRoute.bridge.tokenAddress,
        amount: new Decimal(swaps.swapRoute.bridge.amount).toFixed(),
      },
    };
  }

  // Extract destination swap details
  if (swaps.destinationSwap) {
    props.destinationSwap = {
      chainId: swaps.destinationSwap.chainId,
      source: swaps.destinationSwap.swaps.map((s) => ({
        tokenContract: s.inputContract,
        amount: new Decimal(s.inputAmount.toString())
          .div(Decimal.pow(10, s.inputDecimals))
          .toDecimalPlaces(s.inputDecimals)
          .toFixed(),
      })),
      destination: swaps.destinationSwap.swaps.map((s) => ({
        tokenContract: s.outputContract,
        amount: new Decimal(s.outputAmount.toString())
          .div(Decimal.pow(10, s.outputDecimals))
          .toDecimalPlaces(s.outputDecimals)
          .toFixed(),
      })),
    };
  }

  return props;
}

/**
 * Extract properties from Bridge Intent for analytics
 * @param intent - Intent object
 * @returns Object with bridge property
 */
export function extractBridgeProperties(intent?: ReadableIntent): Record<string, unknown> {
  if (!intent) return {};

  return {
    bridge: {
      sources: intent.sources?.map((s) => ({
        chainId: s.chainID,
        token: s.contractAddress,
        amount: new Decimal(s.amount).toFixed(),
      })),
      destination: {
        chainId: intent.destination?.chainID,
        // token: intent.token.symbol,
        amount: new Decimal(intent.destination?.amount || 0).toFixed(),
      },
      fees: intent.fees,
    },
  };
}
