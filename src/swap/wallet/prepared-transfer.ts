import { encodeFunctionData, erc20Abi, type Hex, type WalletClient } from 'viem';
import type { ChainListType } from '../../domain';
import type {
  PreparedAuthorizationCall,
  PreparedEoaToEphemeralTransfer,
  PublicClientList,
} from '../types';
import type { SwapCache } from './cache';
import { buildTransferAuthorization } from './transfer-authorization';

export const buildPreparedTransfer = async (input: {
  reason: PreparedEoaToEphemeralTransfer['reason'];
  chainId: number;
  tokenAddress: Hex;
  tokenDecimals: number;
  amount: bigint;
  eagerPermit: boolean;
  targetAddress: Hex;
  chainList: ChainListType;
  eoaAddress: Hex;
  eoaWallet: WalletClient;
  publicClientList: PublicClientList;
  cache: SwapCache;
  authorization?: PreparedAuthorizationCall | null;
}): Promise<PreparedEoaToEphemeralTransfer> => {
  const chain = input.chainList.getChainByID(input.chainId);
  const authorization =
    input.authorization === undefined
      ? await buildTransferAuthorization({
          chain,
          tokenAddress: input.tokenAddress,
          tokenDecimals: input.tokenDecimals,
          amount: input.amount,
          eoaAddress: input.eoaAddress,
          eoaWallet: input.eoaWallet,
          ephemeralAddress: input.targetAddress,
          publicClientList: input.publicClientList,
          cache: input.cache,
          eagerPermit: input.eagerPermit,
        })
      : input.authorization;

  return {
    reason: input.reason,
    chainId: input.chainId,
    tokenAddress: input.tokenAddress,
    amount: input.amount,
    targetAddress: input.targetAddress,
    authorization,
    transferCall: {
      to: input.tokenAddress,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: 'transferFrom',
        args: [input.eoaAddress, input.targetAddress, input.amount],
      }),
      value: 0n,
    },
  };
};
