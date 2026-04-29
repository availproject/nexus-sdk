import { describe, expect, it, vi } from 'vitest';
import type { Chain, VSCClient } from '../commons';
import { SUPPORTED_CHAINS } from '../commons';
import { resolveSourceExecution } from './route';

const baseChain = {
  blockExplorers: { default: { name: 'Explorer', url: 'https://example.com' } },
  custom: { icon: '', knownTokens: [] },
  id: SUPPORTED_CHAINS.ETHEREUM,
  name: 'Ethereum',
  ankrName: 'eth',
  nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
  pectraUpgradeSupport: true,
  rpcUrls: { default: { http: [], webSocket: [] } },
  swapSupported: true,
  universe: 1,
} as Chain;

describe('resolveSourceExecution', () => {
  it('uses the ephemeral execution account for Pectra chains without calling VSC', async () => {
    const vscClient = {
      vscGetCaliburAccountAddress: vi.fn(),
    } as Partial<VSCClient> as VSCClient;

    const result = await resolveSourceExecution({
      chain: baseChain,
      eoaAddress: '0x1111111111111111111111111111111111111111',
      ephemeralAddress: '0x2222222222222222222222222222222222222222',
      vscClient,
    });

    expect(vscClient.vscGetCaliburAccountAddress).not.toHaveBeenCalled();
    expect(result).toEqual({
      address: '0x2222222222222222222222222222222222222222',
      entryPoint: null,
      mode: '7702',
    });
  });

  it('uses the deterministic Calibur account for non-Pectra swap chains', async () => {
    const vscClient = {
      vscGetCaliburAccountAddress: vi.fn().mockResolvedValue({
        address: '0x3333333333333333333333333333333333333333',
      }),
    } as Partial<VSCClient> as VSCClient;

    const result = await resolveSourceExecution({
      chain: {
        ...baseChain,
        id: SUPPORTED_CHAINS.HYPEREVM,
        name: 'HyperEVM',
        pectraUpgradeSupport: false,
      },
      eoaAddress: '0x1111111111111111111111111111111111111111',
      ephemeralAddress: '0x2222222222222222222222222222222222222222',
      vscClient,
    });

    expect(vscClient.vscGetCaliburAccountAddress).toHaveBeenCalledWith(
      SUPPORTED_CHAINS.HYPEREVM,
      '0x1111111111111111111111111111111111111111'
    );
    expect(result).toEqual({
      address: '0x3333333333333333333333333333333333333333',
      entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
      mode: 'calibur_account',
    });
  });
});
