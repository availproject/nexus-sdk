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
  SwapSupportedChainsResult,
} from '@nexus/commons';
import { ChainAbstractionAdapter } from '../adapters/chain-abstraction-adapter';

export class NexusUtils {
  constructor(
    private readonly adapter: ChainAbstractionAdapter,
    private readonly isReady: () => boolean,
  ) {}

  private ensureInitialized(): void {
    if (!this.isReady()) {
      throw new Error(
        'NexusSDK must be initialized before using utils methods that require adapter access. Call sdk.initialize() first.',
      );
    }
  }

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
  getSupportedChains(): Array<{ id: number; name: string; logo: string }> {
    this.ensureInitialized();
    return this.adapter.getSupportedChains();
  }

  getSwapSupportedChainsAndTokens(): SwapSupportedChainsResult {
    this.ensureInitialized();
    return this.adapter.ca.getSwapSupportedChainsAndTokens();
  }

  /* Same for isSupportedChain / isSupportedToken */

  isSupportedChain(chainId: (typeof SUPPORTED_CHAINS)[keyof typeof SUPPORTED_CHAINS]): boolean {
    this.ensureInitialized();
    return this.adapter.isSupportedChain(chainId);
  }

  isSupportedToken(token: string): boolean {
    this.ensureInitialized();
    return this.adapter.isSupportedToken(token);
  }
}
