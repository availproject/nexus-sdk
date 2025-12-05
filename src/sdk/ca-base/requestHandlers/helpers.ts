import type { BridgeParams, ChainListType } from '../../../commons';
import { Errors } from '../errors';

const createBridgeParams = (input: BridgeParams, chainList: ChainListType) => {
  if (input.amount === 0n && (!input.gas || input.gas === 0n)) {
    throw Errors.invalidInput(`input.amount & input.gas can't be 0`);
  }

  const { chain: dstChain, token: dstToken } = chainList.getChainAndTokenFromSymbol(
    input.toChainId,
    input.token
  );
  if (!dstToken) {
    throw Errors.tokenNotFound(input.token, input.toChainId);
  }

  const params = {
    tokenAmount: input.amount,
    nativeAmount: input.gas ?? 0n,
    dstToken,
    dstChain,
    recipient: input.recipient,
    sourceChains: input.sourceChains ?? [],
  };

  return params;
};

export { createBridgeParams };
