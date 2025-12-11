import {
  type SUPPORTED_CHAINS,
  truncateAddress as utilTruncateAddress,
  SupportedChainsResult,
  Network,
  ChainListType,
  formatTokenBalance as commonsFormatTokenBalance,
  formatTokenBalanceParts as commonsFormatTokenBalanceParts,
  SupportedChainsAndTokensResult,
} from '../commons';
import { getCoinbasePrices, getSupportedChains as fetchSupportedChains } from './ca-base/utils';
import { getSwapSupportedChains } from './ca-base/swap/utils';
import {
  formatUnits as viemFormatUnits,
  isAddress as viemIsAddress,
  parseUnits as viemParseUnits,
} from 'viem';

// Stateless utility exports
export const formatTokenBalance = commonsFormatTokenBalance;
export const formatTokenBalanceParts = commonsFormatTokenBalanceParts;
export const truncateAddress = utilTruncateAddress;
export const parseUnits = viemParseUnits;
export const formatUnits = viemFormatUnits;
export const isValidAddress = viemIsAddress;
export const getCoinbaseRates = async (): Promise<Record<string, string>> => getCoinbasePrices();
export const getSupportedChains = (env?: Network): SupportedChainsAndTokensResult =>
  fetchSupportedChains(env);
export const isSupportedToken = (token: string): boolean => {
  const supportedTokens = ['ETH', 'USDC', 'USDT'];
  return supportedTokens.includes(token.toUpperCase());
};

export class NexusUtils {
  constructor(private readonly chainList: ChainListType) {}
  formatTokenBalance = formatTokenBalance;
  formatTokenBalanceParts = formatTokenBalanceParts;
  /**
   * Parse a value from the smallest unit to the base unit
   * @param value - The value to parse
   * @param decimals - The number of decimals to parse
   * @returns The parsed value
   */
  parseUnits = parseUnits;
  /**
   * Format a value from the base unit to the smallest unit
   * @param value - The value to format
   * @param decimals - The number of decimals to format
   * @returns The formatted value
   */
  formatUnits = formatUnits;
  /**
   * Check if the address is valid
   * @param address - The address to check
   * @returns boolean
   */
  isValidAddress = isValidAddress;
  /**
   * Truncate an address
   * @param address - The address to truncate
   * @param startLength - The number of characters to keep from the start
   * @param endLength - The number of characters to keep from the end
   * @returns The truncated address
   * Examples:
   * - 0x1234567890123456789012345678901234567890 -> "0x123456...7890"
   */
  truncateAddress = truncateAddress;

  /**
   * Get the coinbase rates for the supported tokens
   * @returns Record<string, string>
   */
  getCoinbaseRates = getCoinbaseRates;

  /**
   * Get the supported chains and tokens for the network
   * @param env - The network to get the supported chains and tokens for
   * @returns SupportedChainsAndTokensResult
   */
  getSupportedChains(env?: Network): SupportedChainsAndTokensResult {
    return getSupportedChains(env);
  }

  /**
   * Get the supported chains and tokens for the network
   * @returns SupportedChainsResult
   */
  getSwapSupportedChainsAndTokens(): SupportedChainsResult {
    return getSwapSupportedChains(this.chainList);
  }

  /**
   * Check if the chain is supported
   * @param chainId - The chain ID to check
   * @returns boolean
   */

  isSupportedChain(chainId: (typeof SUPPORTED_CHAINS)[keyof typeof SUPPORTED_CHAINS]): boolean {
    return !!this.chainList.getChainByID(chainId);
  }

  /**
   * Check if the token is supported
   * @param token - The token to check
   * @returns boolean
   */
  isSupportedToken(token: string): boolean {
    return isSupportedToken(token);
  }
}
