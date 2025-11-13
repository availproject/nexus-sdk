import { mulDecimals } from '../utils';
import { ChainListType, BridgeAndExecuteParams, Tx, TransferParams } from '../../../commons';
import { encodeFunctionData } from 'viem';
import { ERC20ABI } from '@avail-project/ca-common';
import { Errors } from '../errors';

const createBridgeAndTransferParams = (
  input: TransferParams,
  chainList: ChainListType,
): BridgeAndExecuteParams => {
  const { token } = chainList.getChainAndTokenFromSymbol(input.toChainId, input.token);
  if (!token) {
    throw Errors.tokenNotFound(input.token, input.toChainId);
  }

  const tokenAmountInBigint = mulDecimals(input.amount, token.decimals);

  const tx: Tx = token.isNative
    ? {
        to: input.recipient,
        value: tokenAmountInBigint,
        data: '0x',
      }
    : {
        to: token.contractAddress,
        value: 0n,
        data: encodeFunctionData({
          abi: ERC20ABI,
          functionName: 'transfer',
          args: [input.recipient, tokenAmountInBigint],
        }),
      };

  return {
    toChainId: input.toChainId,
    amount: tokenAmountInBigint,
    token: input.token,
    execute: tx,
  };
};

export { createBridgeAndTransferParams };
