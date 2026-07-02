import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hex } from 'viem';
import type { EthereumProvider } from '../../src/domain';
import type { MiddlewareClient } from '../../src/transport';
import { makeMiddlewareClient as makeBaseMiddlewareClient } from '../helpers/middleware-client';

const hoisted = vi.hoisted(() => ({
  sweepEphemeralRefundsToEoa: vi.fn<(...args: unknown[]) => Promise<void>>(),
  signEphemeralKeyMessage: vi.fn(),
  deriveEphemeralKeyFromSignature: vi.fn(),
  verifyEphemeralSignature: vi.fn(),
  createChainList: vi.fn(),
  storageGetItem: vi.fn(),
  storageRemoveItem: vi.fn(),
  storageSetItem: vi.fn(),
}));

vi.mock('../../src/services/init-refund-sweep', () => ({
  sweepEphemeralRefundsToEoa: hoisted.sweepEphemeralRefundsToEoa,
}));

vi.mock('../../src/swap/wallet/derived-key', () => ({
  signEphemeralKeyMessage: hoisted.signEphemeralKeyMessage,
  deriveEphemeralKeyFromSignature: hoisted.deriveEphemeralKeyFromSignature,
  verifyEphemeralSignature: hoisted.verifyEphemeralSignature,
  getEphemeralSignatureStorageKey: (address: Hex, domain: string) =>
    `nexus-sdk-v2:ephemeral-signature:${address.toLowerCase()}:${domain}`,
}));

vi.mock('../../src/services/platform', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/platform')>(
    '../../src/services/platform'
  );
  return {
    ...actual,
    storageGetItem: hoisted.storageGetItem,
    storageRemoveItem: hoisted.storageRemoveItem,
    storageSetItem: hoisted.storageSetItem,
  };
});

vi.mock('../../src/services/chain-list', () => ({
  createChainList: hoisted.createChainList,
}));

import { createNexusClient } from '../../src/core/sdk';

const ADDRESS = '0x0000000000000000000000000000000000000aaa' as Hex;
const DERIVED_ADDRESS = '0x0000000000000000000000000000000000000bbb' as Hex;
const STORED_SIGNATURE = '0x' + '12'.repeat(65);
const FRESH_SIGNATURE = '0x' + 'ab'.repeat(65);

const makeMiddlewareClient = (): MiddlewareClient =>
  makeBaseMiddlewareClient({
    getDeployment: vi.fn().mockResolvedValue({ network: 'testnet' }),
    configureTiming: vi.fn(),
  });

const makeProvider = (): EthereumProvider =>
  ({
    request: vi.fn().mockImplementation(async ({ method }: { method: string }) => {
      switch (method) {
        case 'eth_accounts':
          return [ADDRESS];
        case 'eth_chainId':
          return '0xa4b1';
        default:
          throw new Error(`Unhandled provider method: ${method}`);
      }
    }),
  }) as unknown as EthereumProvider;

describe('createNexusClient init refund sweep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.sweepEphemeralRefundsToEoa.mockResolvedValue(undefined);
    hoisted.signEphemeralKeyMessage.mockResolvedValue(FRESH_SIGNATURE);
    hoisted.deriveEphemeralKeyFromSignature.mockReturnValue({ address: DERIVED_ADDRESS });
    hoisted.verifyEphemeralSignature.mockResolvedValue(true);
    hoisted.storageGetItem.mockReturnValue(null);
    hoisted.storageRemoveItem.mockReturnValue(undefined);
    hoisted.storageSetItem.mockReturnValue(undefined);
    hoisted.createChainList.mockReturnValue({
      getChainByID: vi.fn().mockReturnValue({ id: 42161 }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sweeps right after setEVMProvider when storage holds a valid ephemeral signature (no waiting 5 minutes)', async () => {
    hoisted.storageGetItem.mockReturnValue(STORED_SIGNATURE);

    const client = createNexusClient({
      network: 'testnet',
      internal: { middlewareClient: makeMiddlewareClient() },
    });

    await client.initialize();
    await client.setEVMProvider(makeProvider());

    // Let the background storage-load microtasks and the immediate sweep tick settle.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(hoisted.sweepEphemeralRefundsToEoa).toHaveBeenCalledTimes(1);
    const call = hoisted.sweepEphemeralRefundsToEoa.mock.calls[0]?.[0] as {
      ctx: { eoaAddress: Hex; ephemeralWallet: { address: Hex } };
    };
    expect(call.ctx.eoaAddress).toBe(ADDRESS);
    expect(call.ctx.ephemeralWallet.address).toBe(DERIVED_ADDRESS);
  });

  it('derives a fresh signature and sweeps when storage has no signature', async () => {
    hoisted.storageGetItem.mockReturnValue(null);

    const client = createNexusClient({
      network: 'testnet',
      internal: { middlewareClient: makeMiddlewareClient() },
    });

    await client.initialize();
    await client.setEVMProvider(makeProvider());

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // setEVMProvider now derives eagerly: no stored signature → one fresh prompt →
    // derived key in memory → the one-shot sweep runs with it.
    expect(hoisted.signEphemeralKeyMessage).toHaveBeenCalledTimes(1);
    expect(hoisted.sweepEphemeralRefundsToEoa).toHaveBeenCalledTimes(1);
    const call = hoisted.sweepEphemeralRefundsToEoa.mock.calls[0]?.[0] as {
      ctx: { ephemeralWallet: { address: Hex } };
    };
    expect(call.ctx.ephemeralWallet.address).toBe(DERIVED_ADDRESS);
  });

  it('never prompts the wallet for a fresh signature during the background preload', async () => {
    hoisted.storageGetItem.mockReturnValue(STORED_SIGNATURE);

    const client = createNexusClient({
      network: 'testnet',
      internal: { middlewareClient: makeMiddlewareClient() },
    });

    await client.initialize();
    await client.setEVMProvider(makeProvider());

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(hoisted.signEphemeralKeyMessage).not.toHaveBeenCalled();
  });
});
