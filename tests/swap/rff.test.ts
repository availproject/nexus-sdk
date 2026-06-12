import { ERC20ABI, Universe } from '@avail-project/ca-common';
import Decimal from 'decimal.js';
import { decodeFunctionData, type Hex, pad } from 'viem';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SUPPORTED_CHAINS } from '../../src/commons';

const pad32 = (h: Hex) => pad(h, { size: 32, dir: 'left' });

const createPermitOnlyApprovalTxMock = vi.hoisted(() => vi.fn());
const cosmosCreateRFFMock = vi.hoisted(() => vi.fn());
const cosmosCreateDoubleCheckTxMock = vi.hoisted(() => vi.fn());
const createRFFromIntentMock = vi.hoisted(() => vi.fn());
const evmWaitForFillMock = vi.hoisted(() => vi.fn());
const getAllowancesMock = vi.hoisted(() => vi.fn());
const getFeeStoreMock = vi.hoisted(() => vi.fn());
const removeIntentHashFromStoreMock = vi.hoisted(() => vi.fn());
const storeIntentHashToStoreMock = vi.hoisted(() => vi.fn());

vi.mock('../../src/swap/utils', async () => {
  const actual =
    await vi.importActual<typeof import('../../src/swap/utils')>('../../src/swap/utils');
  return {
    ...actual,
    createPermitOnlyApprovalTx: createPermitOnlyApprovalTxMock,
  };
});

vi.mock('../../src/core/utils', async () => {
  const actual =
    await vi.importActual<typeof import('../../src/core/utils')>('../../src/core/utils');
  return {
    ...actual,
    cosmosCreateDoubleCheckTx: cosmosCreateDoubleCheckTxMock,
    cosmosCreateRFF: cosmosCreateRFFMock,
    createRFFromIntent: createRFFromIntentMock,
    evmWaitForFill: evmWaitForFillMock,
    getAllowances: getAllowancesMock,
    getFeeStore: getFeeStoreMock,
    removeIntentHashFromStore: removeIntentHashFromStoreMock,
    storeIntentHashToStore: storeIntentHashToStoreMock,
  };
});

import { createBridgeRFF, createVaultFundingAndAllowanceCalls } from '../../src/swap/rff';

describe('createVaultFundingAndAllowanceCalls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createPermitOnlyApprovalTxMock.mockResolvedValue({
      data: '0xpermit',
      to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      value: 0n,
    });
  });

  it('funds ephemeral from the Safe and signs an ephemeral vault permit', async () => {
    const calls = await createVaultFundingAndAllowanceCalls({
      allowance: 0n,
      chain: { id: 999 } as never,
      deadline: 123456789n,
      evm: {
        address: '0x2222222222222222222222222222222222222222',
        client: { address: '0x2222222222222222222222222222222222222222' } as never,
      },
      publicClientList: { get: vi.fn(() => ({})) } as never,
      sourceExecution: {
        address: '0x3333333333333333333333333333333333333333',
        entryPoint: null,
        mode: 'safe_account',
      },
      tokenAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      valueRaw: 1_000_000n,
      vaultAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    });

    expect(calls[0]).toEqual(
      expect.objectContaining({
        to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        value: 0n,
      })
    );
    const decodedTransfer = decodeFunctionData({
      abi: ERC20ABI,
      data: calls[0].data,
    });
    expect(decodedTransfer.functionName).toBe('transfer');
    expect(decodedTransfer.args).toEqual([
      '0x2222222222222222222222222222222222222222',
      1_000_000n,
    ]);
    expect(createPermitOnlyApprovalTxMock).toHaveBeenCalledWith({
      amount: 1_000_000n,
      chain: { id: 999 },
      contractAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      deadline: 123456789n,
      owner: '0x2222222222222222222222222222222222222222',
      publicClient: {},
      signerWallet: { address: '0x2222222222222222222222222222222222222222' },
      spender: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    });
    expect(calls[1]).toEqual({
      data: '0xpermit',
      to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      value: 0n,
    });
  });

  it('skips the permit step when the ephemeral already has enough vault allowance', async () => {
    const calls = await createVaultFundingAndAllowanceCalls({
      allowance: 1_000_000n,
      chain: { id: 999 } as never,
      deadline: 123456789n,
      evm: {
        address: '0x2222222222222222222222222222222222222222',
        client: { address: '0x2222222222222222222222222222222222222222' } as never,
      },
      publicClientList: { get: vi.fn(() => ({})) } as never,
      sourceExecution: {
        address: '0x3333333333333333333333333333333333333333',
        entryPoint: null,
        mode: 'safe_account',
      },
      tokenAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      valueRaw: 1_000_000n,
      vaultAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    });

    expect(createPermitOnlyApprovalTxMock).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    const decodedTransfer = decodeFunctionData({
      abi: ERC20ABI,
      data: calls[0].data,
    });
    expect(decodedTransfer.functionName).toBe('transfer');
  });

  it('keeps the existing approve call for 7702 bridge deposits', async () => {
    const calls = await createVaultFundingAndAllowanceCalls({
      allowance: 0n,
      chain: { id: 1 } as never,
      deadline: 123456789n,
      evm: {
        address: '0x2222222222222222222222222222222222222222',
        client: { address: '0x2222222222222222222222222222222222222222' } as never,
      },
      publicClientList: { get: vi.fn(() => ({})) } as never,
      sourceExecution: {
        address: '0x2222222222222222222222222222222222222222',
        entryPoint: null,
        mode: '7702',
      },
      tokenAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      valueRaw: 1_000_000n,
      vaultAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    });

    expect(createPermitOnlyApprovalTxMock).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(
      expect.objectContaining({
        to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        value: 0n,
      })
    );
  });

  it('returns no funding/allowance calls for native sources (no transfer/approve needed)', async () => {
    // Native sources don't go through ERC20 transferFrom/approve. The deposit itself
    // carries the value (added in createBridgeRFF). Funding/allowance phase is a no-op.
    const calls = await createVaultFundingAndAllowanceCalls({
      allowance: 0n,
      chain: { id: 1 } as never,
      deadline: 123456789n,
      evm: {
        address: '0x2222222222222222222222222222222222222222',
        client: { address: '0x2222222222222222222222222222222222222222' } as never,
      },
      publicClientList: { get: vi.fn(() => ({})) } as never,
      sourceExecution: {
        address: '0x2222222222222222222222222222222222222222',
        entryPoint: null,
        mode: '7702',
      },
      tokenAddress: '0x0000000000000000000000000000000000000000',
      valueRaw: 1_000_000_000_000_000_000n,
      vaultAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    });

    expect(createPermitOnlyApprovalTxMock).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });
});

describe('createBridgeRFF', () => {
  const makeConfig = (sourceExecutions?: Record<number, unknown>) => ({
    chainList: {
      getChainByID: vi.fn((chainID: number) => {
        if (chainID === SUPPORTED_CHAINS.BASE) {
          return {
            id: SUPPORTED_CHAINS.BASE,
            name: 'Base',
            pectraUpgradeSupport: true,
            rpcUrls: {
              default: {
                webSocket: ['wss://base.example'],
              },
            },
            swapSupported: true,
          };
        }
        if (chainID === SUPPORTED_CHAINS.HYPEREVM) {
          return {
            id: SUPPORTED_CHAINS.HYPEREVM,
            name: 'HyperEVM',
            pectraUpgradeSupport: false,
            rpcUrls: {
              default: {
                webSocket: ['wss://hyperevm.example'],
              },
            },
            swapSupported: true,
          };
        }
        return null;
      }),
      getVaultContractAddress: vi.fn(() => '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'),
    } as never,
    cosmos: {
      address: 'avail1test',
      client: {} as never,
    },
    cosmosQueryClient: {} as never,
    evm: {
      address: '0x2222222222222222222222222222222222222222' as const,
      client: { address: '0x2222222222222222222222222222222222222222' } as never,
      eoaAddress: '0x1111111111111111111111111111111111111111' as const,
    },
    publicClientList: { get: vi.fn(() => ({})) } as never,
    sourceExecutions: sourceExecutions as never,
    vscClient: {} as never,
  });

  const makeInput = () => ({
    assets: [
      {
        chainID: SUPPORTED_CHAINS.HYPEREVM,
        contractAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const,
        decimals: 6,
        eoaBalance: new Decimal(0),
        ephemeralBalance: new Decimal(1),
      },
    ],
  });

  const makeOutput = () => ({
    amount: new Decimal(1),
    chainID: SUPPORTED_CHAINS.BASE,
    decimals: 6,
    tokenAddress: '0xcccccccccccccccccccccccccccccccccccccccc' as const,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    createPermitOnlyApprovalTxMock.mockResolvedValue({
      data: '0xpermit',
      to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      value: 0n,
    });
    cosmosCreateRFFMock.mockResolvedValue(42);
    cosmosCreateDoubleCheckTxMock.mockResolvedValue(undefined);
    createRFFromIntentMock.mockResolvedValue({
      msgBasicCosmos: {},
      omniversalRFF: {
        asEVMRFF: () => ({ id: 1 }),
        protobufRFF: {
          sources: [{ chainID: new Uint8Array([SUPPORTED_CHAINS.HYPEREVM]) }],
        },
      },
      signatureData: [
        {
          requestHash: new Uint8Array(32),
          signature: new Uint8Array([1, 2, 3]),
          universe: Universe.ETHEREUM,
        },
      ],
      sources: [
        {
          chainID: SUPPORTED_CHAINS.HYPEREVM,
          tokenAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          valueRaw: 1_000_000n,
        },
      ],
    });
    evmWaitForFillMock.mockResolvedValue(undefined);
    getAllowancesMock.mockResolvedValue({
      [SUPPORTED_CHAINS.HYPEREVM]: 0n,
    });
    getFeeStoreMock.mockResolvedValue({
      calculateCollectionFee: () => new Decimal(0),
      calculateFulfilmentFee: () => new Decimal(0),
      calculateProtocolFee: () => new Decimal(0),
      calculateSolverFee: () => new Decimal(0),
    });
  });

  it('throws when a Safe bridge source execution is missing instead of silently falling back to 7702', async () => {
    await expect(
      createBridgeRFF({
        config: makeConfig({}),
        input: makeInput(),
        output: makeOutput(),
        recipientAddress: '0x4444444444444444444444444444444444444444',
      })
    ).rejects.toThrow('source execution not found for chain 999');
  });

  it('rejects before any cosmos broadcast if Safe vault permit construction fails', async () => {
    createPermitOnlyApprovalTxMock.mockRejectedValueOnce(new Error('permit failed'));

    await expect(
      createBridgeRFF({
        config: makeConfig({
          [SUPPORTED_CHAINS.HYPEREVM]: {
            address: '0x3333333333333333333333333333333333333333',
            entryPoint: null,
            mode: 'safe_account',
          },
        }),
        input: makeInput(),
        output: makeOutput(),
        recipientAddress: '0x4444444444444444444444444444444444444444',
      })
    ).rejects.toThrow('permit failed');

    expect(cosmosCreateRFFMock).not.toHaveBeenCalled();
  });

  it('native source deposit call carries the source value (no transfer/approve pre-calls)', async () => {
    // Native source: createBridgeRFF must emit ONLY the vault.deposit call, with
    // `value: source.valueRaw` so the executor (Calibur on 7702, Safe on safe_account)
    // sends ETH inline with the deposit.
    createRFFromIntentMock.mockResolvedValueOnce({
      msgBasicCosmos: {},
      omniversalRFF: {
        asEVMRFF: () => ({
          sources: [
            {
              universe: Universe.ETHEREUM,
              chainID: BigInt(SUPPORTED_CHAINS.BASE),
              contractAddress: pad32('0x0000000000000000000000000000000000000000'),
              value: 1_000_000_000_000_000_000n,
            },
          ],
          destinationUniverse: Universe.ETHEREUM,
          destinationChainID: BigInt(SUPPORTED_CHAINS.HYPEREVM),
          recipientAddress: pad32('0x4444444444444444444444444444444444444444'),
          destinations: [
            {
              contractAddress: pad32('0x0000000000000000000000000000000000000000'),
              value: 1_000_000n,
            },
          ],
          nonce: 1n,
          expiry: 1n,
          parties: [
            {
              universe: Universe.ETHEREUM,
              address_: pad32('0x4444444444444444444444444444444444444444'),
            },
          ],
        }),
        protobufRFF: {
          sources: [{ chainID: new Uint8Array([SUPPORTED_CHAINS.BASE]) }],
        },
      },
      signatureData: [
        {
          requestHash: new Uint8Array(32),
          signature: new Uint8Array([1, 2, 3]),
          universe: Universe.ETHEREUM,
        },
      ],
      sources: [
        {
          chainID: SUPPORTED_CHAINS.BASE,
          tokenAddress: '0x0000000000000000000000000000000000000000',
          valueRaw: 1_000_000_000_000_000_000n,
        },
      ],
    });
    getAllowancesMock.mockResolvedValueOnce({ [SUPPORTED_CHAINS.BASE]: 0n });

    const result = await createBridgeRFF({
      config: makeConfig({
        [SUPPORTED_CHAINS.BASE]: {
          address: '0x2222222222222222222222222222222222222222',
          entryPoint: null,
          mode: '7702',
        },
      }),
      input: {
        assets: [
          {
            chainID: SUPPORTED_CHAINS.BASE,
            contractAddress: '0x0000000000000000000000000000000000000000',
            decimals: 18,
            eoaBalance: new Decimal(1),
            ephemeralBalance: new Decimal(0),
          },
        ],
      },
      output: {
        amount: new Decimal(1),
        chainID: SUPPORTED_CHAINS.HYPEREVM,
        decimals: 18,
        tokenAddress: '0x0000000000000000000000000000000000000000',
      },
      recipientAddress: '0x4444444444444444444444444444444444444444',
    });

    const depositTxs = result.depositCalls[SUPPORTED_CHAINS.BASE].tx;
    expect(depositTxs).toHaveLength(1);
    expect(depositTxs[0].value).toBe(1_000_000_000_000_000_000n);
    // Native funding must NOT route through eoaToEphemeralCalls (no permit possible).
    // On 7702 the EOA-as-Calibur already holds the native; the deposit's `value` field
    // delivers it inline. createPermitAndTransferFromTx would fail on ZERO_ADDRESS.
    expect(result.eoaToEphemeralCalls).toEqual({});
  });
});
