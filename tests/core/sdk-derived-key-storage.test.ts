import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hex } from 'viem';
import type { EthereumProvider } from '../../src/domain';
import type { MiddlewareClient } from '../../src/transport';
import type { SwapMaxResult, SwapResult } from '../../src/swap/types';
import { makeMiddlewareClient as makeBaseMiddlewareClient } from '../helpers/middleware-client';

const hoisted = vi.hoisted(() => ({
  swap: vi.fn<(...args: unknown[]) => Promise<SwapResult>>(),
  calculateMaxForSwap: vi.fn<(...args: unknown[]) => Promise<SwapMaxResult>>(),
  signEphemeralKeyMessage: vi.fn(),
  deriveEphemeralKeyFromSignature: vi.fn(),
  verifyEphemeralSignature: vi.fn(),
  createChainList: vi.fn(),
  storageGetItem: vi.fn(),
  storageRemoveItem: vi.fn(),
  storageSetItem: vi.fn(),
}));

vi.mock('../../src/flows/swap', () => ({
  swap: hoisted.swap,
}));

vi.mock('../../src/swap/max', () => ({
  calculateMaxForSwap: hoisted.calculateMaxForSwap,
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

const makeMiddlewareClient = (): MiddlewareClient =>
  makeBaseMiddlewareClient({
    getDeployment: vi.fn().mockResolvedValue({ network: 'testnet' }),
    getRFFStatus: vi.fn().mockResolvedValue({ status: 'created' }),
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

describe('createNexusClient derived key storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.swap.mockResolvedValue({
      sourceSwaps: [],
      intentExplorerUrl: '',
      destinationSwap: null,
      intent: {
        destination: {
          amount: '0',
          value: '0',
          chain: { id: 1, logo: '', name: 'ethereum' },
          token: {
            contractAddress: '0x0000000000000000000000000000000000000000',
            decimals: 18,
            symbol: 'ETH',
          },
          gas: {
            amount: '0',
            token: {
              contractAddress: '0x0000000000000000000000000000000000000000',
              decimals: 18,
              symbol: 'ETH',
            },
          },
        },
        feesAndBuffer: { buffer: '0', bridge: null },
        bridgeProvider: null,
        sources: [],
      },
    });
    hoisted.calculateMaxForSwap.mockResolvedValue({
      toChainId: 42161,
      toTokenAddress: '0x0000000000000000000000000000000000000ccc' as Hex,
      maxAmount: '1',
      maxAmountRaw: 1n,
      symbol: 'USDC',
      decimals: 6,
      sources: [],
    });
    hoisted.signEphemeralKeyMessage.mockResolvedValue(STORED_SIGNATURE);
    hoisted.deriveEphemeralKeyFromSignature.mockReturnValue({
      address: DERIVED_ADDRESS,
    });
    hoisted.verifyEphemeralSignature.mockResolvedValue(true);
    hoisted.storageGetItem.mockReturnValue(null);
    hoisted.storageRemoveItem.mockReturnValue(undefined);
    hoisted.storageSetItem.mockReturnValue(undefined);
    hoisted.createChainList.mockReturnValue({
      getChainByID: vi.fn().mockReturnValue({ id: 42161 }),
    });
  });

  it('persists the signature on first swap and reuses it on later clients without prompting', async () => {
    const middlewareClient = makeMiddlewareClient();
    const provider = makeProvider();

    const clientA = createNexusClient({
      network: 'testnet',
      internal: { middlewareClient },
    });

    await clientA.initialize();
    await clientA.setEVMProvider(provider);
    await clientA.swapWithExactOut({
      toChainId: 42161,
      toTokenAddress: '0x0000000000000000000000000000000000000ccc',
      toAmountRaw: 1n,
    });

    expect(hoisted.signEphemeralKeyMessage).toHaveBeenCalledTimes(1);
    expect(hoisted.storageSetItem).toHaveBeenCalledWith(
      'nexus-sdk-v2:ephemeral-signature:0x0000000000000000000000000000000000000aaa:localhost',
      STORED_SIGNATURE
    );
    expect(hoisted.swap.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        swap: expect.objectContaining({
          ephemeralWallet: expect.objectContaining({ address: DERIVED_ADDRESS }),
        }),
      })
    );

    hoisted.storageGetItem.mockReturnValue(STORED_SIGNATURE);
    hoisted.signEphemeralKeyMessage.mockClear();
    hoisted.swap.mockClear();

    const clientB = createNexusClient({
      network: 'testnet',
      internal: { middlewareClient },
    });

    await clientB.initialize();
    await clientB.setEVMProvider(provider);
    await clientB.swapWithExactOut({
      toChainId: 42161,
      toTokenAddress: '0x0000000000000000000000000000000000000ccc',
      toAmountRaw: 1n,
    });

    expect(hoisted.storageGetItem).toHaveBeenCalledWith(
      'nexus-sdk-v2:ephemeral-signature:0x0000000000000000000000000000000000000aaa:localhost'
    );
    expect(hoisted.deriveEphemeralKeyFromSignature).toHaveBeenCalledWith(STORED_SIGNATURE);
    expect(hoisted.signEphemeralKeyMessage).not.toHaveBeenCalled();
    expect(hoisted.swap.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        swap: expect.objectContaining({
          ephemeralWallet: expect.objectContaining({ address: DERIVED_ADDRESS }),
        }),
      })
    );
  });

  it('does not prompt during calculateMaxForSwap when no signature is cached', async () => {
    const client = createNexusClient({
      network: 'testnet',
      internal: { middlewareClient: makeMiddlewareClient() },
    });

    await client.initialize();
    await client.setEVMProvider(makeProvider());
    // setEVMProvider derives the key eagerly (one prompt); calculateMaxForSwap must add none.
    hoisted.signEphemeralKeyMessage.mockClear();
    await client.calculateMaxForSwap({
      toChainId: 42161,
      toTokenAddress: '0x0000000000000000000000000000000000000ccc',
    });

    expect(hoisted.signEphemeralKeyMessage).not.toHaveBeenCalled();
    expect(hoisted.calculateMaxForSwap).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        eoaAddress: ADDRESS,
        ephemeralAddress: ADDRESS,
      })
    );
  });

  it('removes an invalid cached signature and re-signs on swap', async () => {
    const FRESH_SIGNATURE = '0x' + 'ab'.repeat(65);
    hoisted.storageGetItem.mockReturnValue(STORED_SIGNATURE);
    // Derive throws specifically for the bad stored signature so both the
    // background preload and the later swap flow detect the same failure.
    hoisted.deriveEphemeralKeyFromSignature.mockImplementation((sig: Hex) => {
      if (sig === STORED_SIGNATURE) {
        throw new Error('bad cached signature');
      }
      return { address: DERIVED_ADDRESS };
    });
    hoisted.signEphemeralKeyMessage.mockResolvedValue(FRESH_SIGNATURE);

    const client = createNexusClient({
      network: 'testnet',
      internal: { middlewareClient: makeMiddlewareClient() },
    });

    await client.initialize();
    await client.setEVMProvider(makeProvider());
    await client.swapWithExactOut({
      toChainId: 42161,
      toTokenAddress: '0x0000000000000000000000000000000000000ccc',
      toAmountRaw: 1n,
    });

    expect(hoisted.storageRemoveItem).toHaveBeenCalledWith(
      'nexus-sdk-v2:ephemeral-signature:0x0000000000000000000000000000000000000aaa:localhost'
    );
    expect(hoisted.signEphemeralKeyMessage).toHaveBeenCalledTimes(1);
    expect(hoisted.storageSetItem).toHaveBeenCalledWith(
      'nexus-sdk-v2:ephemeral-signature:0x0000000000000000000000000000000000000aaa:localhost',
      FRESH_SIGNATURE
    );
  });

  it('removes an invalid cached signature and stays prompt-free during calculateMaxForSwap', async () => {
    hoisted.storageGetItem.mockReturnValue(STORED_SIGNATURE);
    hoisted.deriveEphemeralKeyFromSignature.mockImplementationOnce(() => {
      throw new Error('bad cached signature');
    });

    const client = createNexusClient({
      network: 'testnet',
      internal: { middlewareClient: makeMiddlewareClient() },
    });

    await client.initialize();
    await client.setEVMProvider(makeProvider());
    // The invalid stored signature is evicted and re-signed at connect; the later
    // calculateMaxForSwap must add no further prompt.
    expect(hoisted.storageRemoveItem).toHaveBeenCalledWith(
      'nexus-sdk-v2:ephemeral-signature:0x0000000000000000000000000000000000000aaa:localhost'
    );
    hoisted.signEphemeralKeyMessage.mockClear();
    await client.calculateMaxForSwap({
      toChainId: 42161,
      toTokenAddress: '0x0000000000000000000000000000000000000ccc',
    });

    expect(hoisted.signEphemeralKeyMessage).not.toHaveBeenCalled();
    expect(hoisted.calculateMaxForSwap).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        ephemeralAddress: ADDRESS,
      })
    );
  });

  it('evicts a cached signature whose recovered address does not match the EOA and re-signs', async () => {
    const FRESH_SIGNATURE = '0x' + 'ab'.repeat(65);
    hoisted.storageGetItem.mockReturnValue(STORED_SIGNATURE);
    // Verify fails for the bad stored sig and succeeds for any other (e.g. the
    // fresh one), so both preload and swap detect the mismatch consistently.
    hoisted.verifyEphemeralSignature.mockImplementation((args: { signature: Hex }) =>
      Promise.resolve(args.signature !== STORED_SIGNATURE)
    );
    hoisted.signEphemeralKeyMessage.mockResolvedValue(FRESH_SIGNATURE);

    const client = createNexusClient({
      network: 'testnet',
      internal: { middlewareClient: makeMiddlewareClient() },
    });

    await client.initialize();
    await client.setEVMProvider(makeProvider());
    await client.swapWithExactOut({
      toChainId: 42161,
      toTokenAddress: '0x0000000000000000000000000000000000000ccc',
      toAmountRaw: 1n,
    });

    expect(hoisted.storageRemoveItem).toHaveBeenCalledWith(
      'nexus-sdk-v2:ephemeral-signature:0x0000000000000000000000000000000000000aaa:localhost'
    );
    expect(hoisted.deriveEphemeralKeyFromSignature).not.toHaveBeenCalledWith(STORED_SIGNATURE);
    expect(hoisted.deriveEphemeralKeyFromSignature).toHaveBeenCalledWith(FRESH_SIGNATURE);
    expect(hoisted.signEphemeralKeyMessage).toHaveBeenCalledTimes(1);
    expect(hoisted.storageSetItem).toHaveBeenCalledWith(
      'nexus-sdk-v2:ephemeral-signature:0x0000000000000000000000000000000000000aaa:localhost',
      FRESH_SIGNATURE
    );
  });
});
