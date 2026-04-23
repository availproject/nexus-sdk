import type { Hex, WalletClient } from 'viem';

type AtomicCapabilities = Record<
  number,
  {
    atomic?: {
      status?: 'supported' | 'ready' | 'unsupported';
    };
  }
>;

export const getAtomicBatchSupport = async (
  walletClient: WalletClient,
  address: Hex,
  chainIds: number[]
): Promise<Map<number, boolean>> => {
  const fallback = new Map<number, boolean>(chainIds.map((chainId) => [chainId, false]));

  try {
    const capabilities = (await walletClient.getCapabilities({
      account: address,
    })) as AtomicCapabilities;

    return new Map(
      chainIds.map((chainId) => {
        const status = capabilities?.[chainId]?.atomic?.status;
        return [chainId, status === 'supported' || status === 'ready'];
      })
    );
  } catch {
    return fallback;
  }
};
