/// <reference types="vite/client" />

// import "@fontsource-variable/space-grotesk";  // uncomment to try Space Grotesk instead
import "@fontsource-variable/geist";
import "@fontsource/geist-mono";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import type { Transport } from "viem";
import { http, WagmiProvider } from "wagmi";
import {
  arbitrum,
  avalanche,
  base,
  bsc,
  citrea,
  hyperEvm,
  mainnet,
  megaeth,
  monad,
  optimism,
  polygon,
  scroll,
} from "wagmi/chains";
import App from "./App";
import { createWalletConfig, WalletProvider } from "./wallet";

// Mainnet and canary both target mainnet chains. Wagmi uses this list for
// chain-switching and per-chain RPC fallback; the SDK fetches its authoritative
// chain list from the selected middleware deployment at runtime.
const chains = [
  mainnet,
  arbitrum,
  base,
  polygon,
  optimism,
  bsc,
  avalanche,
  scroll,
  citrea,
  monad,
  hyperEvm,
  megaeth,
] as const;

const transports = Object.fromEntries(
  chains.map((c) => [c.id, http()]),
) as Record<number, Transport>;

const config = createWalletConfig({
  chains,
  transports,
  walletConnectProjectId: import.meta.env.VITE_WC_PROJECT_ID,
  appName: "Nexus SDK v2",
});

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <WalletProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </WalletProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
);
