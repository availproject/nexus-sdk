import { CurrencyID } from '@avail-project/ca-common';
import Decimal from 'decimal.js';
import Long from 'long';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SWAP_STEPS } from '../commons';
import { EADDRESS, SWEEPER_ADDRESS, ZERO_BYTES_32 } from './constants';

const switchChainMock = vi.hoisted(() => vi.fn());
const waitForTxReceiptMock = vi.hoisted(() => vi.fn());
const performDestinationSwapMock = vi.hoisted(() => vi.fn());
const createPermitAndTransferFromTxMock = vi.hoisted(() => vi.fn());
const createSweeperTxsMock = vi.hoisted(() => vi.fn());
const createCaliburExecuteTxFromCallsMock = vi.hoisted(() => vi.fn());
const createSBCTxFromCallsMock = vi.hoisted(() => vi.fn());
const caliburExecuteMock = vi.hoisted(() => vi.fn());
const checkAuthCodeSetMock = vi.hoisted(() => vi.fn());
const waitForSBCTxReceiptMock = vi.hoisted(() => vi.fn());
const createBridgeRFFMock = vi.hoisted(() => vi.fn());

vi.mock('../core/utils', async () => {
  const actual = await vi.importActual<typeof import('../core/utils')>('../core/utils');
  return {
    ...actual,
    switchChain: switchChainMock,
    waitForTxReceipt: waitForTxReceiptMock,
  };
});

vi.mock('./utils', async () => {
  const actual = await vi.importActual<typeof import('./utils')>('./utils');
  return {
    ...actual,
    createPermitAndTransferFromTx: createPermitAndTransferFromTxMock,
    createSweeperTxs: createSweeperTxsMock,
    performDestinationSwap: performDestinationSwapMock,
  };
});

vi.mock('./rff', async () => {
  const actual = await vi.importActual<typeof import('./rff')>('./rff');
  return {
    ...actual,
    createBridgeRFF: createBridgeRFFMock,
  };
});

vi.mock('./sbc', async () => {
  const actual = await vi.importActual<typeof import('./sbc')>('./sbc');
  return {
    ...actual,
    caliburExecute: caliburExecuteMock,
    checkAuthCodeSet: checkAuthCodeSetMock,
    createCaliburExecuteTxFromCalls: createCaliburExecuteTxFromCallsMock,
    createSBCTxFromCalls: createSBCTxFromCallsMock,
    waitForSBCTxReceipt: waitForSBCTxReceiptMock,
  };
});

import { BridgeHandler, DestinationSwapHandler, SourceSwapsHandler } from './ob';
import { convertTo32Bytes } from './utils';

const makeSourceQuote = (chainID: number) =>
  ({
    chainID,
    holding: {
      amountRaw: 1_000_000n,
      tokenAddress: convertTo32Bytes('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
    },
    quote: {
      input: {
        amount: '1',
        amountRaw: 1_000_000n,
        contractAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        decimals: 6,
        symbol: 'TOKEN',
      },
      output: {
        amount: '1',
        amountRaw: 1_000_000n,
        contractAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        decimals: 6,
        symbol: 'USDC',
      },
      txData: {
        approvalAddress: '0xcccccccccccccccccccccccccccccccccccccccc',
        tx: {
          data: '0x1234',
          to: '0xdddddddddddddddddddddddddddddddddddddddd',
          value: '0',
        },
      },
    },
  }) as never;

describe('DestinationSwapHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    switchChainMock.mockResolvedValue(undefined);
    waitForTxReceiptMock.mockResolvedValue(undefined);
    performDestinationSwapMock.mockResolvedValue('0xhash');
    createPermitAndTransferFromTxMock.mockResolvedValue([
      {
        data: '0xpermit',
        to: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        value: 0n,
      },
    ]);
    createCaliburExecuteTxFromCallsMock.mockResolvedValue({ kind: 'calibur' });
    createSBCTxFromCallsMock.mockResolvedValue({ kind: 'sbc' });
    createSweeperTxsMock.mockReturnValue([]);
    caliburExecuteMock.mockResolvedValue('0xhash');
    checkAuthCodeSetMock.mockResolvedValue(true);
    waitForSBCTxReceiptMock.mockResolvedValue(undefined);
  });

  it('skips destination execution entirely for direct-to-EOA routes', async () => {
    const emitter = { emit: vi.fn() };
    const vscClient = { vscEnsureCaliburAccount: vi.fn() };
    const metadata = {
      dst: {
        chid: ZERO_BYTES_32,
        swaps: [],
        tx_hash: ZERO_BYTES_32,
        univ: 1,
      },
      has_xcs: true,
      rff_id: 0n,
      src: [],
    } as const;

    const handler = new DestinationSwapHandler(
      {
        bridge: null,
        destination: {
          chainId: 999,
          eoaToDestinationAccount: null,
          execution: {
            address: '0x1111111111111111111111111111111111111111',
            entryPoint: null,
            mode: 'direct_eoa',
          },
          getDstSwap: vi.fn().mockResolvedValue(null),
          inputAmount: { max: new Decimal(0), min: new Decimal(0) },
          swap: {
            creationTime: Date.now(),
            gasSwap: null,
            tokenSwap: null,
          },
        },
        extras: null,
        source: { swaps: [] },
      } as never,
      {
        address: {
          cosmos: '',
          eoa: '0x1111111111111111111111111111111111111111',
          ephemeral: '0x2222222222222222222222222222222222222222',
        },
        aggregators: [],
        cache: {
          addAllowanceQuery: vi.fn(),
          addNativeAllowanceQuery: vi.fn(),
          addPermitQuery: vi.fn(),
          addSetCodeQuery: vi.fn(),
        },
        chainList: {
          getChainByID: vi.fn(() => ({
            blockExplorers: { default: { url: 'https://example.com' } },
            id: 999,
            name: 'HyperEVM',
          })),
        },
        cot: {
          currencyID: CurrencyID.USDC,
          symbol: 'USDC',
        },
        cosmosQueryClient: {} as never,
        destinationChainID: 999,
        emitter,
        publicClientList: { get: vi.fn() },
        slippage: 0.005,
        vscClient,
        wallet: {
          cosmos: {} as never,
          eoa: {} as never,
          ephemeral: {} as never,
        },
      } as never
    );

    await handler.process(metadata as never);

    expect(vscClient.vscEnsureCaliburAccount).not.toHaveBeenCalled();
    expect(performDestinationSwapMock).not.toHaveBeenCalled();
    expect(emitter.emit).toHaveBeenCalledWith(SWAP_STEPS.SWAP_COMPLETE);
    expect(metadata.dst.tx_hash).toEqual(ZERO_BYTES_32);
  });

  it('does not self-ensure Calibur destination accounts after the orchestration preflight', async () => {
    const emitter = { emit: vi.fn() };
    const vscClient = {
      vscEnsureCaliburAccount: vi.fn().mockResolvedValue({}),
    };
    const metadata = {
      dst: {
        chid: ZERO_BYTES_32,
        swaps: [],
        tx_hash: ZERO_BYTES_32,
        univ: 1,
      },
      has_xcs: true,
      rff_id: 0n,
      src: [],
    } as const;

    const handler = new DestinationSwapHandler(
      {
        bridge: null,
        destination: {
          chainId: 999,
          eoaToDestinationAccount: null,
          execution: {
            address: '0x3333333333333333333333333333333333333333',
            entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
            mode: 'calibur_account',
          },
          getDstSwap: vi.fn().mockResolvedValue(null),
          inputAmount: { max: new Decimal(0), min: new Decimal(0) },
          swap: {
            creationTime: Date.now(),
            gasSwap: null,
            tokenSwap: null,
          },
        },
        extras: null,
        source: { swaps: [] },
      } as never,
      {
        address: {
          cosmos: '',
          eoa: '0x1111111111111111111111111111111111111111',
          ephemeral: '0x2222222222222222222222222222222222222222',
        },
        aggregators: [],
        cache: {
          addAllowanceQuery: vi.fn(),
          addNativeAllowanceQuery: vi.fn(),
          addPermitQuery: vi.fn(),
          addSetCodeQuery: vi.fn(),
        },
        chainList: {
          getChainByID: vi.fn(() => ({
            blockExplorers: { default: { url: 'https://example.com' } },
            id: 999,
            name: 'HyperEVM',
          })),
        },
        cot: {
          currencyID: CurrencyID.USDC,
          symbol: 'USDC',
        },
        cosmosQueryClient: {} as never,
        destinationChainID: 999,
        emitter,
        publicClientList: { get: vi.fn() },
        slippage: 0.005,
        vscClient,
        wallet: {
          cosmos: {} as never,
          eoa: {} as never,
          ephemeral: {} as never,
        },
      } as never
    );

    await handler.createPermit();
    await handler.process(metadata as never);

    expect(vscClient.vscEnsureCaliburAccount).not.toHaveBeenCalled();
  });
});

describe('SourceSwapsHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    switchChainMock.mockResolvedValue(undefined);
    waitForTxReceiptMock.mockResolvedValue(undefined);
    createPermitAndTransferFromTxMock.mockResolvedValue([
      {
        data: '0xpermit',
        to: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        value: 0n,
      },
    ]);
    createCaliburExecuteTxFromCallsMock.mockResolvedValue({ kind: 'calibur' });
    createSBCTxFromCallsMock.mockResolvedValue({ kind: 'sbc' });
    createSweeperTxsMock.mockReturnValue([]);
    caliburExecuteMock.mockResolvedValue('0xhash');
    checkAuthCodeSetMock.mockResolvedValue(true);
    waitForSBCTxReceiptMock.mockResolvedValue(undefined);
  });

  it('caches Calibur source allowances against the wrapper without 7702 code queries', () => {
    const cache = {
      addAllowanceQuery: vi.fn(),
      addNativeAllowanceQuery: vi.fn(),
      addPermitQuery: vi.fn(),
      addSetCodeQuery: vi.fn(),
    };

    new SourceSwapsHandler(
      {
        source: {
          swaps: [makeSourceQuote(999)],
          executions: {
            999: {
              address: '0x3333333333333333333333333333333333333333',
              entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
              mode: 'calibur_account',
            },
          },
        },
      } as never,
      {
        address: {
          cosmos: '',
          eoa: '0x1111111111111111111111111111111111111111',
          ephemeral: '0x2222222222222222222222222222222222222222',
        },
        cache,
        cot: {
          currencyID: CurrencyID.USDC,
          symbol: 'USDC',
        },
      } as never
    );

    expect(cache.addSetCodeQuery).not.toHaveBeenCalled();
    expect(cache.addAllowanceQuery).toHaveBeenCalledWith({
      chainID: 999,
      contractAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      owner: '0x1111111111111111111111111111111111111111',
      spender: '0x3333333333333333333333333333333333333333',
    });
    expect(cache.addAllowanceQuery).toHaveBeenCalledWith({
      chainID: 999,
      contractAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      owner: '0x3333333333333333333333333333333333333333',
      spender: SWEEPER_ADDRESS,
    });
  });

  it('submits ERC20-only Calibur source swaps through signed Calibur execution', async () => {
    const vscClient = {
      vscCreateCaliburExecuteTx: vi.fn().mockResolvedValue([999n, `0x${'11'.repeat(32)}`]),
      vscSBCTx: vi.fn(),
    };
    const handler = new SourceSwapsHandler(
      {
        source: {
          swaps: [makeSourceQuote(999)],
          executions: {
            999: {
              address: '0x3333333333333333333333333333333333333333',
              entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
              mode: 'calibur_account',
            },
          },
        },
      } as never,
      {
        address: {
          cosmos: '',
          eoa: '0x1111111111111111111111111111111111111111',
          ephemeral: '0x2222222222222222222222222222222222222222',
        },
        aggregators: [],
        cache: {
          addAllowanceQuery: vi.fn(),
          addNativeAllowanceQuery: vi.fn(),
          addPermitQuery: vi.fn(),
          addSetCodeQuery: vi.fn(),
          getCode: vi.fn(() => '0x'),
        },
        chainList: {
          getChainByID: vi.fn(() => ({
            blockExplorers: { default: { url: 'https://example.com' } },
            id: 999,
            name: 'HyperEVM',
          })),
        },
        cot: {
          currencyID: CurrencyID.USDC,
          symbol: 'USDC',
        },
        emitter: { emit: vi.fn() },
        publicClientList: { get: vi.fn(() => ({})) },
        slippage: 0.005,
        vscClient,
        wallet: {
          eoa: {} as never,
          ephemeral: { address: '0x2222222222222222222222222222222222222222' } as never,
        },
      } as never
    );

    await handler.process({
      dst: { chid: ZERO_BYTES_32, swaps: [], tx_hash: ZERO_BYTES_32, univ: 1 },
      has_xcs: true,
      rff_id: 0n,
      src: [],
    });

    expect(createCaliburExecuteTxFromCallsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chainID: 999,
        executionAddress: '0x3333333333333333333333333333333333333333',
      })
    );
    expect(vscClient.vscCreateCaliburExecuteTx).toHaveBeenCalledWith({ kind: 'calibur' });
    expect(vscClient.vscSBCTx).not.toHaveBeenCalled();
  });

  it('submits native-value Calibur source swaps directly through caliburExecute without pre-auth', async () => {
    const baseQuote = makeSourceQuote(999) as {
      chainID: number;
      holding: unknown;
      quote: {
        input: {
          amount: string;
          amountRaw: bigint;
          contractAddress: `0x${string}`;
          decimals: number;
          symbol: string;
        };
        output: {
          amount: string;
          amountRaw: bigint;
          contractAddress: `0x${string}`;
          decimals: number;
          symbol: string;
        };
        txData: {
          approvalAddress: `0x${string}`;
          tx: {
            data: `0x${string}`;
            to: `0x${string}`;
            value: string;
          };
        };
      };
    };
    const nativeQuote = {
      ...baseQuote,
      quote: {
        ...baseQuote.quote,
        input: {
          ...baseQuote.quote.input,
          amountRaw: 2_000_000_000_000_000n,
          contractAddress: EADDRESS,
          symbol: 'ETH',
        },
        txData: {
          approvalAddress: '0xcccccccccccccccccccccccccccccccccccccccc',
          tx: {
            data: '0x1234',
            to: '0xdddddddddddddddddddddddddddddddddddddddd',
            value: '2000000000000000',
          },
        },
      },
    } as never;
    const vscClient = {
      vscCreateCaliburExecuteTx: vi.fn(),
      vscSBCTx: vi.fn(),
    };
    const handler = new SourceSwapsHandler(
      {
        source: {
          swaps: [nativeQuote],
          executions: {
            999: {
              address: '0x3333333333333333333333333333333333333333',
              entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
              mode: 'calibur_account',
            },
          },
        },
      } as never,
      {
        address: {
          cosmos: '',
          eoa: '0x1111111111111111111111111111111111111111',
          ephemeral: '0x2222222222222222222222222222222222222222',
        },
        aggregators: [],
        cache: {
          addAllowanceQuery: vi.fn(),
          addNativeAllowanceQuery: vi.fn(),
          addPermitQuery: vi.fn(),
          addSetCodeQuery: vi.fn(),
          getCode: vi.fn(() => '0x'),
        },
        chainList: {
          getChainByID: vi.fn(() => ({
            blockExplorers: { default: { url: 'https://example.com' } },
            id: 999,
            name: 'HyperEVM',
          })),
        },
        cot: {
          currencyID: CurrencyID.USDC,
          symbol: 'USDC',
        },
        emitter: { emit: vi.fn() },
        publicClientList: { get: vi.fn(() => ({})) },
        slippage: 0.005,
        vscClient,
        wallet: {
          eoa: {} as never,
          ephemeral: { address: '0x2222222222222222222222222222222222222222' } as never,
        },
      } as never
    );

    await handler.process({
      dst: { chid: ZERO_BYTES_32, swaps: [], tx_hash: ZERO_BYTES_32, univ: 1 },
      has_xcs: true,
      rff_id: 0n,
      src: [],
    });

    expect(checkAuthCodeSetMock).not.toHaveBeenCalled();
    expect(vscClient.vscSBCTx).not.toHaveBeenCalled();
    expect(caliburExecuteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'calibur_account',
        targetAddress: '0x3333333333333333333333333333333333333333',
        value: 2_000_000_000_000_000n,
      })
    );
  });

  it('returns the planned Calibur source chains as a Set', () => {
    const handler = new SourceSwapsHandler(
      {
        source: {
          swaps: [makeSourceQuote(999), makeSourceQuote(999)],
          executions: {
            999: {
              address: '0x3333333333333333333333333333333333333333',
              entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
              mode: 'calibur_account',
            },
          },
        },
      } as never,
      {
        address: {
          cosmos: '',
          eoa: '0x1111111111111111111111111111111111111111',
          ephemeral: '0x2222222222222222222222222222222222222222',
        },
        cache: {
          addAllowanceQuery: vi.fn(),
          addNativeAllowanceQuery: vi.fn(),
          addPermitQuery: vi.fn(),
          addSetCodeQuery: vi.fn(),
        },
        cot: {
          currencyID: CurrencyID.USDC,
          symbol: 'USDC',
        },
      } as never
    );

    expect(handler.getPlannedCaliburChains()).toEqual(new Set([999]));
  });
});

describe('BridgeHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    waitForTxReceiptMock.mockResolvedValue(undefined);
    createCaliburExecuteTxFromCallsMock.mockResolvedValue({ kind: 'calibur' });
    createSBCTxFromCallsMock.mockResolvedValue({ kind: 'sbc' });
    createSweeperTxsMock.mockReturnValue([]);
    waitForSBCTxReceiptMock.mockResolvedValue(undefined);
    createBridgeRFFMock.mockResolvedValue({
      createRFF: vi.fn().mockResolvedValue({
        createDoubleCheckTx: vi.fn(),
        intentID: Long.fromNumber(123),
      }),
      depositCalls: {
        999: {
          amount: 1_000_000n,
          tokenAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          tx: [
            {
              data: '0xdeposit',
              to: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
              value: 0n,
            },
          ],
        },
      },
      eoaToEphemeralCalls: {},
      waitForFill: () => ({
        filled: true,
        intentID: Long.fromNumber(123),
        promise: Promise.resolve(),
      }),
    });
  });

  const bridgeInput = {
    amount: new Decimal(1),
    assets: [
      {
        chainID: 999,
        contractAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as `0x${string}`,
        decimals: 6,
        eoaBalance: new Decimal(0),
        ephemeralBalance: new Decimal(1),
      },
    ],
    chainID: 1,
    decimals: 6,
    recipientAddress: '0x4444444444444444444444444444444444444444' as `0x${string}`,
    tokenAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as `0x${string}`,
  };

  it('keeps vault allowance owner as ephemeral for Calibur bridge assets', () => {
    const cache = {
      addAllowanceQuery: vi.fn(),
      addSetCodeQuery: vi.fn(),
    };

    new BridgeHandler(
      bridgeInput,
      {
        address: {
          cosmos: '',
          eoa: '0x1111111111111111111111111111111111111111',
          ephemeral: '0x2222222222222222222222222222222222222222',
        },
        cache,
        chainList: {
          getVaultContractAddress: vi.fn(() => '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'),
        },
      } as never,
      {
        999: {
          address: '0x3333333333333333333333333333333333333333',
          entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
          mode: 'calibur_account',
        },
      }
    );

    expect(cache.addAllowanceQuery).toHaveBeenCalledWith({
      chainID: 999,
      contractAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      owner: '0x2222222222222222222222222222222222222222',
      spender: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    });
    expect(cache.addSetCodeQuery).not.toHaveBeenCalled();
  });

  it('submits Calibur bridge deposits through the wrapper execution path', async () => {
    const vscClient = {
      vscCreateCaliburExecuteTx: vi.fn().mockResolvedValue([999n, `0x${'22'.repeat(32)}`]),
      vscSBCTx: vi.fn(),
    };
    const handler = new BridgeHandler(
      bridgeInput,
      {
        address: {
          cosmos: 'cosmos1',
          eoa: '0x1111111111111111111111111111111111111111',
          ephemeral: '0x2222222222222222222222222222222222222222',
        },
        cache: {
          addAllowanceQuery: vi.fn(),
          addSetCodeQuery: vi.fn(),
        },
        chainList: {
          getChainByID: vi.fn(() => ({
            blockExplorers: { default: { url: 'https://example.com' } },
            id: 999,
            name: 'HyperEVM',
          })),
          getVaultContractAddress: vi.fn(() => '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'),
        },
        cosmosQueryClient: {} as never,
        emitter: { emit: vi.fn() },
        publicClientList: { get: vi.fn(() => ({})) },
        vscClient,
        wallet: {
          cosmos: {} as never,
          eoa: {} as never,
          ephemeral: { address: '0x2222222222222222222222222222222222222222' } as never,
        },
        cot: {
          currencyID: CurrencyID.USDC,
          symbol: 'USDC',
        },
      } as never,
      {
        999: {
          address: '0x3333333333333333333333333333333333333333',
          entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
          mode: 'calibur_account',
        },
      }
    );

    await handler.process(
      {
        dst: { chid: ZERO_BYTES_32, swaps: [], tx_hash: ZERO_BYTES_32, univ: 1 },
        has_xcs: true,
        rff_id: 0n,
        src: [],
      },
      []
    );

    expect(createCaliburExecuteTxFromCallsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chainID: 999,
        executionAddress: '0x3333333333333333333333333333333333333333',
      })
    );
    expect(vscClient.vscCreateCaliburExecuteTx).toHaveBeenCalledWith({ kind: 'calibur' });
    expect(vscClient.vscSBCTx).not.toHaveBeenCalled();
  });

  it('throws immediately when a required Calibur deposit execution is missing', () => {
    expect(
      () =>
        new BridgeHandler(
          {
            ...bridgeInput,
            assets: [
              {
                chainID: 999,
                contractAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as `0x${string}`,
                decimals: 6,
                eoaBalance: new Decimal(1),
                ephemeralBalance: new Decimal(0),
              },
              {
                chainID: 999,
                contractAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as `0x${string}`,
                decimals: 6,
                eoaBalance: new Decimal(1),
                ephemeralBalance: new Decimal(0),
              },
            ],
          },
          {
            address: {
              cosmos: 'cosmos1',
              eoa: '0x1111111111111111111111111111111111111111',
              ephemeral: '0x2222222222222222222222222222222222222222',
            },
            cache: {
              addAllowanceQuery: vi.fn(),
              addSetCodeQuery: vi.fn(),
            },
            chainList: {
              getVaultContractAddress: vi.fn(() => '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'),
            },
          } as never,
          {}
        )
    ).toThrow('source execution not found for chain 999');
  });
});
