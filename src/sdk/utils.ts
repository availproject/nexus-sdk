import type { ChainAbstractionAdapter } from '../adapters/chain-abstraction-adapter';
import {
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
} from '../utils';
import type { SUPPORTED_TOKENS, ChainMetadata, TokenBalance } from '../types';
import { SUPPORTED_CHAINS } from '../constants';

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

  // Methods that need adapter access
  getSupportedChains(): Array<{ id: number; name: string; logo: string }> {
    return this.adapter.getSupportedChains();
  }

  getSupportedChainsWithMetadata(): ChainMetadata[] {
    return this.adapter.getSupportedChainsWithMetadata();
  }

  isSupportedChain(chainId: (typeof SUPPORTED_CHAINS)[keyof typeof SUPPORTED_CHAINS]): boolean {
    return this.adapter.isSupportedChain(chainId);
  }

  isSupportedToken(token: string): boolean {
    return this.adapter.isSupportedToken(token);
  }

  async getFormattedTokenBalance(
    symbol: SUPPORTED_TOKENS,
    chainId?: number,
  ): Promise<TokenBalance | undefined> {
    this.ensureInitialized();
    return this.adapter.getFormattedTokenBalance(symbol, chainId);
  }
}
