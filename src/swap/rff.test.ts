import { ERC20ABI, Universe } from '@avail-project/ca-common';
import Decimal from 'decimal.js';
import { decodeFunctionData } from 'viem';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SUPPORTED_CHAINS } from '../commons';

const createPermitOnlyApprovalTxMock = vi.hoisted(() => vi.fn());
const cosmosCreateRFFMock = vi.hoisted(() => vi.fn());
const cosmosCreateDoubleCheckTxMock = vi.hoisted(() => vi.fn());
const createRFFromIntentMock = vi.hoisted(() => vi.fn());
const evmWaitForFillMock = vi.hoisted(() => vi.fn());
const getAllowancesMock = vi.hoisted(() => vi.fn());
const getFeeStoreMock = vi.hoisted(() => vi.fn());
const removeIntentHashFromStoreMock = vi.hoisted(() => vi.fn());
const storeIntentHashToStoreMock = vi.hoisted(() => vi.fn());

vi.mock('./utils', async () => {
  const actual = await vi.importActual<typeof import('./utils')>('./utils');
  return {
    ...actual,
    createPermitOnlyApprovalTx: createPermitOnlyApprovalTxMock,
  };
});

vi.mock('../core/utils', async () => {
  const actual = await vi.importActual<typeof import('../core/utils')>('../core/utils');
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

import { createBridgeRFF, createVaultFundingAndAllowanceCalls } from './rff';

describe('createVaultFundingAndAllowanceCalls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createPermitOnlyApprovalTxMock.mockResolvedValue({
      data: '0xpermit',
      to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      value: 0n,
    });
  });

  it('funds ephemeral from the Calibur wrapper and signs an ephemeral vault permit', async () => {
    const calls = await createVaultFundingAndAllowanceCalls({
      allowance: 0n,
      chainID: 999,
      deadline: 123456789n,
      evm: {
        address: '0x2222222222222222222222222222222222222222',
        client: { address: '0x2222222222222222222222222222222222222222' } as never,
      },
      publicClientList: { get: vi.fn(() => ({})) } as never,
      sourceExecution: {
        address: '0x3333333333333333333333333333333333333333',
        entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
        mode: 'calibur_account',
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
      chainId: 999,
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

  it('skips the permit step when the wrapper already has enough vault allowance', async () => {
    const calls = await createVaultFundingAndAllowanceCalls({
      allowance: 1_000_000n,
      chainID: 999,
      deadline: 123456789n,
      evm: {
        address: '0x2222222222222222222222222222222222222222',
        client: { address: '0x2222222222222222222222222222222222222222' } as never,
      },
      publicClientList: { get: vi.fn(() => ({})) } as never,
      sourceExecution: {
        address: '0x3333333333333333333333333333333333333333',
        entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
        mode: 'calibur_account',
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
      chainID: 1,
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

  it('throws when a Calibur bridge source execution is missing instead of silently falling back to 7702', async () => {
    await expect(
      createBridgeRFF({
        config: makeConfig({}),
        input: makeInput(),
        output: makeOutput(),
        recipientAddress: '0x4444444444444444444444444444444444444444',
      })
    ).rejects.toThrow('source execution not found for chain 999');
  });

  it('rejects before any cosmos broadcast if Calibur vault permit construction fails', async () => {
    createPermitOnlyApprovalTxMock.mockRejectedValueOnce(new Error('permit failed'));

    await expect(
      createBridgeRFF({
        config: makeConfig({
          [SUPPORTED_CHAINS.HYPEREVM]: {
            address: '0x3333333333333333333333333333333333333333',
            entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
            mode: 'calibur_account',
          },
        }),
        input: makeInput(),
        output: makeOutput(),
        recipientAddress: '0x4444444444444444444444444444444444444444',
      })
    ).rejects.toThrow('permit failed');

    expect(cosmosCreateRFFMock).not.toHaveBeenCalled();
  });
});
