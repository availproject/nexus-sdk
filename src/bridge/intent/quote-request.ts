import type { BridgeProvider, BridgeProviderRequest } from '@avail-project/nexus-types';
import { type Hex, toHex } from 'viem';
import type { ChainListType, TokenInfo } from '../../domain';
import { Errors } from '../../domain/errors';
import { isNativeAddress } from '../../services/addresses';
import type { MiddlewareBridgeProviderClient, QuoteRequest } from '../../transport';

export const buildQuoteRequest = (
  chainList: ChainListType,
  dstToken: TokenInfo,
  dstChainId: number,
  sourceChainIds: number[]
): QuoteRequest => {
  const quoteSources: { chain_id: string; contract_address: string }[] = [];

  for (const sourceChainId of new Set(sourceChainIds)) {
    if (sourceChainId === dstChainId) continue;
    let token: TokenInfo | undefined;
    if (dstToken.currencyId != null) {
      try {
        token = chainList.getTokenByCurrencyId(sourceChainId, dstToken.currencyId);
      } catch {
        // currencyId miss — fall through to symbol lookup
      }
    }
    if (!token) {
      try {
        token = chainList.getTokenInfoBySymbol(sourceChainId, dstToken.symbol);
      } catch {
        continue;
      }
    }
    if (isNativeAddress(token.contractAddress)) continue;
    quoteSources.push({
      chain_id: toHex(sourceChainId),
      contract_address: token.contractAddress,
    });
  }

  return {
    sources: quoteSources,
    destination: {
      chain_id: toHex(dstChainId),
      contract_address: dstToken.contractAddress,
    },
  };
};

export const buildBridgeProviderRequest = (
  dstToken: TokenInfo,
  dstChainId: number,
  tokenAmount: bigint
): BridgeProviderRequest => ({
  destination: {
    chain_id: toHex(dstChainId),
    contract_address: dstToken.contractAddress,
    amount: tokenAmount.toString(),
  },
});

export const resolveBridgeProvider = async (
  middlewareClient: MiddlewareBridgeProviderClient,
  request: BridgeProviderRequest,
  forceMayan: boolean
): Promise<BridgeProvider> => {
  if (forceMayan) return 'mayan';
  const response = await middlewareClient.getBridgeProvider(request);
  return response.provider;
};

export const assertMayanSupportedDestination = (
  chainList: ChainListType,
  dstChainId: number,
  dstTokenAddress: Hex
): void => {
  const chain = chainList.getChainByID(dstChainId);
  if (!chain.mayanEnabled) {
    throw Errors.invalidInput(`Destination chain ${dstChainId} is disabled for Mayan`);
  }
  const token = chainList.getTokenByAddress(dstChainId, dstTokenAddress);
  if (!token.mayanEnabled) {
    throw Errors.invalidInput(
      `Destination token ${dstTokenAddress} is disabled for Mayan on chain ${dstChainId}`
    );
  }
};
