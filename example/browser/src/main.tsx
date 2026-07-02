/// <reference types="vite/client" />

// import "@fontsource-variable/space-grotesk";  // uncomment to try Space Grotesk instead
import "@fontsource-variable/geist";
import "@fontsource/geist-mono";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import type { Transport } from "viem";
import { http, WagmiProvider } from "wagmi";
import {
  arbitrum,
  arbitrumSepolia,
  avalanche,
  base,
  baseSepolia,
  bsc,
  citrea,
  hyperEvm,
  mainnet,
  megaeth,
  monad,
  optimism,
  optimismSepolia,
  polygon,
  polygonAmoy,
  scroll,
  sepolia,
} from "wagmi/chains";
import App from "./App";
import { createWalletConfig, WalletProvider } from "./wallet";

// Chains the Nexus middleware can target across mainnet + canary + testnet
// deployments. Wagmi uses this list for chain-switching and per-chain RPC
// fallback; the SDK fetches its own authoritative chain list at runtime.
const chains = [
  // mainnet + canary (real chain ids, same wallet network)
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
  // testnet
  sepolia,
  arbitrumSepolia,
  baseSepolia,
  optimismSepolia,
  polygonAmoy,
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
