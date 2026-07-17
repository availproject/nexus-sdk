import { erc20Abi, type Hex } from 'viem';
import { isNativeAddress } from '../../services/addresses';
import type { PublicClientList } from '../types';

export const readSettlementBalanceRaw = async (input: {
  chainId: number;
  tokenAddress: Hex;
  holderAddress: Hex;
  publicClientList: PublicClientList;
}): Promise<bigint> => {
  const publicClient = input.publicClientList.get(input.chainId);
  return isNativeAddress(input.tokenAddress)
    ? publicClient.getBalance({ address: input.holderAddress })
    : publicClient.readContract({
        address: input.tokenAddress,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [input.holderAddress],
      });
};
