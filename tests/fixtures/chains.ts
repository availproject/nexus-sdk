import type { IntentChain } from '../../src/intent/types';
import { ZERO_ADDRESS } from '../../src/domain';

export const testChains: IntentChain[] = [1, 11155111].map((id) => ({
  id,
  name: id === 1 ? 'Ethereum' : 'Sepolia',
  rpcUrl: `https://rpc-${id}.example`,
  explorerUrl: `https://explorer-${id}.example`,
  logo: 'https://example.com/chain.png',
  vaultAddress: '0x0000000000000000000000000000000000000001',
  multicallAddress: '0x00000000000000000000000000000000000000aa',
  eip7702Enabled: true,
  swapSupported: true,
  sponsored: true,
  nativeCurrency: {
    name: 'Ether', symbol: 'ETH', decimals: 18, logo: 'https://example.com/eth.png',
  },
  providers: ['nexus-v2', 'mayan'],
  asSource: ['nexus-v2', 'mayan'],
  asDestination: ['nexus-v2', 'mayan'],
  tokens: [
    {
      chainId: id, address: ZERO_ADDRESS, symbol: 'ETH', name: 'Ether', decimals: 18,
      isNative: true, providers: [{ id: 'nexus-v2', currencyId: 3 }],
    },
    {
      chainId: id, address: '0x0000000000000000000000000000000000000002',
      symbol: 'USDC', name: 'USD Coin', decimals: 6, isNative: false,
      logo: 'https://example.com/usdc.png',
      providers: [{ id: 'nexus-v2', currencyId: 1 }, { id: 'mayan' }],
      permit: { variant: 'eip2612', version: '2' },
    },
  ],
  capabilities: { intent: true, execute: true },
}));
