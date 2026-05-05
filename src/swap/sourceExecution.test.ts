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
      vscGetSafeAccountAddress: vi.fn(),
    } as Partial<VSCClient> as VSCClient;

    const result = await resolveSourceExecution({
      chain: baseChain,
      eoaAddress: '0x1111111111111111111111111111111111111111',
      ephemeralAddress: '0x2222222222222222222222222222222222222222',
      vscClient,
    });

    expect(vscClient.vscGetSafeAccountAddress).not.toHaveBeenCalled();
    expect(result).toEqual({
      address: '0x2222222222222222222222222222222222222222',
      entryPoint: null,
      mode: '7702',
    });
  });

  it('uses the deterministic Safe account for non-Pectra swap chains', async () => {
    const vscClient = {
      vscGetSafeAccountAddress: vi.fn().mockResolvedValue({
        address: '0x3333333333333333333333333333333333333333',
        factoryAddress: '0x4444444444444444444444444444444444444444',
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

    expect(vscClient.vscGetSafeAccountAddress).toHaveBeenCalledWith(
      SUPPORTED_CHAINS.HYPEREVM,
      '0x2222222222222222222222222222222222222222'
    );
    expect(result).toEqual({
      address: '0x3333333333333333333333333333333333333333',
      entryPoint: null,
      factoryAddress: '0x4444444444444444444444444444444444444444',
      mode: 'safe_account',
    });
  });
});
