import { toHex } from 'viem';
import { describe, expect, it, vi } from 'vitest';
import { type Chain, SUPPORTED_CHAINS, type VSCClient } from '../commons';
import type { FlatBalance } from './data';
import {
  hasDestinationChainSourceSwapOutput,
  requiresSafeAccount,
  resolveDestinationExecution,
  toAggregatorInputsWithRecipients,
} from './route';

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

describe('requiresSafeAccount', () => {
  it('only requires Safe for swap-supported non-Pectra chains', () => {
    expect(
      requiresSafeAccount({ ...baseChain, swapSupported: true, pectraUpgradeSupport: false })
    ).toBe(true);
    expect(
      requiresSafeAccount({ ...baseChain, swapSupported: false, pectraUpgradeSupport: false })
    ).toBe(false);
    expect(
      requiresSafeAccount({ ...baseChain, swapSupported: true, pectraUpgradeSupport: true })
    ).toBe(false);
    expect(requiresSafeAccount(undefined)).toBe(false);
  });
});

describe('resolveDestinationExecution', () => {
  it('uses the deterministic Safe account on HyperEVM when a destination swap is required', async () => {
    const vscClient = {
      vscGetSafeAccountAddress: vi.fn().mockResolvedValue({
        address: '0x3333333333333333333333333333333333333333',
        factoryAddress: '0x4444444444444444444444444444444444444444',
      }),
    } as Partial<VSCClient> as VSCClient;

    const result = await resolveDestinationExecution({
      chain: {
        ...baseChain,
        id: SUPPORTED_CHAINS.HYPEREVM,
        name: 'HyperEVM',
        pectraUpgradeSupport: false,
      },
      eoaAddress: '0x1111111111111111111111111111111111111111',
      ephemeralAddress: '0x2222222222222222222222222222222222222222',
      needsDestinationExecution: true,
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

  it('keeps the ephemeral executor on 7702 destination paths', async () => {
    const vscClient = {
      vscGetSafeAccountAddress: vi.fn(),
    } as Partial<VSCClient> as VSCClient;

    const result = await resolveDestinationExecution({
      chain: baseChain,
      eoaAddress: '0x1111111111111111111111111111111111111111',
      ephemeralAddress: '0x2222222222222222222222222222222222222222',
      needsDestinationExecution: true,
      vscClient,
    });

    expect(vscClient.vscGetSafeAccountAddress).not.toHaveBeenCalled();
    expect(result).toEqual({
      address: '0x2222222222222222222222222222222222222222',
      entryPoint: null,
      mode: '7702',
    });
  });

  it('keeps direct-to-eoa destination transfers off the smart-account path when no destination swap is needed', async () => {
    const vscClient = {
      vscGetSafeAccountAddress: vi.fn(),
    } as Partial<VSCClient> as VSCClient;

    const result = await resolveDestinationExecution({
      chain: {
        ...baseChain,
        id: SUPPORTED_CHAINS.HYPEREVM,
        name: 'HyperEVM',
        pectraUpgradeSupport: false,
      },
      eoaAddress: '0x1111111111111111111111111111111111111111',
      ephemeralAddress: '0x2222222222222222222222222222222222222222',
      needsDestinationExecution: false,
      vscClient,
    });

    expect(vscClient.vscGetSafeAccountAddress).not.toHaveBeenCalled();
    expect(result).toEqual({
      address: '0x1111111111111111111111111111111111111111',
      entryPoint: null,
      mode: 'direct_eoa',
    });
  });

  it('routes no-destination-execution transfers directly to the EOA on 7702 chains as well', async () => {
    const vscClient = {
      vscGetSafeAccountAddress: vi.fn(),
    } as Partial<VSCClient> as VSCClient;

    const result = await resolveDestinationExecution({
      chain: baseChain,
      eoaAddress: '0x1111111111111111111111111111111111111111',
      ephemeralAddress: '0x2222222222222222222222222222222222222222',
      needsDestinationExecution: false,
      vscClient,
    });

    expect(vscClient.vscGetSafeAccountAddress).not.toHaveBeenCalled();
    expect(result).toEqual({
      address: '0x1111111111111111111111111111111111111111',
      entryPoint: null,
      mode: 'direct_eoa',
    });
  });
});

describe('toAggregatorInputsWithRecipients', () => {
  it('uses the execution address for each source chain recipient', () => {
    const holdings = toAggregatorInputsWithRecipients(
      [
        {
          amount: '1',
          chainID: SUPPORTED_CHAINS.ETHEREUM,
          decimals: 6,
          logo: '',
          symbol: 'USDC',
          tokenAddress: '0x000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          universe: 1,
          value: 1,
        },
        {
          amount: '2',
          chainID: SUPPORTED_CHAINS.HYPEREVM,
          decimals: 6,
          logo: '',
          symbol: 'USDC',
          tokenAddress: '0x000000000000000000000000bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          universe: 1,
          value: 2,
        },
      ] as FlatBalance[],
      {
        [SUPPORTED_CHAINS.ETHEREUM]: {
          address: '0x2222222222222222222222222222222222222222',
          entryPoint: null,
          mode: '7702',
        },
        [SUPPORTED_CHAINS.HYPEREVM]: {
          address: '0x3333333333333333333333333333333333333333',
          entryPoint: null,
          mode: 'safe_account',
        },
      }
    );

    expect(toHex(holdings[0].recipient)).toBe(
      '0x0000000000000000000000002222222222222222222222222222222222222222'
    );
    expect(toHex(holdings[1].recipient)).toBe(
      '0x0000000000000000000000003333333333333333333333333333333333333333'
    );
  });
});

describe('hasDestinationChainSourceSwapOutput', () => {
  it('detects when same-chain source swaps output to a non-EOA execution target', () => {
    expect(
      hasDestinationChainSourceSwapOutput(
        [{ chainID: SUPPORTED_CHAINS.HYPEREVM }],
        {
          [SUPPORTED_CHAINS.HYPEREVM]: {
            address: '0x3333333333333333333333333333333333333333',
            entryPoint: null,
            mode: 'safe_account',
          },
        },
        SUPPORTED_CHAINS.HYPEREVM,
        '0x1111111111111111111111111111111111111111'
      )
    ).toBe(true);
  });

  it('does not force destination execution when output already lands on the EOA', () => {
    expect(
      hasDestinationChainSourceSwapOutput(
        [{ chainID: SUPPORTED_CHAINS.HYPEREVM }],
        {
          [SUPPORTED_CHAINS.HYPEREVM]: {
            address: '0x1111111111111111111111111111111111111111',
            entryPoint: null,
            mode: '7702',
          },
        },
        SUPPORTED_CHAINS.HYPEREVM,
        '0x1111111111111111111111111111111111111111'
      )
    ).toBe(false);
  });
});
