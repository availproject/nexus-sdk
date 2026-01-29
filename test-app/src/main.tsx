import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { sepolia, arbitrumSepolia, baseSepolia, polygonAmoy } from 'wagmi/chains';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConnectKitProvider, getDefaultConfig } from 'connectkit';
import './index.css';
import App from './App.tsx';

// Wagmi config with ConnectKit
const config = createConfig(
  getDefaultConfig({
    chains: [sepolia, arbitrumSepolia, baseSepolia, polygonAmoy],
    transports: {
      [sepolia.id]: http('https://ethereum-sepolia-rpc.publicnode.com'),
      [arbitrumSepolia.id]: http('https://sepolia-rollup.arbitrum.io/rpc'),
      [baseSepolia.id]: http('https://sepolia.base.org'),
      [polygonAmoy.id]: http('https://rpc-amoy.polygon.technology'),
    },
    walletConnectProjectId: 'nexus-sdk-test', // Replace with actual project ID if needed
    appName: 'Nexus SDK Test',
    appDescription: 'Test app for Nexus SDK V2 Middleware',
  }),
);

const queryClient = new QueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ConnectKitProvider theme="auto">
          <App />
        </ConnectKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
);
