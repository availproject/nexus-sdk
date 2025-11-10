import {
  type SUPPORTED_CHAINS,
  formatBalance as utilFormatBalance,
  parseUnits as utilParseUnits,
  formatUnits as utilFormatUnits,
  isValidAddress as utilIsValidAddress,
  truncateAddress as utilTruncateAddress,
  chainIdToHex as utilChainIdToHex,
  hexToChainId as utilHexToChainId,
  getMainnetTokenMetadata as utilGetMainnetTokenMetadata,
  getTestnetTokenMetadata as utilGetTestnetTokenMetadata,
  getTokenMetadata as utilGetTokenMetadata,
  getChainMetadata as utilGetChainMetadata,
  formatTokenAmount as utilFormatTokenAmount,
  formatTestnetTokenAmount as utilFormatTestnetTokenAmount,
  SupportedChainsResult,
  Network,
  ChainListType,
} from '@nexus/commons';
import { getCoinbasePrices, getSupportedChains } from './ca-base/utils';
import { getSwapSupportedChains } from './ca-base/swap/utils';

export class NexusUtils {
  constructor(private readonly chainList: ChainListType) {}

  // Pure utility functions (no adapter dependency)
  formatBalance = utilFormatBalance;
  parseUnits = utilParseUnits;
  formatUnits = utilFormatUnits;
  isValidAddress = utilIsValidAddress;
  truncateAddress = utilTruncateAddress;
  chainIdToHex = utilChainIdToHex;
  hexToChainId = utilHexToChainId;
  getMainnetTokenMetadata = utilGetMainnetTokenMetadata;
  getTestnetTokenMetadata = utilGetTestnetTokenMetadata;
  getTokenMetadata = utilGetTokenMetadata;
  getChainMetadata = utilGetChainMetadata;
  formatTokenAmount = utilFormatTokenAmount;
  formatTestnetTokenAmount = utilFormatTestnetTokenAmount;
  getCoinbaseRates = async (): Promise<Record<string, string>> => {
    return getCoinbasePrices();
  };

  getSupportedChains(env?: Network): SupportedChainsResult {
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
