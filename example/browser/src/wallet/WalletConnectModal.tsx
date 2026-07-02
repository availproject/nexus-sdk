import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  useConnect,
  useConnection,
  useConnectionEffect,
  useConnectors,
  useDisconnect,
  useEnsAvatar,
  useEnsName,
  type Connector,
} from "wagmi";
import { truncateAddress } from "./address";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function WalletConnectModal({ open, onOpenChange }: Props) {
  const { address, isConnected } = useConnection();
  const { data: ensName } = useEnsName({ address });
  const { data: ensAvatar } = useEnsAvatar({ name: ensName ?? undefined });
  const connectors = useConnectors();
  const { mutate: connect, status, error, variables, reset } = useConnect();
  const { mutate: disconnect } = useDisconnect();

  // Close the modal whenever a fresh connection is established — this only
  // fires on the disconnected → connected transition (wagmi-managed), so it
  // doesn't fight the account view the user opens by clicking their address.
  useConnectionEffect({
    onConnect() {
      if (open) onOpenChange(false);
    },
  });

  // Clear any prior error when the modal is reopened.
  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  const sortedConnectors = useMemo(() => dedupeConnectors(connectors), [connectors]);
  const pendingConnectorId =
    status === "pending" ? (variables as { connector?: Connector } | undefined)?.connector?.id : undefined;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className="modal-panel wallet-modal-panel modal-content-centered">
          <div className="modal-header">
            <Dialog.Title className="modal-title">
              {isConnected ? "Connected" : "Connect a wallet"}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="ghost-button" type="button" aria-label="Close">
                <CloseIcon />
              </button>
            </Dialog.Close>
          </div>

          <div className="modal-body">
            {isConnected ? (
              <ConnectedView
                address={address ?? null}
                ensName={ensName ?? null}
                ensAvatar={ensAvatar ?? null}
                onDisconnect={() => {
                  disconnect();
                  onOpenChange(false);
                }}
              />
            ) : (
              <ConnectorList
                connectors={sortedConnectors}
                pendingConnectorId={pendingConnectorId}
                onSelect={(connector) => connect({ connector })}
                error={error}
              />
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ConnectorList({
  connectors,
  pendingConnectorId,
  onSelect,
  error,
}: {
  connectors: Connector[];
  pendingConnectorId: string | undefined;
  onSelect: (connector: Connector) => void;
  error: Error | null;
}) {
  if (connectors.length === 0) {
    return (
      <div className="wallet-empty">
        <p>No wallets detected. Install a browser wallet like MetaMask to continue.</p>
      </div>
    );
  }

  return (
    <>
      <ul className="wallet-list">
        {connectors.map((connector) => {
          const isPending = pendingConnectorId === connector.id;
          return (
            <li key={connector.uid}>
              <button
                type="button"
                className="wallet-option"
                onClick={() => onSelect(connector)}
                disabled={Boolean(pendingConnectorId) && !isPending}
              >
                <ConnectorIcon connector={connector} />
                <span className="wallet-option-name">{connector.name}</span>
                {isPending ? <span className="wallet-option-status">Connecting…</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
      {error ? <p className="wallet-error">{prettyError(error)}</p> : null}
    </>
  );
}

function ConnectedView({
  address,
  ensName,
  ensAvatar,
  onDisconnect,
}: {
  address: string | null;
  ensName: string | null;
  ensAvatar: string | null;
  onDisconnect: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copyAddress() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard write can fail without HTTPS / user gesture; ignore.
    }
  }

  return (
    <div className="wallet-connected-view">
      <div className="wallet-identity">
        <span className="wallet-identity-icon" aria-hidden="true">
          {ensAvatar ? (
            <img src={ensAvatar} alt="" className="wallet-identity-avatar" />
          ) : (
            <WalletIcon />
          )}
        </span>
        <div className="wallet-identity-meta">
          {ensName ? <span className="wallet-identity-ens">{ensName}</span> : null}
          <span className="wallet-identity-address">{truncateAddress(address)}</span>
        </div>
        <button
          type="button"
          className="wallet-copy"
          onClick={copyAddress}
          disabled={!address}
          aria-label={copied ? "Address copied" : "Copy address"}
          title={copied ? "Copied" : "Copy address"}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </button>
      </div>
      <button
        type="button"
        className="intent-button intent-button-stop"
        onClick={onDisconnect}
      >
        Disconnect
      </button>
    </div>
  );
}

function ConnectorIcon({ connector }: { connector: Connector }) {
  const icon = connector.icon;
  if (icon) {
    return <img className="wallet-option-icon" src={icon} alt="" width={28} height={28} />;
  }
  return (
    <span className="wallet-option-icon wallet-option-icon-fallback" aria-hidden="true">
      {connector.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function WalletIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-1" />
      <path d="M16 12h5v4h-5a2 2 0 1 1 0-4z" />
    </svg>
  );
}

// Prefer EIP-6963 discovered wallets, drop the generic "injected" fallback when
// any same-rdns wallet has been announced. Otherwise keep insertion order.
function dedupeConnectors(connectors: readonly Connector[]): Connector[] {
  const announcedRdns = new Set<string>();
  for (const c of connectors) {
    const rdns = readRdns(c);
    if (rdns) announcedRdns.add(rdns);
  }

  const seenIds = new Set<string>();
  const out: Connector[] = [];
  for (const c of connectors) {
    if (seenIds.has(c.id)) continue;
    // If this is the generic injected and a more specific injected wallet was
    // announced, hide the generic one — otherwise users see "MetaMask" twice.
    if (c.id === "injected" && announcedRdns.size > 0) continue;
    seenIds.add(c.id);
    out.push(c);
  }
  return out;
}

function readRdns(connector: Connector): string | undefined {
  const rdns = (connector as unknown as { rdns?: string }).rdns;
  return typeof rdns === "string" ? rdns : undefined;
}

function prettyError(error: Error): string {
  const message = error.message ?? String(error);
  // Most wallet rejection errors are noisy; collapse to the first line.
  return message.split("\n")[0] ?? message;
}
