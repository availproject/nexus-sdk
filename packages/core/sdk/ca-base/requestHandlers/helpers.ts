import { mulDecimals } from '../utils';
import { BridgeQueryInput, ChainListType } from '@nexus/commons';

const createBridgeParams = (input: BridgeQueryInput, chainList: ChainListType) => {
  const { chain: dstChain, token: dstToken } = chainList.getChainAndTokenFromSymbol(
    input.chainId,
    input.token,
  );
  if (!dstToken) {
    throw new Error('Token not supported on this chain.');
  }

  const params = {
    tokenAmount: mulDecimals(input.amount, dstToken.decimals),
    nativeAmount: input.gas ?? 0n,
    dstToken,
    dstChain,
    recipientAddress: input.recipient,
    sourceChains: input.sourceChains ?? [],
  };

  return params;
};

export { createBridgeParams };
