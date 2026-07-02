import type { Chain, Transport } from "viem";
import { createConfig } from "wagmi";
import { coinbaseWallet, injected, walletConnect } from "wagmi/connectors";

export type CreateWalletConfigParams = {
  chains: readonly [Chain, ...Chain[]];
  transports: Record<number, Transport>;
  appName: string;
  walletConnectProjectId?: string;
};

export function createWalletConfig({
  chains,
  transports,
  appName,
  walletConnectProjectId,
}: CreateWalletConfigParams) {
  // Inline the full array so TS infers a union of all three connector types.
  // Building incrementally with .push() narrows the inferred element type to
  // the first two, then rejects the walletConnect push.
  const connectors = [
    injected({ shimDisconnect: true }),
    coinbaseWallet({ appName }),
    ...(walletConnectProjectId
      ? [
          walletConnect({
            projectId: walletConnectProjectId,
            showQrModal: true,
            metadata: {
              name: appName,
              description: appName,
              url:
                typeof window === "undefined" ? "" : window.location.origin,
              icons: [],
            },
          }),
        ]
      : []),
  ];

  return createConfig({
    chains,
    transports,
    connectors,
    ssr: false,
    multiInjectedProviderDiscovery: true,
  });
}
