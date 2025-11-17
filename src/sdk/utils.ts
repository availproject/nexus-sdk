import {
  type SUPPORTED_CHAINS,
  truncateAddress as utilTruncateAddress,
  SupportedChainsResult,
  Network,
  ChainListType,
  formatTokenBalance,
  formatTokenBalanceParts,
} from '../commons';
import { getCoinbasePrices, getSupportedChains } from './ca-base/utils';
import { getSwapSupportedChains } from './ca-base/swap/utils';
import { formatUnits, isAddress, parseUnits } from 'viem';

export class NexusUtils {
  constructor(private readonly chainList: ChainListType) {}
  formatTokenBalance = formatTokenBalance;
  formatTokenBalanceParts = formatTokenBalanceParts;
  parseUnits = parseUnits;
  formatUnits = formatUnits;
  isValidAddress = isAddress;
  truncateAddress = utilTruncateAddress;

  getCoinbaseRates = async (): Promise<Record<string, string>> => {
    return getCoinbasePrices();
  };

  getSupportedChains(env?: Network) {
    return getSupportedChains(env);
  }

  getSwapSupportedChainsAndTokens(): SupportedChainsResult {
    return getSwapSupportedChains(this.chainList);
  }

  /* Same for isSupportedChain / isSupportedToken */

  isSupportedChain(chainId: (typeof SUPPORTED_CHAINS)[keyof typeof SUPPORTED_CHAINS]): boolean {
    return !!this.chainList.getChainByID(chainId);
  }

  // ???
  isSupportedToken(token: string): boolean {
    const supportedTokens = ['ETH', 'USDC', 'USDT'];
    return supportedTokens.includes(token.toUpperCase());
  }
}
