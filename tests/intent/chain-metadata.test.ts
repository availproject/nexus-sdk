import { describe, expect, it } from 'vitest';
import { BackendError } from '../../src/domain/errors';
import { normalizeIntentChains } from '../../src/intent/normalize';

const wireChain = (overrides: Record<string, unknown> = {}) => ({
  chainId: 'EVM_999', name: 'HyperEVM',
  rpcUrl: 'https://rpc.hyperliquid.xyz/evm',
  vaultAddress: '0x0000000000000000000000000000000000000001',
  multicallAddress: '0x00000000000000000000000000000000000000aa',
  nativeCurrency: { name: 'Hype', symbol: 'HYPE', decimals: 18 },
  sponsored: true,
  asSource: ['nexus-v2', 'relay'], asDestination: ['relay'],
  ...overrides,
});

describe('intent chain execution metadata', () => {
  it.each([true, false, undefined])('retains execution flags set to %s', (value) => {
    const [chain] = normalizeIntentChains([wireChain({ eip7702Enabled: value, swapSupported: value })]);
    expect(chain).toMatchObject({
      vaultAddress: '0x0000000000000000000000000000000000000001',
      multicallAddress: '0x00000000000000000000000000000000000000aa',
      sponsored: true, eip7702Enabled: value, swapSupported: value,
      capabilities: { intent: true, execute: true },
    });
  });

  it('keeps chains without runtime metadata available for intents', () => {
    const [chain] = normalizeIntentChains([wireChain({ rpcUrl: undefined, multicallAddress: undefined })]);
    expect(chain.capabilities).toEqual({ intent: true, execute: false });
  });

  it.each(['vaultAddress', 'multicallAddress', 'rpcUrl'])('rejects invalid %s at the transport boundary', (field) => {
    expect(() => normalizeIntentChains([wireChain({ [field]: 'invalid' })])).toThrow(BackendError);
  });
});
