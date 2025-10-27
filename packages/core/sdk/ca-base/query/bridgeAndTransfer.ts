import { mulDecimals } from '../utils';
import { TransferQueryInput, ChainListType, BridgeAndExecuteParams } from '@nexus/commons';
import { ERC20TransferABI } from '../abi/erc20';

const createBridgeAndTransferParams = (
  input: TransferQueryInput,
  chainList: ChainListType,
): BridgeAndExecuteParams => {
  const { token } = chainList.getChainAndTokenFromSymbol(input.chainId, input.token);
  if (!token) {
    throw new Error('Token not found on this chain');
  }

  const tokenAmountInBigint = mulDecimals(input.amount, token.decimals);

  // FIXME: Need to check if native token then omit a bunch of things
  return {
    toChainId: input.chainId,
    amount: tokenAmountInBigint,
    token: input.token,
    execute: {
      buildFunctionParams: () => {
        return { functionParams: [input.to, tokenAmountInBigint], value: '0' };
      },
      contractAbi: [ERC20TransferABI],
      functionName: 'transfer',
      contractAddress: token.contractAddress,
      value: '0',
    },
  };
};

export { createBridgeAndTransferParams };
