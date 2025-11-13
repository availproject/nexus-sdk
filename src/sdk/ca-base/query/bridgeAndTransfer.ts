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

  const tx: Tx = token.isNative
    ? {
        to: input.recipient,
        value: input.amount,
        data: '0x',
      }
    : {
        to: token.contractAddress,
        value: 0n,
        data: encodeFunctionData({
          abi: ERC20ABI,
          functionName: 'transfer',
          args: [input.recipient, input.amount],
        }),
      };

  return {
    toChainId: input.toChainId,
    amount: input.amount,
    token: input.token,
    execute: tx,
  };
};

export { createBridgeAndTransferParams };
