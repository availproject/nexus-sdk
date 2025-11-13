import { Errors } from '../errors';
import { BridgeParams, ChainListType } from '../../../commons';

const createBridgeParams = (input: BridgeParams, chainList: ChainListType) => {
  const { chain: dstChain, token: dstToken } = chainList.getChainAndTokenFromSymbol(
    input.toChainId,
    input.token,
  );
  if (!dstToken) {
    throw Errors.tokenNotFound(input.token, input.toChainId);
  }

  const params = {
    tokenAmount: input.amount,
    nativeAmount: input.gas ?? 0n,
    dstToken,
    dstChain,
    recipientAddress: input.recipient,
    sourceChains: input.sourceChains ?? [],
  };

  return params;
};

export { createBridgeParams };
