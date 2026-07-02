import type { Hex, PublicClient } from 'viem';
import ERC20ABI from '../abi/erc20';
import type { ChainListType } from '../domain';
import { isNativeAddress } from './addresses';
import { equalFold } from './strings';

export type TokenMetadata = { contractAddress: Hex; decimals: number; symbol: string };

export const fetchErc20TokenMetadata = async (
  contractAddress: Hex,
  publicClient: PublicClient
): Promise<TokenMetadata> => {
  const [decimals, symbol] = await Promise.all([
    publicClient.readContract({
      abi: ERC20ABI,
      address: contractAddress,
      functionName: 'decimals',
    }),
    publicClient.readContract({
      abi: ERC20ABI,
      address: contractAddress,
      functionName: 'symbol',
    }),
  ]);

  return { contractAddress, decimals, symbol };
};

// Resolve a token's symbol/decimals cheaply: the deployment list first, then the user's balances
// (which already carry metadata), and only if it's in neither do we read on-chain. Keeps known/held
// tokens RPC-free while still supporting arbitrary aggregator-supported destination tokens.
export const resolveTokenInfo = async (params: {
  chainList: ChainListType;
  balances: ReadonlyArray<{ chainID: number; tokenAddress: Hex; symbol: string; decimals: number }>;
  publicClient: PublicClient;
  chainId: number;
  address: Hex;
}): Promise<TokenMetadata> => {
  const { chainList, balances, publicClient, chainId, address } = params;

  if (isNativeAddress(address)) {
    const native = chainList.getNativeToken(chainId);
    return { contractAddress: address, decimals: native.decimals, symbol: native.symbol };
  }

  const fromList = (() => {
    try {
      return chainList.getTokenByAddress(chainId, address);
    } catch {
      return null;
    }
  })();
  if (fromList) {
    return { contractAddress: address, decimals: fromList.decimals, symbol: fromList.symbol };
  }

  const held = balances.find((b) => b.chainID === chainId && equalFold(b.tokenAddress, address));
  if (held) {
    return { contractAddress: address, decimals: held.decimals, symbol: held.symbol };
  }

  return fetchErc20TokenMetadata(address, publicClient);
};
