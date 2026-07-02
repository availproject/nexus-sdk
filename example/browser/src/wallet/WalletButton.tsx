import { useWallet } from "./useWallet";

export function WalletButton() {
  const { isConnected, truncatedAddress, ensName, open } = useWallet();

  return (
    <button
      type="button"
      onClick={open}
      className={`wallet-btn${isConnected ? " wallet-connected" : ""}`}
    >
      {isConnected && <span className="wallet-dot" />}
      {isConnected ? (
        <span className="wallet-address">{ensName ?? truncatedAddress}</span>
      ) : (
        "Connect Wallet"
      )}
    </button>
  );
}
