import { useConnection, useDisconnect, useEnsName } from "wagmi";
import { truncateAddress } from "./address";
import { useWalletModal } from "./WalletProvider";

export type UseWalletResult = {
  address: `0x${string}` | undefined;
  ensName: string | null;
  truncatedAddress: string;
  isConnected: boolean;
  open: () => void;
  disconnect: () => void;
};

export function useWallet(): UseWalletResult {
  const { address, isConnected } = useConnection();
  const { data: ensName } = useEnsName({ address });
  const { mutate: disconnect } = useDisconnect();
  const { open } = useWalletModal();

  return {
    address,
    ensName: ensName ?? null,
    truncatedAddress: truncateAddress(address),
    isConnected,
    open,
    disconnect,
  };
}
