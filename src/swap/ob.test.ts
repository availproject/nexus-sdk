import { CurrencyID } from '@avail-project/ca-common';
import Decimal from 'decimal.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ZERO_BYTES_32 } from './constants';

const switchChainMock = vi.hoisted(() => vi.fn());
const performDestinationSwapMock = vi.hoisted(() => vi.fn());

vi.mock('../core/utils', async () => {
  const actual = await vi.importActual<typeof import('../core/utils')>('../core/utils');
  return {
    ...actual,
    switchChain: switchChainMock,
  };
});

vi.mock('./utils', async () => {
  const actual = await vi.importActual<typeof import('./utils')>('./utils');
  return {
    ...actual,
    performDestinationSwap: performDestinationSwapMock,
  };
});

import { SWAP_STEPS } from '../commons';
import { DestinationSwapHandler } from './ob';
import { convertTo32Bytes } from './utils';

describe('DestinationSwapHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    switchChainMock.mockResolvedValue(undefined);
    performDestinationSwapMock.mockResolvedValue('0xhash');
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
          getChainByID: vi.fn(() => ({ id: 999, name: 'HyperEVM' })),
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

  it('ensures calibur destination accounts with admin key settings', async () => {
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
          getChainByID: vi.fn(() => ({ id: 999, name: 'HyperEVM' })),
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

    expect(vscClient.vscEnsureCaliburAccount).toHaveBeenCalledWith({
      chainId: 999,
      entryPoint: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
      keys: [
        {
          keyType: 2,
          publicKey: convertTo32Bytes('0x1111111111111111111111111111111111111111'),
          settings: convertTo32Bytes(1n << 200n),
        },
        {
          keyType: 2,
          publicKey: convertTo32Bytes('0x2222222222222222222222222222222222222222'),
          settings: convertTo32Bytes(1n << 200n),
        },
      ],
      owner: '0x1111111111111111111111111111111111111111',
    });
  });
});
