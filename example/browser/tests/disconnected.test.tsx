import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { expect, it, vi } from 'vitest';
import Home from '../src/pages/Home';
import { MAINNET_TABS } from '../src/lib/tabs';
import { SourceAmountsEditor } from '../src/components/SourceAmountsEditor';
import type { NexusClient } from '@avail-project/nexus-core';

vi.mock('../src/wallet/WalletProvider', () => ({ useWalletModal: () => ({ open: vi.fn() }) }));

const client = { getSupportedChains: () => [] } as unknown as NexusClient;
const sdk = {
  network: 'mainnet' as const, tabs: MAINNET_TABS, client, ready: true, isConnected: false,
  onSwapIntent: vi.fn(), onSwapExecIntent: vi.fn(),
  swapIntent: null, swapIntentPending: false, swapIntentRefreshing: false, swapIntentApproved: false,
  approveSwapIntent: vi.fn(), denySwapIntent: vi.fn(), clearSwapIntent: vi.fn(),
  swapExecIntent: null, swapExecIntentPending: false, swapExecIntentRefreshing: false, swapExecIntentApproved: false,
  approveSwapExecIntent: vi.fn(), denySwapExecIntent: vi.fn(), clearSwapExecIntent: vi.fn(),
};

it.each(['/swap-exact-in', '/swap-exact-out', '/swap-and-execute'])(
  'only makes exact-input forms available before login: %s', (path) => {
    const markup = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={[path]}><Home {...sdk} /></MemoryRouter>
      </QueryClientProvider>,
    );
    if (path === '/swap-exact-in') {
      expect(markup).toContain('Preview Exact In Swap');
      expect(markup).toContain('Add asset');
      expect(markup).not.toContain('connect-gate-heading');
    } else {
      expect(markup).toContain('connect-gate-heading');
    }
  },
);

it('lets guests pick catalog assets and hides wallet balances and Max', () => {
  const markup = renderToStaticMarkup(<SourceAmountsEditor
    client={client} showBalances={false} onAddSource={vi.fn()}
    sources={[{
      id: '1:usdc', chainId: 1, chainName: 'Ethereum', chainLogo: '', symbol: 'USDC',
      tokenAddress: '0x0000000000000000000000000000000000000001', decimals: 6,
      balance: '0', value: '0',
    }]}
    selectedIds={['1:usdc']} onSelectedChange={vi.fn()} amounts={{ '1:usdc': '10' }} onAmountChange={vi.fn()}
  />);
  expect(markup).toContain('Add asset');
  expect(markup).toContain('value="10"');
  expect(markup).not.toContain('Max ');
  expect(markup).not.toContain('send-total');
});
